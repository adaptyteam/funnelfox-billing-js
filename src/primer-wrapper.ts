/**
 * @fileoverview Primer SDK integration wrapper
 */

import type {
  Primer,
  HeadlessUniversalCheckoutOptions,
  OnResumeSuccess,
  OnTokenizeSuccess,
  OnTokenizeSuccessHandler,
  PaymentMethodInfo,
  PaymentMethodToken,
  IHeadlessPaymentMethodButton,
  PrimerHeadlessCheckout,
  EventTypes,
  InputMetadata,
} from '@primer-io/checkout-web';
import { PrimerError } from './errors';
import { merge } from './utils/helpers';
import { loadPrimerSDK } from './utils/primer-loader';
import { ALLOWED_PAYMENT_METHODS, inputStyle } from './constants';
import {
  CardInputSelectors,
  CheckoutOptions,
  PaymentMethodInterface,
  PrimerWrapperInterface,
  CheckoutRenderOptions,
  CardInputElementsWithButton,
} from './types';
import { PaymentMethod } from './enums';

declare global {
  interface Window {
    Primer?: typeof Primer;
  }
}
class PrimerWrapper implements PrimerWrapperInterface {
  isInitialized: boolean = false;
  private destroyCallbacks: (() => void)[] = [];
  private static headless: Promise<PrimerHeadlessCheckout> | null = null;
  private availableMethods: PaymentMethod[] = [];
  private paymentMethodsInterfaces?: PaymentMethodInterface[] = [];

