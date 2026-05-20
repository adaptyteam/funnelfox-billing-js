/**
 * @fileoverview Checkout instance manager for Funnefox SDK
 */

import EventEmitter from './utils/event-emitter';
import PrimerWrapper from './primer-wrapper';
import { CheckoutError } from './errors';
import { isValidEmail, requireString } from './utils/validation';
import { generateId, generateUUID, merge } from './utils/helpers';
import APIClient from './api-client';
import sessionService from './shared/services/session-service';
import {
  APPLE_PAY_COLLECTING_EMAIL_OPTIONS,
  DEFAULT_PAYMENT_METHOD_ORDER,
  DEFAULTS,
  EVENTS,
} from './constants';
import {
  type CheckoutConfigWithCallbacks,
  type PaymentResult,
  type CheckoutState,
  type BillingCardOptions,
  CardInputSelectors,
  CardInputElementsWithButton,
  PaymentButtonSelectors,
  PaymentButtonElements,
  CheckoutOptions,
  PaymentProcessResult,
} from './types';
import type {
  OnResumeSuccess,
  OnResumeSuccessHandler,
  OnTokenizeSuccess,
  OnTokenizeSuccessHandler,
} from '@primer-io/checkout-web';
import { PaymentMethod } from './enums';
import type { CardSessionFieldConfig, Skin, SkinFactory } from './skins/types';
import { renderLoader, hideLoader } from './assets/loader/loader';
import type {
  CheckoutRenderOptions,
  CreateClientSessionResponse,
  InitMethodCallbacks,
  MetadataType,
} from './types';
import { loadStripe } from '@stripe/stripe-js';
import { renderError } from './assets/error/error';
import { loadAirwallexDeviceFingerprint } from './utils/airwallex-loader';
import { startUnhandledErrorTelemetry } from './utils/unhandled-error-telemetry';

type CachedClientSessionResponse = CreateClientSessionResponse & {
  radarSessionId?: Promise<string>;
  airwallexDeviceId?: Promise<string>;
};

interface CheckoutEventMap {
  [EVENTS.SUCCESS]: PaymentResult;
  [EVENTS.ERROR]:
    | [Error | unknown | undefined]
    | [Error | unknown | undefined, PaymentMethod];
  [EVENTS.STATUS_CHANGE]: [CheckoutState, CheckoutState];
  [EVENTS.DESTROY]: void;
  [EVENTS.INPUT_ERROR]: { name: keyof CardInputSelectors; error: string };
  [EVENTS.METHOD_RENDER]: PaymentMethod;
  [EVENTS.METHOD_RENDER_ERROR]: PaymentMethod;
  [EVENTS.LOADER_CHANGE]: boolean;
  [EVENTS.START_PURCHASE]: PaymentMethod;
  [EVENTS.PURCHASE_FAILURE]: Error | unknown | undefined;
  [EVENTS.PURCHASE_COMPLETED]: void;
  [EVENTS.PURCHASE_CANCELLED]: void;
  [EVENTS.METHODS_AVAILABLE]: [PaymentMethod[]];
}

class CheckoutInstance extends EventEmitter<CheckoutEventMap> {
  id: string;
  orgId: string;
  baseUrl?: string;
  region?: string;
  checkoutConfig: CheckoutConfigWithCallbacks;
  callbacks: {
    onSuccess?: (result: PaymentResult) => void;
    onError?: (error: Error) => void;
    onStatusChange?: (
      newState: CheckoutState,
      oldState?: CheckoutState
    ) => void;
    onDestroy?: () => void;
  };
  state: CheckoutState;
  orderId: string | null;
  clientToken: string | null;
  primerWrapper: PrimerWrapper;
  isDestroyed: boolean;
  apiClient: APIClient;
  private counter: number = 0;
  private cachedSessionResponse: CachedClientSessionResponse | null = null;
  isCollectingApplePayEmail: boolean;
  cardEmailAddress?: string;
  cardCountryCode?: string;
  cardPostalCode?: string;
  private shouldApplySessionCardholderNameConfig: boolean;
  private cardSessionFieldConfig: CardSessionFieldConfig = {};
  private isTelemetryEnabled = false;
  private telemetryCleanup: (() => void) | null = null;
  private telemetryPaymentMethod?: PaymentMethod;

