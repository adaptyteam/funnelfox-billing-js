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
  PaymentFlow,
  PrimerHeadlessCheckout,
  EventTypes,
  InputMetadata,
} from '@primer-io/checkout-web';
import { PrimerError } from './errors';
import { merge } from './utils/helpers';
import { ALLOWED_PAYMENT_METHODS, inputStyle } from './constants';
import {
  CardInputSelectors,
  CheckoutOptions,
  PaymentMethodInterface,
  PrimerWrapperInterface,
  CheckoutRenderOptions,
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
  private headless: PrimerHeadlessCheckout | null = null;
  private availableMethods: PaymentMethod[] = [];
  private paymentMethodsInterfaces?: {
    [key in PaymentMethod]: PaymentMethodInterface;
  };

  isPrimerAvailable(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.Primer &&
      typeof window.Primer?.createHeadless === 'function'
    );
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
    if (this.headless) {
      return this.headless;
    }

    this.ensurePrimerAvailable();
    const primerOptions = merge<HeadlessUniversalCheckoutOptions>(
      {
        paymentHandling: 'MANUAL',
        apiVersion: '2.4',
      },
      options
    );
    try {
      const headless = await window.Primer.createHeadless(
        clientToken,
        primerOptions
      );
      await headless.start();
      this.headless = headless;
    } catch (error: unknown) {
      throw new PrimerError('Failed to create Primer headless checkout', error);
    }
  }

  initializeCardElements(selectors: CardInputSelectors) {
    const { cardNumber, expiryDate, cvv, cardholderName, button } = selectors;

    return {
      cardNumber: document.querySelector(cardNumber),
      expiryDate: document.querySelector(expiryDate),
      cvv: document.querySelector(cvv),
      cardholderName: document.querySelector(cardholderName),
      button: document.querySelector(button) as HTMLButtonElement,
    };
  }

  disableButtons(disabled: boolean) {
    if (!this.paymentMethodsInterfaces) return;
    for (const method in this.paymentMethodsInterfaces) {
      this.paymentMethodsInterfaces[method as PaymentMethod].setDisabled(
        disabled
      );
    }
  }

  async renderButton(
    allowedPaymentMethod: 'GOOGLE_PAY' | 'APPLE_PAY' | 'PAYPAL',
    {
      container,
    }: {
      container: string;
    }
  ) {
    const containerEl = this.validateContainer(container);
    let button: IHeadlessPaymentMethodButton;
    this.ensurePrimerAvailable();
    if (!this.headless) {
      throw new PrimerError('Headless checkout not found');
    }
    try {
      const pmManager =
        await this.headless.createPaymentMethodManager(allowedPaymentMethod);
      if (!pmManager) {
        throw new Error('Payment method manager is not available');
      }
      button = pmManager.createButton();
      await button.render(containerEl, {});
      this.destroyCallbacks.push(() => button.clean());
    } catch (error: unknown) {
      throw new PrimerError('Failed to initialize Primer checkout', error);
    }
  }

  async initMethod(
    method: PaymentMethod,
    htmlNode: HTMLElement,
    options: CheckoutRenderOptions
  ): Promise<PaymentMethodInterface | void> {
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

      return this.renderCardCheckoutWithElements(options.cardElements, {
        onSubmit: options.onSubmit,
        onInputChange: options.onInputChange,
        onMethodRenderError: options.onMethodRenderError,
        onMethodRender: options.onMethodRender,
      });
    } else {
      // For button methods, render directly into htmlNode
      this.ensurePrimerAvailable();
      if (!this.headless) {
        throw new PrimerError('Headless checkout not found');
      }
      try {
        const pmManager = await this.headless.createPaymentMethodManager(
          method as 'GOOGLE_PAY' | 'APPLE_PAY' | 'PAYPAL'
        );
        if (!pmManager) {
          throw new Error('Payment method manager is not available');
        }
        const button = pmManager.createButton();
        await button.render(htmlNode, {});
        this.destroyCallbacks.push(() => button.clean());
        options.onMethodRender(method);
      } catch (error: unknown) {
        options.onMethodRenderError(method);
        throw new PrimerError('Failed to initialize Primer checkout', error);
      }
    }
  }

  private async renderCardCheckoutWithElements(
    elements: {
      cardNumber: HTMLElement;
      expiryDate: HTMLElement;
      cvv: HTMLElement;
      cardholderName: HTMLElement;
      button: HTMLButtonElement;
    },
    {
      onSubmit,
      onInputChange,

      onMethodRenderError,
      onMethodRender,
    }: CheckoutRenderOptions
  ): Promise<PaymentMethodInterface> {
    try {
      const pmManager =
        await this.headless.createPaymentMethodManager('PAYMENT_CARD');
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
        elements.cardholderName.removeEventListener(
          'change',
          cardHolderOnChange
        );
        elements.button.removeEventListener('click', onSubmitHandler);
      };
      this.destroyCallbacks.push(onDestroy);
      onMethodRender(PaymentMethod.PAYMENT_CARD);
      return {
        setDisabled: (disabled: boolean) => {
          cardNumberInput.setDisabled(disabled);
          expiryInput.setDisabled(disabled);
          cvvInput.setDisabled(disabled);
          elements.button.disabled = disabled;
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
      throw new PrimerError('Failed to initialize Primer checkout', error);
      onMethodRenderError(PaymentMethod.PAYMENT_CARD);
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
    } = checkoutRenderOptions;
    await this.initializeHeadlessCheckout(clientToken, checkoutOptions);
    for (const method of this.availableMethods) {
      if (method === PaymentMethod.PAYMENT_CARD) {
        // For card, use the main container
        await this.initMethod(method, container, {
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
        await this.initMethod(method, buttonElement, {
          onMethodRender,
          onMethodRenderError,
        });
      }
    }
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
