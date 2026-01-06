/**
 * @fileoverview Checkout instance manager for Funnefox SDK
 */

import EventEmitter from './utils/event-emitter';
import PrimerWrapper from './primer-wrapper';
import { CheckoutError } from './errors';
import { requireString } from './utils/validation';
import { generateId } from './utils/helpers';
import APIClient from './api-client';
import { DEFAULT_PAYMENT_METHOD_ORDER, DEFAULTS, EVENTS } from './constants';
import {
  type CheckoutConfigWithCallbacks,
  type PaymentResult,
  type CheckoutState,
  CardInputSelectors,
  CardInputElements,
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
import type {
  CardInputElementsWithButton,
  Skin,
  SkinFactory,
} from './skins/types';
import { renderLoader, hideLoader } from './assets/loader/loader';
import type { CreateClientSessionResponse } from './types';

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
  apiClient!: APIClient;
  private counter: number = 0;
  private static sessionCache = new Map<string, CreateClientSessionResponse>();

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
      this.checkoutConfig?.onInitialized?.();
      return this;
    } catch (error) {
      this._setState('error');
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
    this.apiClient = new APIClient({
      baseUrl: this.baseUrl || DEFAULTS.BASE_URL,
      orgId: this.orgId,
      timeout: DEFAULTS.REQUEST_TIMEOUT,
      retryAttempts: DEFAULTS.RETRY_ATTEMPTS,
    });

    const sessionParams = {
      priceId: this.checkoutConfig.priceId,
      externalId: this.checkoutConfig.customer.externalId,
      email: this.checkoutConfig.customer.email,
      region: this.region || DEFAULTS.REGION,
      clientMetadata: this.checkoutConfig.clientMetadata,
      countryCode: this.checkoutConfig.customer.countryCode,
    };
    const cacheKey = [
      this.orgId,
      this.checkoutConfig.priceId,
      this.checkoutConfig.customer.externalId,
      this.checkoutConfig.customer.email,
    ].join('-');

    let sessionResponse: CreateClientSessionResponse;

    // Return cached response if payload hasn't changed
    const cachedResponse = CheckoutInstance.sessionCache.get(cacheKey);
    if (cachedResponse) {
      sessionResponse = cachedResponse;
    } else {
      sessionResponse = await this.apiClient.createClientSession(sessionParams);
      // Cache the successful response
      CheckoutInstance.sessionCache.set(cacheKey, sessionResponse);
    }

    const sessionData = this.apiClient.processSessionResponse(sessionResponse);
    this.orderId = sessionData.orderId;
    this.clientToken = sessionData.clientToken;
  }

  private convertCardSelectorsToElements(
    selectors: CardInputSelectors,
    container: HTMLElement
  ): CardInputElements {
    const cardNumber = container.querySelector(
      selectors.cardNumber
    ) as HTMLElement;
    const expiryDate = container.querySelector(
      selectors.expiryDate
    ) as HTMLElement;
    const cvv = container.querySelector(selectors.cvv) as HTMLElement;
    const cardholderName = container.querySelector(
      selectors.cardholderName
    ) as HTMLElement;
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
      cardElements = this.convertCardSelectorsToElements(
        this.checkoutConfig.cardSelectors,
        containerElement
      );
      paymentButtonElements = this.convertPaymentButtonSelectorsToElements(
        this.checkoutConfig.paymentButtonSelectors
      );
      checkoutOptions = this.getCheckoutOptions({});
    }
    if (this.checkoutConfig.paymentMethodOrder) {
      // eslint-disable-next-line no-console
      console.warn(
        'paymentMethodOrder is using only for default skin and will be ignored if you are using custom checkout'
      );
    }
    await this.primerWrapper.renderCheckout(
      this.clientToken as string,
      checkoutOptions,
      {
        container: containerElement,
        cardElements,
        paymentButtonElements,
        onSubmit: this.handleSubmit,
        onInputChange: this.handleInputChange,
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
    try {
      this.onLoaderChangeWithRace(true);
      this._setState('processing');
      const paymentResponse = await this.apiClient.createPayment({
        orderId: this.orderId as string,
        paymentMethodToken: paymentMethodTokenData.token,
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
    return {
      ...this.checkoutConfig,
      ...options,
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

  async updatePrice(newPriceId: string) {
    this._ensureNotDestroyed();
    requireString(newPriceId, 'priceId');
    if (this.state === 'processing') {
      throw new CheckoutError(
        'Cannot update price while payment is processing'
      );
    }

    try {
      this._setState('updating');
      // Invalidate session cache
      CheckoutInstance.sessionCache.clear();
      await this.apiClient.updateClientSession({
        orderId: this.orderId,
        clientToken: this.clientToken,
        priceId: newPriceId,
      });
      this.checkoutConfig.priceId = newPriceId;
      this._setState('ready');
    } catch (error) {
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

  // Creates containers to render hosted inputs with labels and error messages,
  // a card holder input with label and error, and a submit button.
  private async getDefaultSkinCheckoutOptions() {
    const skinFactory = (await import('./skins/default'))
      .default as SkinFactory;
    const skin: Skin = await skinFactory(
      this.primerWrapper,
      this.checkoutConfig
    );

    this.on(EVENTS.INPUT_ERROR, skin.onInputError);
    this.on(EVENTS.STATUS_CHANGE, skin.onStatusChange);

    this.on(EVENTS.ERROR, (error: Error) => skin.onError(error));
    this.on(EVENTS.LOADER_CHANGE, skin.onLoaderChange);
    this.on(EVENTS.DESTROY, skin.onDestroy);
    this.on(EVENTS.METHOD_RENDER, skin.onMethodRender);
    this.on(EVENTS.SUCCESS, skin.onSuccess);
    this.on(EVENTS.START_PURCHASE, skin.onStartPurchase);
    this.on(EVENTS.PURCHASE_FAILURE, skin.onPurchaseFailure);
    this.on(EVENTS.PURCHASE_COMPLETED, skin.onPurchaseCompleted);
    this.on(EVENTS.METHODS_AVAILABLE, skin.onMethodsAvailable);
    return skin.getCheckoutOptions();
  }
  private async getCardDefaultSkinCheckoutOptions(node: HTMLElement) {
    const CardSkin = (await import('./skins/card')).default;
    const skin: Skin = new CardSkin(node, this.checkoutConfig);
    skin.init();
    this.on(EVENTS.INPUT_ERROR, skin.onInputError);
    return skin.getCheckoutOptions();
  }
  private onLoaderChangeWithRace = (state: boolean) => {
    const isLoading = !!(state ? ++this.counter : --this.counter);

    this.emit(EVENTS.LOADER_CHANGE, isLoading);
  };
  showInitializingLoader() {
    renderLoader(this.checkoutConfig.container);
  }
  hideInitializingLoader() {
    hideLoader();
  }
}

export default CheckoutInstance;
