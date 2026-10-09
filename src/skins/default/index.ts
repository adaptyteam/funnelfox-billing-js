import template from './template.html';
import cardTemplate from './card.html';
import paypalTemplate from './paypal.html';
import googlePayTemplate from './google-pay.html';
import applePayTemplate from './apple-pay.html';
import './styles.css';
import type { Skin, SkinFactory } from '../types';
import type { CardSessionFieldConfig } from '../types';
import { PaymentMethod } from '../../enums';
import {
  CardInputElementsWithButton,
  CardInputSelectors,
  CheckoutConfig,
  CheckoutState,
  PaymentButtonElements,
} from '../../types';
import CardSkin from '../card';
import { DEFAULT_BUTTONS_OPTIONS } from '../../constants';

const paymentMethodTemplates: Record<PaymentMethod, string> = {
  [PaymentMethod.PAYMENT_CARD]: cardTemplate,
  [PaymentMethod.PAYPAL]: paypalTemplate,
  [PaymentMethod.GOOGLE_PAY]: googlePayTemplate,
  [PaymentMethod.APPLE_PAY]: applePayTemplate,
};

export class DefaultSkin implements Skin {
  private containerSelector: string;
  private containerEl: HTMLElement;
  private rootEl: HTMLElement;
  private cardInputElements: CardInputElementsWithButton;
  private isDestroyed = false;
  private isAccordionInitialized = false;
  currentPurchaseMethod: PaymentMethod;
  cardInstance: CardSkin;
  paymentMethodOrder: PaymentMethod[];
  availableMethods: PaymentMethod[];
  checkoutConfig: CheckoutConfig;
  cardSessionFieldConfig?: CardSessionFieldConfig;

  constructor(
    checkoutConfig: CheckoutConfig,
    cardSessionFieldConfig?: CardSessionFieldConfig
  ) {
    this.containerSelector = checkoutConfig.container;
    this.paymentMethodOrder = checkoutConfig.paymentMethodOrder;
    const containerEl = document.querySelector<HTMLElement>(
      this.containerSelector
    );

    if (!containerEl) {
      throw new Error(
        `Container element not found for selector: ${this.containerSelector}`
      );
    }

    this.containerEl = containerEl;
    this.checkoutConfig = checkoutConfig;
    this.cardSessionFieldConfig = cardSessionFieldConfig;
  }