  isPrimerAvailable(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.Primer &&
      typeof window.Primer?.createHeadless === 'function'
    );
  }

  /**
   * Loads Primer SDK if not already available
   * @param version - Optional version to load (uses default if not specified)
   */
  async ensurePrimerLoaded(version?: string): Promise<void> {
    if (this.isPrimerAvailable()) {
      return;
    }

    try {
      await loadPrimerSDK(version);
    } catch (error) {
      throw new PrimerError('Failed to load Primer SDK', error);
    }
  }

  ensurePrimerAvailable() {
    if (!this.isPrimerAvailable()) {
      throw new PrimerError(
        'Primer SDK not found. Please include the Primer SDK script before initializing FunnefoxSDK.'
      );
    }
  }

  private async createHeadlessCheckout(
    clientToken: string,
    options: Partial<HeadlessUniversalCheckoutOptions> & {
      onTokenizeSuccess: OnTokenizeSuccess;
      onResumeSuccess: OnResumeSuccess;
    }
  ) {
    if (PrimerWrapper.headless) {
      return PrimerWrapper.headless;
    }

    // Load Primer SDK if not already available
    await this.ensurePrimerLoaded();
    const primerOptions = merge<HeadlessUniversalCheckoutOptions>(
      {
        paymentHandling: 'MANUAL',
        apiVersion: '2.4',
      },
      options
    );
    try {
      PrimerWrapper.headless = window.Primer.createHeadless(
        clientToken,
        primerOptions
      ).then(async headlessPromise => {
        const headless = await headlessPromise;
        await headless.start();
        return headless;
      });
      return await PrimerWrapper.headless;
    } catch (error: unknown) {
      throw new PrimerError('Failed to create Primer headless checkout', error);
    }
  }

  disableButtons(disabled: boolean) {
    if (!this.paymentMethodsInterfaces) return;
    for (const paymentMethodInterface of this.paymentMethodsInterfaces) {
      paymentMethodInterface.setDisabled(disabled);
    }
  }

  async renderButton(
    allowedPaymentMethod:
      | PaymentMethod.GOOGLE_PAY
      | PaymentMethod.APPLE_PAY
      | PaymentMethod.PAYPAL,
    {
      htmlNode,
      onMethodRenderError,
      onMethodRender,
    }: {
      htmlNode: HTMLElement;
      onMethodRenderError: (method: PaymentMethod) => void;
      onMethodRender: (method: PaymentMethod) => void;
    }
  ): Promise<PaymentMethodInterface> {
    let button: IHeadlessPaymentMethodButton;
    // Ensure Primer SDK is loaded
    await this.ensurePrimerLoaded();
    if (!PrimerWrapper.headless) {
      throw new PrimerError('Headless checkout not found');
    }
    try {
      const headless = await PrimerWrapper.headless;
      const pmManager =
        await headless.createPaymentMethodManager(allowedPaymentMethod);
      if (!pmManager) {
        throw new Error('Payment method manager is not available');
      }
      button = pmManager.createButton();
      await button.render(htmlNode, {});
      this.destroyCallbacks.push(() => button.clean());
      onMethodRender(allowedPaymentMethod);
      return {
        setDisabled: (disabled: boolean) => {
          button.setDisabled(disabled);
        },
        destroy: () => button.clean(),
      };
    } catch (error: unknown) {
      onMethodRenderError(allowedPaymentMethod);
      throw new PrimerError('Failed to initialize Primer checkout', error);
    }
  }

  async initMethod(
    method: PaymentMethod,
    htmlNode: HTMLElement,
    options: CheckoutRenderOptions
  ): Promise<PaymentMethodInterface> {
    try {
      if (method === PaymentMethod.PAYMENT_CARD) {
        if (
          !options.cardElements ||
          !options.onSubmit ||
          !options.onInputChange
        ) {
          throw new PrimerError(
            'Card elements, onSubmit, and onInputChange are required for PAYMENT_CARD method'
          );
        }

        const cardInterface = await this.renderCardCheckoutWithElements(
          options.cardElements as CardInputElementsWithButton,
          {
            onSubmit: options.onSubmit,
            onInputChange: options.onInputChange,
            onMethodRenderError: options.onMethodRenderError,
            onMethodRender: options.onMethodRender,
          }
        );
        this.paymentMethodsInterfaces.push(cardInterface);
        return cardInterface;
      } else {
        const buttonInterface = await this.renderButton(method, {
          htmlNode,
          onMethodRenderError: options.onMethodRenderError,
          onMethodRender: options.onMethodRender,
        });
        this.paymentMethodsInterfaces.push(buttonInterface);
        return buttonInterface;
      }
    } catch (error: unknown) {
      throw new PrimerError('Failed to initialize Primer checkout', error);
    }
  }

  private async renderCardCheckoutWithElements(
    elements: CardInputElementsWithButton,
    {
      onSubmit,
      onInputChange,

      onMethodRenderError,
      onMethodRender,
    }: CheckoutRenderOptions
  ): Promise<PaymentMethodInterface> {
    try {
      const headless = await PrimerWrapper.headless;
      const pmManager =
        await headless.createPaymentMethodManager('PAYMENT_CARD');
      if (!pmManager) {
        throw new Error('Payment method manager is not available');
      }

      const { cardNumberInput, expiryInput, cvvInput } =
        pmManager.createHostedInputs();

      const validateForm = async () => {
        if (!pmManager) return false;

        const { valid, validationErrors } = await pmManager.validate();
        const cardHolderError = validationErrors.find(
          v => v.name === 'cardholderName'
        );
        dispatchError('cardholderName', cardHolderError?.message || null);
        return valid;
      };
      const dispatchError = (
        inputName: keyof CardInputSelectors,
        error: string | null
      ) => {
        onInputChange(inputName, error);
      };

      const onHostedInputChange =
        (name: keyof CardInputSelectors) => (event: Event) => {
          const input = event as unknown as InputMetadata;
          if (input.submitted) {
            dispatchError(name, input.error);
          }
        };

      const cardHolderOnChange = async (e: Event) => {
        pmManager.setCardholderName((e.target as HTMLInputElement).value);
        dispatchError('cardholderName', null);
      };

      elements.cardholderName?.addEventListener('input', cardHolderOnChange);
      cardNumberInput.addEventListener(
        'change' as EventTypes,
        onHostedInputChange('cardNumber')
      );
      expiryInput.addEventListener(
        'change' as EventTypes,
        onHostedInputChange('expiryDate')
      );
      cvvInput.addEventListener(
        'change' as EventTypes,
        onHostedInputChange('cvv')
      );

      const onSubmitHandler = async () => {
        if (!(await validateForm())) {
          return;
        }
        try {
          onSubmit(true);
          await pmManager.submit();
        } catch (error: unknown) {
          const primerError = new PrimerError(
            'Failed to submit payment',
            error
          );
          throw primerError;
        } finally {
          onSubmit(false);
        }
      };

      elements.button?.addEventListener('click', onSubmitHandler);

      await Promise.all([
        cardNumberInput.render(elements.cardNumber, {
          placeholder: '1234 1234 1234 1234',
          ariaLabel: 'Card number',
          style: inputStyle,
        }),
        expiryInput.render(elements.expiryDate, {
          placeholder: 'MM/YY',
          ariaLabel: 'Expiry date',
          style: inputStyle,
        }),
        cvvInput.render(elements.cvv, {
          placeholder: '123',
          ariaLabel: 'CVV',
          style: inputStyle,
        }),
      ]);
      const onDestroy = () => {
        pmManager.removeHostedInputs();
        elements.cardholderName?.removeEventListener(
          'change',
          cardHolderOnChange
        );
        elements.button?.removeEventListener('click', onSubmitHandler);
      };
      this.destroyCallbacks.push(onDestroy);
      onMethodRender(PaymentMethod.PAYMENT_CARD);
      return {
        setDisabled: (disabled: boolean) => {
          cardNumberInput.setDisabled(disabled);
          expiryInput.setDisabled(disabled);
          cvvInput.setDisabled(disabled);
          if (elements.button) {
            elements.button.disabled = disabled;
          }
          if (elements.cardholderName) {
            elements.cardholderName.disabled = disabled;
          }
        },
        submit: () => onSubmitHandler(),
        destroy: () => {
          this.destroyCallbacks = this.destroyCallbacks.filter(
            callback => callback !== onDestroy
          );
          onDestroy();
        },
      };
    } catch (error: unknown) {
      onMethodRenderError(PaymentMethod.PAYMENT_CARD);
      throw new PrimerError('Failed to initialize Primer checkout', error);
    }
  }

  async initializeHeadlessCheckout(
    clientToken: string,
    primerOptions: CheckoutOptions
  ) {
    await this.createHeadlessCheckout(clientToken, {
      ...primerOptions,
      onTokenizeSuccess: this.wrapTokenizeHandler(
        primerOptions.onTokenizeSuccess
      ),
      onResumeSuccess: this.wrapResumeHandler(primerOptions.onResumeSuccess),
      onAvailablePaymentMethodsLoad: (items: PaymentMethodInfo[]) => {
        let isApplePayAvailable = false;
        this.availableMethods = ALLOWED_PAYMENT_METHODS.filter(method => {
          return items.some((item: PaymentMethodInfo) => {
            if (item.type === PaymentMethod.APPLE_PAY) {
              isApplePayAvailable = true;
            }
            return item.type === method;
          });
        });
        if (isApplePayAvailable) {
          this.availableMethods = this.availableMethods.filter(
            method => method !== PaymentMethod.GOOGLE_PAY
          );
        }
        if (this.availableMethods.length === 0) {
          throw new PrimerError('No allowed payment methods found');
        }
      },
    });
  }

  async renderCheckout(
    clientToken: string,
    checkoutOptions: CheckoutOptions,
    checkoutRenderOptions: CheckoutRenderOptions
  ) {
    const {
      cardElements,
      paymentButtonElements,
      container,
      onSubmit,
      onInputChange,
      onMethodRender,
      onMethodRenderError,
      onMethodsAvailable,
    } = checkoutRenderOptions;
    await this.initializeHeadlessCheckout(clientToken, checkoutOptions);
    onMethodsAvailable?.(this.availableMethods);
    await Promise.all(
      this.availableMethods.map(method => {
        if (method === PaymentMethod.PAYMENT_CARD) {
          // For card, use the main container
          return this.initMethod(method, container, {
            cardElements,
            onSubmit,
            onInputChange,
            onMethodRender,
            onMethodRenderError,
          });
        } else {
          const buttonElementsMap = {
            [PaymentMethod.PAYPAL]: paymentButtonElements.paypal,
            [PaymentMethod.GOOGLE_PAY]: paymentButtonElements.googlePay,
            [PaymentMethod.APPLE_PAY]: paymentButtonElements.applePay,
          };
          // For buttons, use the specific button container element
          const buttonElement = buttonElementsMap[method];
          return this.initMethod(method, buttonElement, {
            onMethodRender,
            onMethodRenderError,
          });
        }
      })
    );
    this.isInitialized = true;
  }

  private wrapTokenizeHandler(handler: OnTokenizeSuccess): OnTokenizeSuccess {
    return async (
      paymentMethodTokenData: PaymentMethodToken,
      primerHandler: OnTokenizeSuccessHandler
    ) => {
      try {
        await handler(paymentMethodTokenData, primerHandler);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error in tokenize handler:', error);
        primerHandler.handleFailure(
          'Payment processing failed. Please try again.'
        );
      }
    };
  }

  private wrapResumeHandler(handler: OnResumeSuccess): OnResumeSuccess {
    return async (resumeTokenData, primerHandler) => {
      try {
        await handler(resumeTokenData, primerHandler);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error in resume handler:', error);
        primerHandler.handleFailure(
          'Payment processing failed. Please try again.'
        );
      }
    };
  }

  async destroy() {
    if (this.destroyCallbacks) {
      try {
        Promise.all(this.destroyCallbacks.map(destroy => destroy()));
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Error destroying Primer checkout:', error);
      }
    }
    this.destroyCallbacks = [];
    this.isInitialized = false;
  }

  createHandlers(handlers: {
    onSuccess?: () => void;
    onError?: (e: Error) => void;
    onActionRequired?: (token: string) => void;
  }) {
    return {
      handleSuccess: () => {
        if (handlers.onSuccess) handlers.onSuccess();
      },
      handleFailure: (message: string) => {
        if (handlers.onError) handlers.onError(new Error(message));
      },
      continueWithNewClientToken: (newClientToken: string) => {
        if (handlers.onActionRequired)
          handlers.onActionRequired(newClientToken);
      },
    };
  }

  getCurrentCheckout() {
    return this.destroyCallbacks;
  }

  isActive(): boolean {
    return this.isInitialized && this.destroyCallbacks.length > 0;
  }

  validateContainer(selector: string) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new PrimerError(`Checkout container not found: ${selector}`);
    }
    const computedStyle = window.getComputedStyle(element as Element);
    if (computedStyle.display === 'none') {
      // eslint-disable-next-line no-console
      console.warn(
        'Checkout container is hidden, this may cause display issues'
      );
    }
    return element;
  }
}

export default PrimerWrapper;
