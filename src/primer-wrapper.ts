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
import { loadPrimerSDK } from './utils/primer-loader';
import { HeadlessManager } from './utils/headless-manager';
import { ALLOWED_PAYMENT_METHODS, inputStyle } from './constants';
import { isValidEmail } from './utils/validation';
import {
  CardInputSelectors,
  CheckoutOptions,
  PaymentMethodInterface,
  PrimerWrapperInterface,
  CheckoutRenderOptions,
  CardInputElementsWithButton,
} from './types';
import { PaymentMethod } from './enums';
import { generateId } from './utils/helpers';

declare global {
  interface Window {
    Primer?: typeof Primer;
  }
}
class PrimerWrapper implements PrimerWrapperInterface {
  isInitialized: boolean = false;
  private destroyCallbacks: (() => void)[] = [];
  private currentHeadless: Promise<PrimerHeadlessCheckout> | null = null;
  private availableMethods: PaymentMethod[] = [];
  private paymentMethodsInterfaces?: PaymentMethodInterface[] = [];
  private static readonly headlessManager = new HeadlessManager();

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
    },
    method?: PaymentMethod
  ) {
    await this.ensurePrimerLoaded();
    this.currentHeadless = PrimerWrapper.headlessManager.getOrCreate(
      clientToken,
      options,
      method
    );

    return this.currentHeadless;
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
    if (!this.currentHeadless) {
      throw new PrimerError('Headless checkout not found');
    }
    try {
      const headless = await this.currentHeadless;
      const pmManager =
        await headless.createPaymentMethodManager(allowedPaymentMethod);
      if (!pmManager) {
        throw new Error('Payment method manager is not available');
      }
      /* hack for FFB-169 & FFB-242
       * Primer SDK does not allow to set the height of the googlepay and applepay buttons, so we need to use a hack to set the height of the button.
       */
      const wrapper = document.createElement('div');
      wrapper.className = generateId('funnefox-primer-button-wrapper');
      const styleEl = document.createElement('style');
      document.head.appendChild(styleEl);
      const sheet = styleEl.sheet;
      if (sheet) {
        sheet.insertRule(`
          .${wrapper.className} {
            width: 100% !important;
          }
        `);
        sheet.insertRule(`
          .${wrapper.className} button {
            height: 54px !important;
            border-radius: 28px !important;
          }
        `);
      }
      htmlNode.appendChild(wrapper);
      /* end hack */
      button = pmManager.createButton();
      await button.render(wrapper, {});
      this.destroyCallbacks.push(() => button.clean());
      onMethodRender(allowedPaymentMethod);
      return {
        setDisabled: (disabled: boolean) => {
          button.setDisabled(disabled);
        },
        destroy: () => {
          styleEl.remove();
          button.clean();
        },
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
            onCardInputValueChange: options.onCardInputValueChange,
            isCardholderNameRequired: options.isCardholderNameRequired,
            isPostalCodeRequired: options.isPostalCodeRequired,
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
      onCardInputValueChange,
      isCardholderNameRequired,
      isPostalCodeRequired,
      onMethodRenderError,
      onMethodRender,
    }: CheckoutRenderOptions
  ): Promise<PaymentMethodInterface> {
    try {
      if (!this.currentHeadless) {
        throw new PrimerError('Headless checkout not found');
      }
      const headless = await this.currentHeadless;
      const pmManager =
        await headless.createPaymentMethodManager('PAYMENT_CARD');
      if (!pmManager) {
        throw new Error('Payment method manager is not available');
      }
      const hasEmail = !!elements.emailAddress;

      const { cardNumberInput, expiryInput, cvvInput } =
        pmManager.createHostedInputs();

      const validateForm = async () => {
        if (!pmManager) return false;

        const { valid, validationErrors } = await pmManager.validate();
        const cardHolderError = isCardholderNameRequired?.()
          ? validationErrors.find(v => v.name === 'cardholderName')?.message
          : null;
        dispatchError('cardholderName', cardHolderError);
        let emailError: string | null = null;
        if (hasEmail) {
          const emailAddress = elements.emailAddress?.value?.trim();
          emailError = !isValidEmail(emailAddress)
            ? 'Please enter a valid email address'
            : null;
          dispatchError('emailAddress', emailError);
        }
        const postalCode = elements.postalCode?.value?.trim();
        const postalCodeError =
          isPostalCodeRequired?.() && !postalCode
            ? 'Please enter a postal code'
            : null;
        dispatchError('postalCode', postalCodeError);
        return valid && !emailError && !cardHolderError && !postalCodeError;
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
      let emailAddressOnChange: ((e: Event) => void) | undefined;
      if (hasEmail) {
        emailAddressOnChange = (e: Event) => {
          const value = (e.target as HTMLInputElement).value;
          const email = value.trim();
          onCardInputValueChange?.('emailAddress', email);
          dispatchError(
            'emailAddress',
            email && !isValidEmail(email)
              ? 'Please enter a valid email address'
              : null
          );
        };
        elements.emailAddress.addEventListener('input', emailAddressOnChange);
      }
      const countrySelectorOnChange = (e: Event) => {
        const countryCode = (e.target as HTMLSelectElement).value.trim();
        onCardInputValueChange?.('countryCode', countryCode);
      };
      const postalCodeOnChange = (e: Event) => {
        const postalCode = (e.target as HTMLInputElement).value.trim();
        onCardInputValueChange?.('postalCode', postalCode);
        dispatchError('postalCode', null);
      };

      elements.cardholderName?.addEventListener('input', cardHolderOnChange);
      elements.emailAddress?.addEventListener('input', emailAddressOnChange);
      elements.countrySelector?.addEventListener(
        'change',
        countrySelectorOnChange
      );
      elements.postalCode?.addEventListener('input', postalCodeOnChange);
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
        const isFormValid = await validateForm();
        if (!isFormValid) {
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
          'input',
          cardHolderOnChange
        );
        elements.emailAddress?.removeEventListener(
          'input',
          emailAddressOnChange
        );
        elements.countrySelector?.removeEventListener(
          'change',
          countrySelectorOnChange
        );
        elements.postalCode?.removeEventListener('input', postalCodeOnChange);
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
          if (elements.emailAddress) {
            elements.emailAddress.disabled = disabled;
          }
          if (elements.countrySelector) {
            elements.countrySelector.disabled = disabled;
          }
          if (elements.postalCode) {
            elements.postalCode.disabled = disabled;
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
    primerOptions: CheckoutOptions,
    method?: PaymentMethod
  ) {
    await this.createHeadlessCheckout(
      clientToken,
      {
        ...primerOptions,
        onTokenizeSuccess: this.wrapTokenizeHandler(
          primerOptions.onTokenizeSuccess
        ),
        onResumeSuccess: this.wrapResumeHandler(primerOptions.onResumeSuccess),
        onAvailablePaymentMethodsLoad:
          this.wrapAvailablePaymentMethodsLoadHandler(
            primerOptions.onAvailablePaymentMethodsLoad
          ),
      },
      method
    );
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
      onCardInputValueChange,
      isCardholderNameRequired,
      isPostalCodeRequired,
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
            onCardInputValueChange,
            isCardholderNameRequired,
            isPostalCodeRequired,
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

  private wrapAvailablePaymentMethodsLoadHandler(
    onAvailablePaymentMethodsLoad?: (items: PaymentMethod[]) => void
  ) {
    return (items: PaymentMethodInfo[]) => {
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
      onAvailablePaymentMethodsLoad?.(this.availableMethods);
    };
  }

  async destroy() {
    if (this.currentHeadless) {
      PrimerWrapper.headlessManager.remove(this.currentHeadless);
      this.currentHeadless = null;
    }
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
