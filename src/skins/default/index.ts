import template from './template.html';
import cardTemplate from './card.html';
import paypalTemplate from './paypal.html';
import googlePayTemplate from './google-pay.html';
import applePayTemplate from './apple-pay.html';
import './styles.css';
import type { Skin, CardInputElements, SkinFactory } from '../types';
import { PaymentMethod } from '../../enums';
import {
  CardInputSelectors,
  CheckoutState,
  PrimerWrapperInterface,
} from '../../types';

const paymentMethodTemplates: Record<PaymentMethod, string> = {
  [PaymentMethod.PAYMENT_CARD]: cardTemplate,
  [PaymentMethod.PAYPAL]: paypalTemplate,
  [PaymentMethod.GOOGLE_PAY]: googlePayTemplate,
  [PaymentMethod.APPLE_PAY]: applePayTemplate,
};

class DefaultSkin implements Skin {
  private containerSelector: string;
  private containerEl: HTMLElement;
  private cardInputElements: CardInputElements;
  private primerWrapper: PrimerWrapperInterface;
  currentPurchaseMethod: PaymentMethod;
  paymentMethodOrder: PaymentMethod[];
  availableMethods: PaymentMethod[];

  constructor(
    primerWrapper: PrimerWrapperInterface,
    containerSelector: string,
    paymentMethodOrder: PaymentMethod[]
  ) {
    this.containerSelector = containerSelector;
    this.paymentMethodOrder = paymentMethodOrder;
    const containerEl = document.querySelector<HTMLElement>(containerSelector);

    if (!containerEl) {
      throw new Error(
        `Container element not found for selector: ${containerSelector}`
      );
    }

    this.containerEl = containerEl;

    // Initialize with placeholders; real nodes will be wired in `init`.
    this.cardInputElements = {
      cardNumber: document.createElement('div'),
      expiryDate: document.createElement('div'),
      cvv: document.createElement('div'),
      button: document.createElement('button'),
    };
    this.primerWrapper = primerWrapper;
  }

  private initAccordion() {
    const paymentMethodCards = this.containerEl.querySelectorAll(
      '.ff-payment-method-card'
    );
    const radioButtons = this.containerEl.querySelectorAll<HTMLInputElement>(
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
      throw new Error(
        'Default skin accordion initialization error: No radio button found'
      );
    }
    setTimeout(() => {
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
    const cardNumber =
      this.containerEl.querySelector<HTMLElement>('#cardNumberInput');
    const expiryDate =
      this.containerEl.querySelector<HTMLElement>('#expiryInput');
    const cvv = this.containerEl.querySelector<HTMLElement>('#cvvInput');
    const button =
      this.containerEl.querySelector<HTMLButtonElement>('#submitButton');

    if (!cardNumber || !expiryDate || !cvv || !button) {
      throw new Error(
        'One or more card input elements are missing in the default skin'
      );
    }

    this.cardInputElements = {
      cardNumber,
      expiryDate,
      cvv,
      button,
    };
  }

  private async init() {
    this.containerEl.insertAdjacentHTML('beforeend', template);
    const paymentMethodContainers = this.containerEl.querySelector(
      '#ff-payment-method-containers'
    );
    this.paymentMethodOrder.forEach(paymentMethod => {
      paymentMethodContainers.insertAdjacentHTML(
        'beforeend',
        paymentMethodTemplates[paymentMethod]
      );
    });
    this.wireCardInputs();
  }

  renderCardForm(): void {
    // Card form is part of the base template; no-op for default skin.
  }

  renderButton(paymentMethod: PaymentMethod): void {
    const methodKey = paymentMethod.replace('_', '-').toLowerCase();
    const methodContainer = this.containerEl.querySelector(
      `.ff-payment-method-${methodKey}`
    );
    if (methodContainer) {
      methodContainer.classList.add('visible');
    }
  }

  getCardInputSelectors(): CardInputSelectors {
    return {
      cardNumber: '#cardNumberInput',
      expiryDate: '#expiryInput',
      cvv: '#cvvInput',
      cardholderName: '#cardHolderInput',
      button: '#submitButton',
    };
  }

  getCardInputElements(): CardInputElements {
    return this.cardInputElements;
  }

  getCheckoutOptions(): ReturnType<Skin['getCheckoutOptions']> {
    return {
      cardSelectors: this.getCardInputSelectors(),
      paymentButtonSelectors: {
        paypal: '#paypalButton',
        googlePay: '#googlePayButton',
        applePay: '#applePayButton',
      },
      card: {
        cardholderName: {
          required: false,
        },
      },
      applePay: {
        buttonStyle: 'black',
      },
      paypal: {
        buttonColor: 'gold',
        buttonShape: 'pill',
        buttonLabel: 'pay',
        buttonSize: 'large',
        buttonHeight: 54,
      },
      googlePay: {
        buttonColor: 'black',
        buttonSizeMode: 'fill',
        buttonType: 'pay',
      },
    };
  }

  onLoaderChange = (isLoading: boolean) => {
    this.primerWrapper.disableButtons(isLoading);
    document
      .querySelectorAll<HTMLDivElement>(
        `${this.containerSelector} .loader-container`
      )
      ?.forEach(loaderEl => {
        loaderEl.style.display = isLoading ? 'flex' : 'none';
      });
  };
  onError = (error?: Error, paymentMethod?: PaymentMethod) => {
    if (!error) {
      this.containerEl
        .querySelectorAll('.payment-errors-container')
        ?.forEach(container => {
          container.innerHTML = '';
        });
      return;
    }
    let errorContainer: HTMLElement | null = null;
    if (paymentMethod) {
      const methodKey = paymentMethod.replace('_', '-').toLowerCase();
      errorContainer = this.containerEl.querySelector(
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
    const successScreenString =
      document.querySelector('#success-screen')?.innerHTML;
    const containers = document.querySelectorAll('.ff-payment-container');
    containers.forEach(container => {
      container.innerHTML = successScreenString;
    });
    this.onLoaderChange(false);
  };
  onDestroy = () => {
    this.containerEl.remove();
  };
  onInputError = (event: { name: keyof CardInputSelectors; error: string }) => {
    const { name, error } = event;
    const cardInputElements: CardInputElements = this.getCardInputElements();
    const elementsMap = {
      cardNumber: cardInputElements.cardNumber.parentElement,
      expiryDate: cardInputElements.expiryDate.parentElement,
      cvv: cardInputElements.cvv.parentElement,
    };
    const errorContainer = elementsMap[name]?.querySelector('.errorContainer');
    if (errorContainer) {
      errorContainer.textContent = error || '';
    }
  };
  onMethodRender = (paymentMethod: PaymentMethod) => {
    const methodKey = paymentMethod.replace('_', '-').toLowerCase();
    const methodContainer = this.containerEl.querySelector(
      `.ff-payment-method-${methodKey}`
    );
    if (methodContainer) {
      methodContainer.classList.add('visible');
    }
  };
  onMethodsAvailable = (methods: PaymentMethod[]) => {
    this.availableMethods = methods;
    this.initAccordion();
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
  primerWrapper: PrimerWrapperInterface,
  containerSelector: string,
  paymentMethodOrder: PaymentMethod[]
): Promise<Skin> => {
  const skin = new DefaultSkin(
    primerWrapper,
    containerSelector,
    paymentMethodOrder
  );
  await skin['init']();
  return skin;
};

export default createDefaultSkin;
