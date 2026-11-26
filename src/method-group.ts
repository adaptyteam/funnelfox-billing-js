import CheckoutInstance, {
  TAX_RECALC_DEBOUNCE_MS,
  type CheckoutGroup,
} from './checkout';
import APIClient from './api-client';
import { DEFAULTS } from './constants';
import sessionService, {
  type SessionParams,
} from './shared/services/session-service';
import { methodCheckoutConfig } from './method-config';
import { generateId, resolveTaxDisplay } from './utils/helpers';
import { getErrorImage } from './utils/error-image';
import type { PaymentMethod } from './enums';
import type {
  CreateClientSessionResponse,
  DisplayLocaleOptions,
  InitializedPaymentMethod,
  MethodGroupMethodOptions,
  MetadataType,
  MethodGroup,
  MethodGroupOptions,
} from './types';

export class PaymentMethodGroup implements MethodGroup, CheckoutGroup {
  private readonly id = generateId('group_');
  private readonly members = new Set<CheckoutInstance>();
  private readonly apiClient: APIClient;
  private sessionRequest?: Promise<CreateClientSessionResponse>;
  private sessionKey?: SessionParams;
  private current: {
    priceId: string;
    displayCurrency?: string;
    displayCountry?: string;
  };
  private appliedPrice?: string;
  private priceUpdate: Promise<void> = Promise.resolve();
  private recalcTimer?: ReturnType<typeof setTimeout>;
  private recalcSeq = 0;
  private isDestroyed = false;

  constructor(private readonly options: MethodGroupOptions) {
    this.current = {
      priceId: options.priceId,
      displayCurrency: options.displayCurrency,
      displayCountry: options.displayCountry,
    };
    this.apiClient = new APIClient({
      baseUrl: options.baseUrl || DEFAULTS.BASE_URL,
      orgId: options.orgId,
      timeout: DEFAULTS.REQUEST_TIMEOUT,
      retryAttempts: DEFAULTS.RETRY_ATTEMPTS,
    });
  }

  async initMethod(
    method: PaymentMethod,
    htmlNode: HTMLElement,
    options: MethodGroupMethodOptions = {}
  ): Promise<InitializedPaymentMethod> {
    const { style, card, applePay, googlePay, paypal, ...callbacks } = options;
    const checkout = new CheckoutInstance({
      orgId: this.options.orgId,
      baseUrl: this.options.baseUrl,
      checkoutConfig: methodCheckoutConfig({
        ...this.options,
        ...(style && { style }),
        ...(card && { card }),
        ...(applePay && { applePay }),
        ...(googlePay && { googlePay }),
        ...(paypal && { paypal }),
        ...this.current,
        sessionScope: [this.options.sessionScope, this.id]
          .filter(Boolean)
          .join(':'),
      }),
      group: this,
    });
    this.members.add(checkout);
    try {
      return await checkout.initMethod(method, htmlNode, callbacks);
    } catch (error) {
      this.members.delete(checkout);
      getErrorImage(this.options.orgId, {
        baseUrl: this.options.baseUrl,
        message: error.message,
        code: error.code,
        req_id: error?.response?.req_id,
      });
      throw error;
    }
  }

  session(params: SessionParams): Promise<CreateClientSessionResponse> {
    if (!this.sessionRequest) {
      const request = sessionService.createSession({
        ...params,
        integration: 'primer',
      });
      this.sessionKey = params;
      this.sessionRequest = request;
      request.then(
        response => {
          if (response.status === 'error' && this.sessionRequest === request) {
            this.sessionRequest = undefined;
          }
        },
        () => {
          if (this.sessionRequest === request) {
            this.sessionRequest = undefined;
          }
        }
      );
    }
    return this.sessionRequest;
  }

  updatePrice(
    newPriceId: string,
    clientMetadata?: MetadataType,
    displayLocale?: DisplayLocaleOptions
  ): Promise<void> {
    const update = this.priceUpdate.then(() =>
      this.applyPrice(newPriceId, clientMetadata, displayLocale)
    );
    this.priceUpdate = update.then(
      () => undefined,
      () => undefined
    );
    return update;
  }