  constructor(config: {
    orgId: string;
    baseUrl?: string;
    region?: string;
    checkoutConfig: CheckoutConfigWithCallbacks;
  }) {
    super();
    this.id = generateId('checkout_');
    this.orgId = config.orgId;
    this.baseUrl = config.baseUrl;
    this.region = config.region;
    this.checkoutConfig = { ...config.checkoutConfig };

    this.callbacks = {
      onSuccess: this.checkoutConfig.onSuccess,
      onError: this.checkoutConfig.onError,
      onStatusChange: this.checkoutConfig.onStatusChange,
      onDestroy: this.checkoutConfig.onDestroy,
    };

    delete this.checkoutConfig?.onSuccess;
    delete this.checkoutConfig?.onError;
    delete this.checkoutConfig?.onStatusChange;
    delete this.checkoutConfig?.onDestroy;

    this.state = 'initializing';
    this.orderId = null;
    this.clientToken = null;
    this.primerWrapper = new PrimerWrapper();
    this.isDestroyed = false;
    this.cardEmailAddress = this.checkoutConfig.customer.email;
    this.shouldApplySessionCardholderNameConfig =
      this.checkoutConfig.card?.cardholderName?.required === undefined;
    this.apiClient = new APIClient({
      baseUrl: this.baseUrl || DEFAULTS.BASE_URL,
      orgId: this.orgId,
      timeout: DEFAULTS.REQUEST_TIMEOUT,
      retryAttempts: DEFAULTS.RETRY_ATTEMPTS,
    });

    this._setupCallbackBridges();
  }

  _setupCallbackBridges() {
    if (this.callbacks.onSuccess) {
      this.on(EVENTS.SUCCESS, this.callbacks.onSuccess);
    }
    if (this.callbacks.onError) {
      this.on(EVENTS.ERROR, this.callbacks.onError);
    }
    if (this.callbacks.onStatusChange) {
      this.on(EVENTS.STATUS_CHANGE, this.callbacks.onStatusChange);
    }
    if (this.callbacks.onDestroy) {
      this.on(EVENTS.DESTROY, this.callbacks.onDestroy);
    }
  }

  removeAllListeners(): this {
    return super.removeAllListeners();
  }

  async initialize(): Promise<this> {
    try {
      this.showInitializingLoader();
      this._setState('initializing');

      await this.createSession();
      await this._initializePrimerCheckout();
      this._setState('ready');
      this.startUnhandledTelemetry();
      this.checkoutConfig?.onInitialized?.();
      return this;
    } catch (error) {
      this._setState('error');
      renderError(this.checkoutConfig.container, error?.response?.req_id);
      this.emit(EVENTS.ERROR, error as Error);
      throw error;
    } finally {
      this.hideInitializingLoader();
    }
  }

  private handleInputChange = (
    inputName: keyof CardInputSelectors,
    error: string | null
  ) => {
    this.emit(EVENTS.INPUT_ERROR, { name: inputName, error });
  };

  private async createSession() {
    const response = await sessionService.createSession({
      orgId: this.orgId,
      baseUrl: this.baseUrl,
      priceId: this.checkoutConfig.priceId,
      externalId: this.checkoutConfig.customer.externalId,
      email: this.checkoutConfig.customer.email,
      region: this.region,
      clientMetadata: this.checkoutConfig.clientMetadata,
      countryCode: this.checkoutConfig.customer.countryCode,
      integration: 'primer',
    });

    const sessionResponse = response as CachedClientSessionResponse;
    if (response.data?.stripe_public_key) {
      const stripePublicKey = response.data.stripe_public_key;
      sessionResponse.radarSessionId = loadStripe(stripePublicKey)
        .then(stripe =>
          stripe
            ? stripe
                .createRadarSession()
                .then(session => session?.radarSession?.id || '')
                .catch(() => '')
            : ''
        )
        .catch(() => '');
    }
    if (response.data?.airwallex_risk_enabled) {
      const isLivemode = response.data?.is_livemode;
      const deviceId = generateUUID();
      sessionResponse.airwallexDeviceId = loadAirwallexDeviceFingerprint(
        deviceId,
        isLivemode
      )
        .then(() => deviceId)
        .catch(() => deviceId);
    }

    this.cachedSessionResponse = sessionResponse;
    this.isTelemetryEnabled = !!sessionResponse.data?.sdk_telemetry_enabled;
    this.isCollectingApplePayEmail =
      !!sessionResponse.data?.collect_apple_pay_email;
    this.applySessionCardFieldConfig(sessionResponse);

    const sessionData = this.apiClient.processSessionResponse(sessionResponse);
    this.orderId = sessionData.orderId;
    this.clientToken = sessionData.clientToken;
  }