  private initAccordion() {
    if (this.isDestroyed || !this.rootEl?.isConnected) {
      return;
    }
    if (this.isAccordionInitialized) {
      return;
    }
    const paymentMethodCards = this.rootEl.querySelectorAll(
      '.ff-payment-method-card'
    );
    const radioButtons = this.rootEl.querySelectorAll<HTMLInputElement>(
      '.ff-payment-method-radio'
    );

    const handleAccordion = (checkedRadio: HTMLInputElement | null) => {
      paymentMethodCards.forEach(card => {
        const radio = card.querySelector<HTMLInputElement>(
          '.ff-payment-method-radio'
        );

        if (radio === checkedRadio && radio?.checked) {
          card.classList.add('expanded');
        } else {
          card.classList.remove('expanded');
        }
      });
    };

    const checkedRadio = Array.from(radioButtons).find(radio =>
      this.availableMethods.includes(radio.value as PaymentMethod)
    );
    if (!checkedRadio) {
      return;
    }
    this.isAccordionInitialized = true;
    setTimeout(() => {
      if (this.isDestroyed || !this.rootEl?.isConnected) {
        return;
      }
      checkedRadio.checked = true;
      handleAccordion(checkedRadio);
    }, 0);

    radioButtons.forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          handleAccordion(radio);
        }
      });
    });
  }

  private wireCardInputs() {
    this.cardInstance.wireCardInputs();
    const button =
      this.rootEl.querySelector<HTMLButtonElement>('#submitButton');

    if (!button) {
      throw new Error(
        'One or more card input elements are missing in the default skin'
      );
    }

    this.cardInputElements = {
      ...this.cardInstance.getCardInputElements(),
      button,
    };
  }

  async init() {
    this.containerEl.insertAdjacentHTML('beforeend', template);
    const rootEls =
      this.containerEl.querySelectorAll<HTMLElement>('.ff-skin-default');
    this.rootEl = rootEls[rootEls.length - 1];
    if (!this.rootEl) {
      throw new Error('Default skin root element not found');
    }
    const paymentMethodContainers = this.rootEl.querySelector(
      '#ff-payment-method-containers'
    );
    this.paymentMethodOrder.forEach(paymentMethod => {
      paymentMethodContainers.insertAdjacentHTML(
        'beforeend',
        paymentMethodTemplates[paymentMethod]
      );
    });
    this.cardInstance = new CardSkin(
      this.rootEl.querySelector('#cardForm'),
      this.checkoutConfig,
      this.cardSessionFieldConfig
    );
    this.cardInstance.init();
    this.wireCardInputs();
  }

  renderCardForm(): void {
    // Card form is part of the base template; no-op for default skin.
  }

  getCardInputElements(): CardInputElementsWithButton {
    return {
      ...this.cardInstance.getCardInputElements(),
      button: this.cardInputElements.button,
    };
  }
  getPaymentButtonElements(): PaymentButtonElements {
    return {
      paypal: this.rootEl.querySelector<HTMLElement>('#paypalButton'),
      googlePay: this.rootEl.querySelector<HTMLElement>('#googlePayButton'),
      applePay: this.rootEl.querySelector<HTMLElement>('#applePayButton'),
    };
  }

  getCheckoutOptions(): ReturnType<Skin['getCheckoutOptions']> {
    return {
      ...this.cardInstance.getCheckoutOptions(),
      cardElements: this.getCardInputElements(),
      paymentButtonElements: this.getPaymentButtonElements(),
      applePay: DEFAULT_BUTTONS_OPTIONS[PaymentMethod.APPLE_PAY],
      paypal: DEFAULT_BUTTONS_OPTIONS[PaymentMethod.PAYPAL],
      googlePay: DEFAULT_BUTTONS_OPTIONS[PaymentMethod.GOOGLE_PAY],
    };
  }

  onLoaderChange = (isLoading: boolean) => {
    if (this.isDestroyed || !this.rootEl?.isConnected) {
      return;
    }
    this.rootEl
      .querySelectorAll<HTMLDivElement>('.loader-container')
      ?.forEach(loaderEl => {
        loaderEl.style.display = isLoading ? 'flex' : 'none';
      });
  };
  onError = (error?: Error, paymentMethod?: PaymentMethod) => {
    if (this.isDestroyed || !this.rootEl?.isConnected) {
      return;
    }
    if (!error) {
      this.rootEl
        .querySelectorAll('.payment-errors-container')
        ?.forEach(container => {
          container.innerHTML = '';
        });
      return;
    }
    let errorContainer: HTMLElement | null = null;
    if (paymentMethod) {
      const methodKey = paymentMethod.replace('_', '-').toLowerCase();
      errorContainer = this.rootEl.querySelector(
        `.ff-payment-method-${methodKey} .payment-errors-container`
      );
    }
    if (errorContainer) {
      errorContainer.textContent = error?.message || '';
    }
  };
  onStatusChange = (state: CheckoutState, oldState: CheckoutState) => {
    const isLoading = ['initializing'].includes(state);
    if (!isLoading && oldState === 'initializing') {
      this.onLoaderChange(false);
    }
    if (state === 'updating') {
      this.onLoaderChange(true);
    }
    if (state === 'ready' && oldState === 'updating') {
      this.onLoaderChange(false);
    }
  };
  onSuccess = () => {
    if (this.isDestroyed || !this.rootEl?.isConnected) {
      return;
    }
    const successScreenString =
      this.rootEl.querySelector('#success-screen')?.innerHTML;
    const containers = this.rootEl.querySelectorAll('.ff-payment-container');
    containers.forEach(container => {
      container.innerHTML = successScreenString;
    });
    this.onLoaderChange(false);
  };
  onDestroy = () => {
    this.isDestroyed = true;
    this.rootEl?.remove();
  };
  onInputError = (event: { name: keyof CardInputSelectors; error: string }) => {
    if (this.isDestroyed || !this.rootEl?.isConnected) {
      return;
    }
    this.cardInstance.onInputError(event);
  };
  onMethodRender = (paymentMethod: PaymentMethod) => {
    if (this.isDestroyed || !this.rootEl?.isConnected) {
      return;
    }
    const methodKey = paymentMethod.replace('_', '-').toLowerCase();
    const methodContainer = this.rootEl.querySelector(
      `.ff-payment-method-${methodKey}`
    );
    if (paymentMethod === PaymentMethod.PAYMENT_CARD) {
      this.cardInstance.onMethodRender();
    }
    if (methodContainer) {
      methodContainer.classList.add('visible');
    }
  };
  onMethodsAvailable = (methods: PaymentMethod[]) => {
    if (this.isDestroyed || !this.rootEl?.isConnected) {
      return;
    }
    this.availableMethods = methods;
    this.initAccordion();
    methods.forEach(this.onMethodRender);
  };
  onStartPurchase = (paymentMethod: PaymentMethod) => {
    this.currentPurchaseMethod = paymentMethod;
  };
  onPurchaseFailure = (error: Error) => {
    if (this.currentPurchaseMethod) {
      this.onError(error, this.currentPurchaseMethod);
    }
    this.currentPurchaseMethod = null;
  };
  onPurchaseCompleted = () => {
    this.currentPurchaseMethod = null;
  };
}

const createDefaultSkin: SkinFactory = async (
  checkoutConfig: CheckoutConfig,
  cardSessionFieldConfig?: CardSessionFieldConfig
): Promise<Skin> => {
  const skin = new DefaultSkin(checkoutConfig, cardSessionFieldConfig);
  await skin['init']();
  return skin;
};

export default createDefaultSkin;