  private async applyPrice(
    newPriceId: string,
    clientMetadata?: MetadataType,
    displayLocale?: DisplayLocaleOptions
  ): Promise<void> {
    const displayCurrency =
      displayLocale?.displayCurrency ?? this.current.displayCurrency;
    const displayCountry =
      displayLocale?.displayCountry ?? this.current.displayCountry;
    const signature = JSON.stringify([
      newPriceId,
      clientMetadata ?? null,
      displayCurrency ?? null,
      displayCountry ?? null,
    ]);
    const [lead, ...others] = this.members;
    if (!lead || signature === this.appliedPrice) {
      return;
    }
    this.cancelTaxRecalc();
    const locale = { displayCurrency, displayCountry };
    await lead.applyGroupPrice(newPriceId, clientMetadata, locale, true);
    this.appliedPrice = signature;
    this.current = { priceId: newPriceId, displayCurrency, displayCountry };
    const results = await Promise.allSettled(
      others.map(member =>
        member.applyGroupPrice(newPriceId, clientMetadata, locale, false)
      )
    );
    if ([...this.members].some(member => member.taxEnabled())) {
      this.scheduleTaxRecalc();
    }
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failure) {
      throw failure.reason;
    }
  }

  scheduleTaxRecalc(): void {
    const hadPending = this.cancelTaxRecalc();
    if (!this.taxAddress()) {
      if (hadPending) {
        this.members.forEach(member => member.restoreTaxInfo());
      }
      return;
    }
    this.members.forEach(member => member.notifyTaxPending());
    this.recalcTimer = setTimeout(() => {
      this.recalcTimer = undefined;
      void this.runTaxRecalc();
    }, TAX_RECALC_DEBOUNCE_MS);
  }

  async flushTaxRecalc(): Promise<void> {
    this.cancelTaxRecalc();
    await this.runTaxRecalc();
  }

  release(checkout: CheckoutInstance): void {
    this.members.delete(checkout);
    if (!this.members.size) {
      this.cancelTaxRecalc();
    }
  }

  async destroy(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }
    this.isDestroyed = true;
    this.cancelTaxRecalc();
    await Promise.all([...this.members].map(member => member.destroy()));
    if (this.sessionKey) {
      sessionService.invalidate({ ...this.sessionKey, integration: 'primer' });
    }
    this.sessionRequest = undefined;
  }

  private cancelTaxRecalc(): boolean {
    this.recalcSeq++;
    if (!this.recalcTimer) {
      return false;
    }
    clearTimeout(this.recalcTimer);
    this.recalcTimer = undefined;
    return true;
  }

  private taxAddress(): { countryCode: string; postalCode?: string } | null {
    const addresses = [...this.members].map(member => member.getTaxAddress());
    const address =
      addresses.find(candidate => candidate.entered && candidate.countryCode) ??
      addresses.find(candidate => candidate.countryCode);
    return address?.countryCode
      ? { countryCode: address.countryCode, postalCode: address.postalCode }
      : null;
  }

  private async runTaxRecalc(): Promise<void> {
    const address = this.taxAddress();
    const session = this.sessionRequest ? await this.sessionRequest : null;
    if (!address || !session || session.status === 'error') {
      return;
    }
    const { orderId, clientToken } =
      this.apiClient.processSessionResponse(session);
    const seq = ++this.recalcSeq;
    try {
      const tax = await this.apiClient.recalculateTax({
        orderId,
        clientToken: clientToken ?? '',
        countryCode: address.countryCode,
        postalCode: address.postalCode,
      });
      if (seq !== this.recalcSeq) {
        return;
      }
      const info = {
        amountTotal: tax.amount_total,
        currency: tax.currency,
        ...resolveTaxDisplay(tax),
      };
      this.members.forEach(member => member.receiveTaxInfo(info));
    } catch (error) {
      if (seq !== this.recalcSeq) {
        return;
      }
      this.members.forEach(member => member.receiveTaxError(error as Error));
    }
  }
}