  private applySessionCardFieldConfig(
    response: CreateClientSessionResponse
  ): void {
    const cardConfig = {
      ...(this.checkoutConfig.card || {}),
    } as BillingCardOptions;

    if (
      cardConfig.emailAddress?.visible === undefined &&
      response.data?.show_email_field !== undefined
    ) {
      cardConfig.emailAddress = {
        ...cardConfig.emailAddress,
        visible: response.data.show_email_field,
      };
    }

    if (
      this.shouldApplySessionCardholderNameConfig &&
      response.data?.show_cardholder_name_field !== undefined
    ) {
      cardConfig.cardholderName = {
        ...cardConfig.cardholderName,
        required: response.data.show_cardholder_name_field,
      };
    }

    const countryFieldOverrides = this.normalizeCountryFieldOverrides(
      response.data?.country_field_overrides
    );
    const detectedCountryCode =
      this.normalizeCountryCode(response.data?.detected_country_code) ||
      this.cardCountryCode;

    this.cardSessionFieldConfig = {
      ...this.cardSessionFieldConfig,
      showCountrySelector:
        response.data?.show_country_selector_field ??
        this.cardSessionFieldConfig.showCountrySelector,
      showPostalCode:
        response.data?.show_postal_code_field ??
        this.cardSessionFieldConfig.showPostalCode,
      detectedCountryCode:
        detectedCountryCode || this.cardSessionFieldConfig.detectedCountryCode,
      validCountries:
        response.data?.valid_countries ||
        this.cardSessionFieldConfig.validCountries,
      countryFieldOverrides:
        countryFieldOverrides ||
        this.cardSessionFieldConfig.countryFieldOverrides,
    };

    if (Object.keys(cardConfig).length > 0) {
      this.checkoutConfig.card = cardConfig;
    }

    this.cardCountryCode =
      this.cardSessionFieldConfig.detectedCountryCode || this.cardCountryCode;
    if (!this.isPostalCodeVisible()) {
      this.cardPostalCode = undefined;
    }
  }

  private getPrimerCardConfig() {
    const cardConfig = {
      ...(this.checkoutConfig.card || {}),
    } as BillingCardOptions & {
      emailAddress?: unknown;
      [key: string]: unknown;
    };
    delete cardConfig.emailAddress;
    return Object.keys(cardConfig).length
      ? (cardConfig as CheckoutOptions['card'])
      : undefined;
  }

  private getPaymentEmailAddress = () => {
    if (this.cardEmailAddress?.trim() === this.checkoutConfig.customer.email) {
      return undefined;
    }
    const email =
      this.cardEmailAddress?.trim() || this.checkoutConfig.customer.email;
    if (!email || !isValidEmail(email)) {
      return undefined;
    }
    const template = this.checkoutConfig.card?.emailAddress?.template;
    if (template?.includes('{{email}}')) {
      return template.replace(/\{\{email\}\}/g, email);
    }
    return email;
  };

  private mergeApplePayCollectingEmailOptions(
    checkoutOptions: CheckoutOptions
  ): CheckoutOptions {
    if (!this.isCollectingApplePayEmail) {
      return checkoutOptions;
    }

    const billingFields = Array.from(
      new Set([
        ...(checkoutOptions.applePay?.billingOptions
          ?.requiredBillingContactFields || []),
        ...(APPLE_PAY_COLLECTING_EMAIL_OPTIONS.billingOptions
          ?.requiredBillingContactFields || []),
      ])
    );
    const shippingFields = Array.from(
      new Set([
        ...(checkoutOptions.applePay?.shippingOptions
          ?.requiredShippingContactFields || []),
        ...(APPLE_PAY_COLLECTING_EMAIL_OPTIONS.shippingOptions
          ?.requiredShippingContactFields || []),
      ])
    );

    return merge(checkoutOptions, {
      applePay: {
        billingOptions: {
          requiredBillingContactFields: billingFields,
        },
        shippingOptions: {
          requiredShippingContactFields: shippingFields,
        },
      },
    }) as CheckoutOptions;
  }

