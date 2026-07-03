import { getAdyenCheckout } from './adyen-loader';
import type { AdyenComponent, AdyenState } from './adyen-loader';
import type APIClient from '../api-client';
import type {
  AdyenClientSessionResponse,
  AdyenCardFormOptions,
  AdyenCardForm,
  CreatePaymentResponse,
} from '../types';

const TAX_RECALC_DEBOUNCE_MS = 600;

export async function mountAdyenCardForm(
  element: HTMLElement,
  session: AdyenClientSessionResponse,
  params: Pick<
    AdyenCardFormOptions,
    | 'onRenderSuccess'
    | 'onPaymentSuccess'
    | 'onPaymentFail'
    | 'onLoaderChange'
    | 'email'
    | 'countryCode'
    | 'clientMetadata'
    | 'enableTax'
    | 'onTaxChange'
  > & { apiClient: APIClient }
): Promise<AdyenCardForm> {
  const {
    adyen_client_key,
    adyen_payment_methods,
    amount,
    amount_total,
    currency,
    is_livemode,
    order_id,
    client_token,
    detected_country_code,
    show_country_selector_field,
    show_postal_code_field,
  } = session.data;
  const taxEnabled = session.data.tax_enabled ?? params.enableTax ?? false;
  const currencyUpper = (currency || 'usd').toUpperCase();

  const AdyenCheckout = await getAdyenCheckout(!!is_livemode);
  // Remounting (e.g. picking another price) must replace the form, not stack a second one.
  element.replaceChildren();

  let taxCalculationId: string | undefined;
  let taxAddress: { country?: string; postalCode?: string; state?: string } =
    {};
  let flushTaxRecalc = async (): Promise<void> => {};
  let resolvePayment: (() => void) | undefined;
  let rejectPayment: ((err: unknown) => void) | undefined;

  const runRecalc = async (): Promise<void> => {
    const country = taxAddress.country || detected_country_code;
    // US tax needs the ZIP to resolve a jurisdiction; skip until it's entered.
    if (!country || (country === 'US' && !taxAddress.postalCode)) return;
    try {
      const tax = await params.apiClient.recalculateTax({
        orderId: order_id,
        clientToken: client_token,
        countryCode: country,
        postalCode: taxAddress.postalCode,
        subdivision: taxAddress.state,
      });
      taxCalculationId = tax.tax_calculation_id;
      params.onTaxChange?.({
        amountTotal: tax.amount_total,
        taxAmount: tax.tax_amount,
        currency: tax.currency,
      });
    } catch {
      // Best-effort: keep the current total if recalculation fails.
    }
  };

  const finalize = async (
    raw: CreatePaymentResponse,
    component: AdyenComponent
  ): Promise<void> => {
    const result = params.apiClient.processPaymentResponse(raw);
    if (result.type === 'action_required') {
      // Adyen packs the next action (3DS) JSON into action_required_token; the challenge result
      // comes back through onAdditionalDetails, which resumes the payment.
      component.handleAction(JSON.parse(result.clientToken));
      return;
    }
    params.onPaymentSuccess?.(order_id);
    resolvePayment?.();
  };

  const checkout = await AdyenCheckout({
    environment: is_livemode ? 'live' : 'test',
    clientKey: adyen_client_key,
    paymentMethodsResponse: adyen_payment_methods,
    amount: { value: amount_total ?? amount ?? 0, currency: currencyUpper },
    locale: 'en-US',
    onSubmit: (state, component) => {
      void (async () => {
        try {
          const address = state.data.billingAddress || {};
          const raw = await params.apiClient.createPayment({
            orderId: order_id,
            paymentMethodToken: JSON.stringify(state.data),
            email: params.email,
            countryCode: taxEnabled ? address.country : params.countryCode,
            postalCode: taxEnabled ? address.postalCode : undefined,
            subdivision: taxEnabled ? address.stateOrProvince : undefined,
            taxCalculationId: taxEnabled ? taxCalculationId : undefined,
            clientMetadata: params.clientMetadata,
          });
          await finalize(raw, component);
        } catch (err) {
          params.onPaymentFail?.(err as Error);
          rejectPayment?.(err);
        }
      })();
    },
    onAdditionalDetails: (state, component) => {
      void (async () => {
        try {
          const raw = await params.apiClient.resumePayment({
            orderId: order_id,
            resumeToken: JSON.stringify(state.data),
          });
          await finalize(raw, component);
        } catch (err) {
          params.onPaymentFail?.(err as Error);
          rejectPayment?.(err);
        }
      })();
    },
    onError: error => params.onPaymentFail?.(error as Error),
  });

  const billingFields: string[] = [];
  if (show_country_selector_field) billingFields.push('country');
  if (show_postal_code_field) billingFields.push('postalCode');

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const cardConfig: Record<string, unknown> = {
    showPayButton: false,
    billingAddressRequired: billingFields.length > 0,
    onChange: (state: AdyenState) => {
      if (!taxEnabled) return;
      const address = state.data.billingAddress;
      if (!address) return;
      taxAddress = {
        country: address.country,
        postalCode: address.postalCode || undefined,
        state: address.stateOrProvince || undefined,
      };
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void runRecalc(), TAX_RECALC_DEBOUNCE_MS);
    },
  };
  // Adyen renders a reduced billing form (country + zip) only in 'partial' mode; passing
  // billingAddressRequiredFields alone leaves the postal field unrendered. Use 'partial' when both
  // are wanted (also yields postal for every selected country); otherwise mark just the one field.
  if (show_country_selector_field && show_postal_code_field) {
    cardConfig.billingAddressMode = 'partial';
  } else if (billingFields.length > 0) {
    cardConfig.billingAddressRequiredFields = billingFields;
  }
  // Prefilling the country fixes its value and hides the selector in 'partial' mode, so only prefill
  // when the country field isn't shown. Tax falls back to detected_country_code until the shopper picks.
  if (detected_country_code && !show_country_selector_field) {
    cardConfig.data = { billingAddress: { country: detected_country_code } };
  }

  const card = checkout.create('card', cardConfig);
  card.mount(element);

  flushTaxRecalc = async () => {
    if (debounce) {
      clearTimeout(debounce);
      debounce = undefined;
    }
    if (taxEnabled) await runRecalc();
  };

  params.onRenderSuccess?.();

  return {
    submit: async () => {
      params.onLoaderChange?.(true);
      const done = new Promise<void>((resolve, reject) => {
        resolvePayment = resolve;
        rejectPayment = reject;
      });
      try {
        await flushTaxRecalc();
        card.submit();
        await done;
      } finally {
        params.onLoaderChange?.(false);
      }
    },
  };
}
