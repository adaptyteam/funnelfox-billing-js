/**
 * @fileoverview Checkout instance manager for Funnefox SDK
 */

import EventEmitter from './utils/event-emitter';
import PrimerWrapper from './primer-wrapper';
import { CheckoutError } from './errors';
import { requireString } from './utils/validation';
import { generateId } from './utils/helpers';
import APIClient from './api-client';
import { DEFAULTS, EVENTS } from './constants';
import {
  type CheckoutConfigWithCallbacks,
  type PaymentResult,
  type CheckoutState,
  CardInputSelectors,
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
import type { Skin, SkinFactory } from './skins/types';
import { renderLoader, hideLoader } from './assets/loader/loader';

interface CheckoutEventMap {
  [EVENTS.SUCCESS]: PaymentResult;
  [EVENTS.ERROR]:
    | [Error | unknown | undefined]
    | [Error | unknown | undefined, PaymentMethod];
  [EVENTS.STATUS_CHANGE]: [CheckoutState, CheckoutState];
  [EVENTS.DESTROY]: void;
  [EVENTS.INPUT_ERROR]: { name: keyof CardInputSelectors; error: string };
  [EVENTS.METHOD_RENDER]: PaymentMethod;
  [EVENTS.LOADER_CHANGE]: boolean;
  [EVENTS.START_PURCHASE]: PaymentMethod;
  [EVENTS.PURCHASE_FAILURE]: Error | unknown | undefined;
  [EVENTS.PURCHASE_COMPLETED]: void;
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

      this.apiClient = new APIClient({
        baseUrl: this.baseUrl || DEFAULTS.BASE_URL,
        orgId: this.orgId,
        timeout: DEFAULTS.REQUEST_TIMEOUT,
        retryAttempts: DEFAULTS.RETRY_ATTEMPTS,
      });

      const sessionResponse = await this.apiClient.createClientSession({
        priceId: this.checkoutConfig.priceId,
        externalId: this.checkoutConfig.customer.externalId,
        email: this.checkoutConfig.customer.email,
        region: this.region || DEFAULTS.REGION,
        clientMetadata: this.checkoutConfig.clientMetadata,
        countryCode: this.checkoutConfig.customer.countryCode,
      });

      const sessionData =
        this.apiClient.processSessionResponse(sessionResponse);
      this.orderId = sessionData.orderId;
      this.clientToken = sessionData.clientToken;
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

  async _initializePrimerCheckout() {
    const checkoutOptions: Partial<
      Pick<CheckoutOptions, 'cardSelectors' | 'paymentButtonSelectors'>
    > &
      Omit<CheckoutOptions, 'cardSelectors' | 'paymentButtonSelectors'> = {
      ...this.checkoutConfig,
      onTokenizeSuccess: this.handleTokenizeSuccess,
      onResumeSuccess: this.handleResumeSuccess,
      onSubmit: this.handleSubmit,
      onInputChange: this.handleInputChange,
      onMethodRender: this.handleMethodRender,
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
    };

    if (
      !this.checkoutConfig.cardSelectors ||
      !this.checkoutConfig.paymentButtonSelectors
    ) {
      const defaultSkinCheckoutOptions =
        await this.getDefaultSkinCheckoutOptions();
      Object.assign(checkoutOptions, defaultSkinCheckoutOptions);
    }

    await this.primerWrapper.renderCheckout(
      this.clientToken as string,
      checkoutOptions as CheckoutOptions
    );
  }

  private handleMethodRender = (method: PaymentMethod) => {
    this.emit(EVENTS.METHOD_RENDER, method);
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
      await this.apiClient.updateClientSession({
        orderId: this.orderId as string,
        clientToken: this.clientToken as string,
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
      this.checkoutConfig.container
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