  private handleCardInputValueChange = (
    inputName: 'emailAddress' | 'countryCode' | 'postalCode',
    value: string
  ) => {
    if (inputName === 'emailAddress') {
      this.cardEmailAddress = value?.trim() || undefined;
      return;
    }
    if (inputName === 'countryCode') {
      this.cardCountryCode = this.normalizeCountryCode(value);
      if (!this.isPostalCodeVisible()) {
        this.cardPostalCode = undefined;
      }
      return;
    }
    if (inputName === 'postalCode') {
      this.cardPostalCode = value?.trim() || undefined;
    }
  };

  private convertCardSelectorsToElements(
    selectors: CardInputSelectors,
    container: HTMLElement
  ): CardInputElementsWithButton {
    const cardNumber = container.querySelector(
      selectors.cardNumber
    ) as HTMLElement;
    const expiryDate = container.querySelector(
      selectors.expiryDate
    ) as HTMLElement;
    const cvv = container.querySelector(selectors.cvv) as HTMLElement;
    const cardholderName = selectors.cardholderName
      ? (container.querySelector(selectors.cardholderName) as HTMLInputElement)
      : undefined;
    const emailAddress = selectors.emailAddress
      ? (container.querySelector(selectors.emailAddress) as HTMLInputElement)
      : undefined;
    const button = container.querySelector(
      selectors.button
    ) as HTMLButtonElement;

    if (!cardNumber || !expiryDate || !cvv || !button) {
      throw new CheckoutError(
        'Required card input elements not found in container'
      );
    }

    return {
      cardNumber,
      expiryDate,
      cvv,
      cardholderName,
      emailAddress,
      button,
    };
  }

  private convertPaymentButtonSelectorsToElements(
    selectors: PaymentButtonSelectors
  ): PaymentButtonElements {
    const paypal = document.querySelector(selectors.paypal) as HTMLElement;
    const googlePay = document.querySelector(
      selectors.googlePay
    ) as HTMLElement;
    const applePay = document.querySelector(selectors.applePay) as HTMLElement;

    if (!paypal || !googlePay || !applePay) {
      throw new CheckoutError(
        'Required payment button elements not found in container'
      );
    }

    return {
      paypal,
      googlePay,
      applePay,
    };
  }

  async _initializePrimerCheckout() {
    // Get container element
    const containerElement = this.getContainer() as HTMLElement;
    if (!containerElement) {
      throw new CheckoutError(
        `Checkout container not found: ${this.checkoutConfig.container}`
      );
    }

    // Get selectors (either from config or default skin)
    let cardElements: CardInputElementsWithButton;
    let paymentButtonElements: PaymentButtonElements;
    let checkoutOptions: CheckoutOptions;

    if (
      !this.checkoutConfig.cardSelectors ||
      !this.checkoutConfig.paymentButtonSelectors
    ) {
      this.checkoutConfig.paymentMethodOrder =
        this.checkoutConfig.paymentMethodOrder || DEFAULT_PAYMENT_METHOD_ORDER;
      const defaultSkinCheckoutOptions =
        await this.getDefaultSkinCheckoutOptions();
      if (
        !defaultSkinCheckoutOptions.cardElements ||
        !defaultSkinCheckoutOptions.paymentButtonElements
      ) {
        throw new CheckoutError(
          'Default skin must provide cardSelectors and paymentButtonSelectors'
        );
      }
      cardElements =
        defaultSkinCheckoutOptions.cardElements as CardInputElementsWithButton;
      paymentButtonElements = defaultSkinCheckoutOptions.paymentButtonElements;
      checkoutOptions = this.getCheckoutOptions(defaultSkinCheckoutOptions);
    } else {
      if (this.checkoutConfig.paymentMethodOrder) {
        // eslint-disable-next-line no-console
        console.warn(
          'paymentMethodOrder is using only for default skin and will be ignored if you are using custom checkout'
        );
      }
      cardElements = this.convertCardSelectorsToElements(
        this.checkoutConfig.cardSelectors,
        containerElement
      );
      paymentButtonElements = this.convertPaymentButtonSelectorsToElements(
        this.checkoutConfig.paymentButtonSelectors
      );
      checkoutOptions = this.getCheckoutOptions({});
    }
    checkoutOptions = this.mergeApplePayCollectingEmailOptions(checkoutOptions);
    await this.primerWrapper.renderCheckout(
      this.clientToken as string,
      checkoutOptions,
      {
        container: containerElement,
        cardElements,
        paymentButtonElements,
        onSubmit: this.handleSubmit,
        onInputChange: this.handleInputChange,
        onCardInputValueChange: this.handleCardInputValueChange,
        isCardholderNameRequired: () => this.isCardholderNameRequired(),
        isPostalCodeRequired: () => this.isPostalCodeVisible(),
        onMethodRender: this.handleMethodRender,
        onMethodsAvailable: this.handleMethodsAvailable,
        onMethodRenderError: this.handleMethodRenderError,
      }
    );
  }

  private handleMethodRender = (method: PaymentMethod) => {
    this.emit(EVENTS.METHOD_RENDER, method);
  };

  private handleMethodRenderError = (method: PaymentMethod) => {
    this.emit(EVENTS.METHOD_RENDER_ERROR, method);
  };

  private handleSubmit = (isSubmitting: boolean) => {
    this.onLoaderChangeWithRace(isSubmitting);
    this._setState(isSubmitting ? 'processing' : 'ready');
  };

  private handleTokenizeSuccess: OnTokenizeSuccess = async (
    paymentMethodTokenData,
    primerHandler
  ) => {
    if (!this.orderId) {
      primerHandler.handleFailure(
        'Order ID not found or checkout has been destroyed'
      );
      return;
    }
    try {
      this.onLoaderChangeWithRace(true);
      this._setState('processing');
      const [radarSessionId, airwallexDeviceId] = await Promise.all([
        this.cachedSessionResponse?.radarSessionId,
        this.cachedSessionResponse?.airwallexDeviceId,
      ]);
      const paymentResponse = await this.apiClient.createPayment({
        orderId: this.orderId as string,
        paymentMethodToken: paymentMethodTokenData.token,
        email: this.getPaymentEmailAddress(),
        countryCode: this.getPaymentCountryCode(),
        postalCode: this.getPaymentPostalCode(),
        clientMetadata: {
          radarSessionId,
          airwallexDeviceId,
        },
      });
      const result = this.apiClient.processPaymentResponse(paymentResponse);
      await this._processPaymentResult(result, primerHandler);
    } catch (error: unknown) {
      this._setState('error');
      this.emit(
        EVENTS.PURCHASE_FAILURE,
        new Error((error as Error).message || 'Payment processing failed')
      );
      primerHandler.handleFailure(
        (error as Error).message || 'Payment processing failed'
      );
    } finally {
      this.onLoaderChangeWithRace(false);
      this._setState('ready');
    }
  };

  private handleResumeSuccess: OnResumeSuccess = async (
    resumeTokenData,
    primerHandler
  ) => {
    if (!this.orderId) {
      primerHandler.handleFailure(
        'Order ID not found or checkout has been destroyed'
      );
      return;
    }
    try {
      this.onLoaderChangeWithRace(true);
      this._setState('processing');
      const resumeResponse = await this.apiClient.resumePayment({
        orderId: this.orderId as string,
        resumeToken: resumeTokenData.resumeToken,
      });
      const result = this.apiClient.processPaymentResponse(resumeResponse);
      await this._processPaymentResult(result, primerHandler);
    } catch (error: unknown) {
      this._setState('error');
      this.emit(
        EVENTS.PURCHASE_FAILURE,
        new Error((error as Error).message || 'Payment processing failed')
      );
      primerHandler.handleFailure(
        (error as Error).message || 'Payment processing failed'
      );
    } finally {
      this.emit(EVENTS.PURCHASE_COMPLETED);
      this.onLoaderChangeWithRace(false);
      this._setState('ready');
    }
  };

  handleMethodsAvailable = (methods: PaymentMethod[]) => {
    this.emit(EVENTS.METHODS_AVAILABLE, methods);
  };

  async _processPaymentResult(
    result: PaymentProcessResult,
    primerHandler: OnResumeSuccessHandler | OnTokenizeSuccessHandler
  ) {
    if (result.orderId) {
      this.orderId = result.orderId;
    }

    switch (result.type) {
      case 'success':
        this._setState('completed');
        this.emit(EVENTS.SUCCESS, {
          orderId: result.orderId,
          status: result.status as
            | 'succeeded'
            | 'failed'
            | 'cancelled'
            | 'processing',
        });
        primerHandler.handleSuccess();
        break;
      case 'action_required':
        this._setState('action_required');
        this.clientToken = result.clientToken;
        primerHandler.continueWithNewClientToken(result.clientToken);
        break;
      case 'processing':
        this._setState('processing');
        setTimeout(() => {
          primerHandler.handleFailure(
            'Payment is still processing. Please check back later.'
          );
        }, 30000);
        break;
      default:
        throw new CheckoutError(`Unknown payment result type: ${result.type}`);
    }
  }

  private getCheckoutOptions(
    options: Partial<CheckoutOptions>
  ): CheckoutOptions {
    let wasPaymentProcessedStarted = false;
    const checkoutConfig = { ...this.checkoutConfig };
    delete checkoutConfig.card;
    return {
      ...checkoutConfig,
      ...options,
      card: merge(this.getPrimerCardConfig() || {}, options.card || {}),
      applePay: merge(
        this.checkoutConfig.applePay || {},
        options.applePay || {}
      ),
      onTokenizeSuccess: this.handleTokenizeSuccess,
      onResumeSuccess: this.handleResumeSuccess,
      onResumeError: error => {
        if (
          error.stack?.includes('PROCESSOR_3DS') &&
          error.code === 'RESUME_ERROR' &&
          error.message?.includes('fetch resume key')
        ) {
          // Ignore 3DS close error, because it is not understandable by user
          return;
        }
        this.emit(EVENTS.PURCHASE_FAILURE, error);
      },
      onCheckoutFail: error => {
        this.emit(EVENTS.PURCHASE_FAILURE, error);
      },
      onTokenizeError: error => {
        this.emit(EVENTS.PURCHASE_FAILURE, error);
      },
      onTokenizeStart: () => {
        wasPaymentProcessedStarted = true;
      },
      onTokenizeShouldStart: data => {
        this.emit(EVENTS.ERROR, undefined);
        this.emit(
          EVENTS.START_PURCHASE,
          data.paymentMethodType as PaymentMethod
        );
        return true;
      },
      onPaymentMethodAction: action => {
        switch (action) {
          case 'PAYMENT_METHOD_SELECTED':
            this.emit(EVENTS.ERROR, undefined);
            break;
          case 'PAYMENT_METHOD_UNSELECTED':
            if (!wasPaymentProcessedStarted) {
              this.emit(EVENTS.PURCHASE_CANCELLED);
            }
            wasPaymentProcessedStarted = false;
            break;
        }
      },
    };
  }

  async updatePrice(newPriceId: string, clientMetadata?: MetadataType) {
    this._ensureNotDestroyed();
    requireString(newPriceId, 'priceId');
    if (this.state === 'processing') {
      throw new CheckoutError(
        'Cannot update price while payment is processing'
      );
    }

    try {
      this.onLoaderChangeWithRace(true);
      this._setState('updating');
      sessionService.clearCache();
      await this.apiClient.updateClientSession({
        orderId: this.orderId,
        clientToken: this.clientToken,
        priceId: newPriceId,
        clientMetadata,
      });
      this.checkoutConfig.priceId = newPriceId;
      await this.primerWrapper.refreshClientSession();
      this.onLoaderChangeWithRace(false);
      this._setState('ready');
    } catch (error) {
      this.onLoaderChangeWithRace(false);
      this._setState('error');
      this.emit(EVENTS.ERROR, error);
      throw error;
    }
  }

  getStatus() {
    return {
      id: this.id,
      state: this.state,
      orderId: this.orderId,
      priceId: this.checkoutConfig.priceId,
      isDestroyed: this.isDestroyed,
    };
  }

  async destroy() {
    if (this.isDestroyed) return;
    try {
      this.stopUnhandledTelemetry();
      sessionService.clearCache();
      await this.primerWrapper.destroy();
      this._setState('destroyed');
      this.orderId = null;
      this.clientToken = null;
      this.isDestroyed = true;
      this.emit(EVENTS.DESTROY);
      this.removeAllListeners();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Error during checkout cleanup:', error);
    }
  }

  _setState(newState: CheckoutState) {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      this.emit(EVENTS.STATUS_CHANGE, newState, oldState);
    }
  }

  _ensureNotDestroyed() {
    if (this.isDestroyed) {
      throw new CheckoutError('Checkout instance has been destroyed');
    }
  }

  getContainer(): Element | null {
    return document.querySelector(this.checkoutConfig.container);
  }

  isInState(state: string): boolean {
    return this.state === state;
  }

  isReady(): boolean {
    return this.state === 'ready' && !this.isDestroyed;
  }

  isProcessing(): boolean {
    return ['processing', 'action_required'].includes(this.state as string);
  }

  private normalizeCountryCode(
    countryCode?: string | null
  ): string | undefined {
    const normalized = countryCode?.trim().toUpperCase();
    return normalized || undefined;
  }

  private normalizeCountryFieldOverrides(
    overrides?: CreateClientSessionResponse['data']['country_field_overrides']
  ) {
    if (!overrides) {
      return undefined;
    }

    return Object.entries(overrides).reduce<
      NonNullable<
        CreateClientSessionResponse['data']['country_field_overrides']
      >
    >((result, [countryCode, override]) => {
      const normalizedCountryCode = this.normalizeCountryCode(countryCode);
      if (normalizedCountryCode && override) {
        result[normalizedCountryCode] = override;
      }
      return result;
    }, {});
  }

  private getSelectedCountryCode(): string | undefined {
    return (
      this.normalizeCountryCode(this.cardCountryCode) ||
      this.normalizeCountryCode(this.cardSessionFieldConfig.detectedCountryCode)
    );
  }

  private getCountryFieldOverride(countryCode = this.getSelectedCountryCode()) {
    if (!countryCode) {
      return undefined;
    }

    return this.cardSessionFieldConfig.countryFieldOverrides?.[countryCode];
  }

  private isCardholderNameRequired() {
    return !!this.checkoutConfig.card?.cardholderName?.required;
  }

  private isPostalCodeVisible(countryCode = this.getSelectedCountryCode()) {
    const defaultValue = !!this.cardSessionFieldConfig.showPostalCode;
    const overrideValue =
      this.getCountryFieldOverride(countryCode)?.show_postal_code;

    if (overrideValue === null || overrideValue === undefined) {
      return defaultValue;
    }

    return overrideValue;
  }

  private getPaymentCountryCode(): string | undefined {
    return this.getSelectedCountryCode();
  }

  private getPaymentPostalCode(): string | undefined {
    if (!this.isPostalCodeVisible()) {
      return undefined;
    }

    return this.cardPostalCode?.trim() || undefined;
  }

  // Creates containers to render hosted inputs with labels and error messages,
  // a card holder input with label and error, and a submit button.
  private async getDefaultSkinCheckoutOptions() {
    const skinFactory = (await import('./skins/default'))
      .default as SkinFactory;
    const skin: Skin = await skinFactory(
      this.checkoutConfig,
      this.cardSessionFieldConfig
    );

    this.on(EVENTS.INPUT_ERROR, skin.onInputError);
    this.on(EVENTS.STATUS_CHANGE, skin.onStatusChange);

    this.on(EVENTS.ERROR, (error: Error) => skin.onError(error));
    this.on(EVENTS.LOADER_CHANGE, skin.onLoaderChange);
    this.on(EVENTS.DESTROY, skin.onDestroy);
    this.on(EVENTS.SUCCESS, skin.onSuccess);
    this.on(EVENTS.START_PURCHASE, skin.onStartPurchase);
    this.on(EVENTS.PURCHASE_FAILURE, skin.onPurchaseFailure);
    this.on(EVENTS.PURCHASE_COMPLETED, skin.onPurchaseCompleted);
    this.on(EVENTS.METHODS_AVAILABLE, skin.onMethodsAvailable);
    this.on(EVENTS.METHODS_AVAILABLE, this.hideInitializingLoader);
    return skin.getCheckoutOptions();
  }
  private async getCardDefaultSkinCheckoutOptions(node: HTMLElement) {
    const CardSkin = (await import('./skins/card')).default;
    const skin: Skin = new CardSkin(
      node,
      this.checkoutConfig,
      this.cardSessionFieldConfig
    );
    skin.init();
    this.on(EVENTS.INPUT_ERROR, skin.onInputError);
    this.on(EVENTS.METHOD_RENDER, skin.onMethodRender);
    this.on(EVENTS.SUCCESS, skin.onDestroy);
    this.on(EVENTS.DESTROY, skin.onDestroy);
    return skin.getCheckoutOptions();
  }
  private onLoaderChangeWithRace = (state: boolean) => {
    const isLoading = !!(state ? ++this.counter : --this.counter);
    this.primerWrapper.disableButtons(isLoading);
    this.emit(EVENTS.LOADER_CHANGE, isLoading);
  };
  showInitializingLoader() {
    renderLoader(this.checkoutConfig.container);
  }
  hideInitializingLoader() {
    hideLoader();
  }

  async initMethod(
    method: PaymentMethod,
    element: HTMLElement,
    callbacks: InitMethodCallbacks
  ) {
    this._ensureNotDestroyed();
    if (!this.isReady()) {
      await this.createSession();
    }

    if (callbacks.onRenderSuccess) {
      this.on(EVENTS.METHOD_RENDER, callbacks.onRenderSuccess);
    }
    if (callbacks.onRenderError) {
      this.on(EVENTS.METHOD_RENDER_ERROR, callbacks.onRenderError);
    }
    if (callbacks.onLoaderChange) {
      this.on(EVENTS.LOADER_CHANGE, callbacks.onLoaderChange);
    }
    if (callbacks.onPaymentSuccess) {
      this.on(EVENTS.SUCCESS, callbacks.onPaymentSuccess);
    }
    if (callbacks.onPaymentFail) {
      this.on(EVENTS.PURCHASE_FAILURE, callbacks.onPaymentFail);
    }
    if (callbacks.onPaymentCancel) {
      this.on(EVENTS.PURCHASE_CANCELLED, callbacks.onPaymentCancel);
    }
    if (callbacks.onErrorMessageChange) {
      this.on(EVENTS.ERROR, callbacks.onErrorMessageChange);
    }
    if (callbacks.onPaymentStarted) {
      this.on(EVENTS.START_PURCHASE, callbacks.onPaymentStarted);
    }
    if (callbacks.onMethodsAvailable) {
      this.on(EVENTS.METHODS_AVAILABLE, callbacks.onMethodsAvailable);
    }
    let checkoutOptions: CheckoutOptions =
      this.mergeApplePayCollectingEmailOptions(this.getCheckoutOptions({}));
    let methodOptions: CheckoutRenderOptions = {
      onMethodRender: this.handleMethodRender,
      onMethodRenderError: this.handleMethodRenderError,
    };

    if (method === PaymentMethod.PAYMENT_CARD) {
      const cardDefaultOptions =
        await this.getCardDefaultSkinCheckoutOptions(element);
      checkoutOptions = this.getCheckoutOptions({
        ...cardDefaultOptions,
      });
      methodOptions = {
        cardElements: cardDefaultOptions.cardElements,
        onSubmit: this.handleSubmit,
        onInputChange: this.handleInputChange,
        onCardInputValueChange: this.handleCardInputValueChange,
        isCardholderNameRequired: () => this.isCardholderNameRequired(),
        isPostalCodeRequired: () => this.isPostalCodeVisible(),
        onMethodRender: this.handleMethodRender,
        onMethodRenderError: this.handleMethodRenderError,
      };
    }

    await this.primerWrapper.initializeHeadlessCheckout(
      this.clientToken as string,
      checkoutOptions,
      method
    );
    const methodInterface = await this.primerWrapper.initMethod(
      method,
      element,
      methodOptions
    );
    this.startUnhandledTelemetry(method);
    return {
      ...methodInterface,
      destroy: async () => {
        await methodInterface.destroy();
        await this.destroy();
      },
    };
  }

  private startUnhandledTelemetry(paymentMethod?: PaymentMethod): void {
    if (paymentMethod) {
      this.telemetryPaymentMethod = paymentMethod;
    }

    if (!this.isTelemetryEnabled || this.telemetryCleanup) {
      return;
    }

    this.telemetryCleanup = startUnhandledErrorTelemetry({
      id: this.id,
      orgId: this.orgId,
      baseUrl: this.baseUrl,
      enabled: this.isTelemetryEnabled,
      getContext: () => ({
        checkoutId: this.id,
        orderId: this.orderId,
        priceId: this.checkoutConfig.priceId,
        state: this.state,
        paymentMethod: this.telemetryPaymentMethod,
        reqId: this.cachedSessionResponse?.req_id,
      }),
    });
  }

  private stopUnhandledTelemetry(): void {
    this.telemetryCleanup?.();
    this.telemetryCleanup = null;
    this.telemetryPaymentMethod = undefined;
  }
}

export default CheckoutInstance;
