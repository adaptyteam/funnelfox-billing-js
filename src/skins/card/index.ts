import template from './template.html';
import './styles.css';
import type { Skin, CardInputElements } from '../types';
import type { PaymentMethod } from '../../enums';
import { CardInputSelectors, CheckoutConfig } from '../../types';

class CardSkin implements Skin {
  private containerEl: HTMLElement;
  private cardInputElements: CardInputElements;
  currentPurchaseMethod: PaymentMethod;
  checkoutConfig: CheckoutConfig;

  constructor(containerEl: HTMLElement, checkoutConfig: CheckoutConfig) {
    if (!containerEl) {
      throw new Error('Container element not found');
    }

    this.containerEl = containerEl;
    this.checkoutConfig = checkoutConfig;

    // Initialize with placeholders; real nodes will be wired in `init`.
    this.cardInputElements = {
      cardNumber: document.createElement('div'),
      expiryDate: document.createElement('div'),
      cvv: document.createElement('div'),
    };
    this.containerEl.style.display = 'none';
  }

  wireCardInputs() {
    const cardNumber =
      this.containerEl.querySelector<HTMLElement>('#cardNumberInput');
    const expiryDate =
      this.containerEl.querySelector<HTMLElement>('#expiryInput');
    const cvv = this.containerEl.querySelector<HTMLElement>('#cvvInput');
    let cardholderName: HTMLElement | null = null;
    if (this.checkoutConfig?.card?.cardholderName) {
      cardholderName =
        this.containerEl.querySelector<HTMLElement>('#cardHolderInput');
    } else {
      this.containerEl.querySelector<HTMLElement>(
        '#cardHolderInput'
      ).parentElement.style.display = 'none';
    }

    if (!cardNumber || !expiryDate || !cvv) {
      throw new Error(
        'One or more card input elements are missing in the default skin'
      );
    }

    this.cardInputElements = {
      cardNumber,
      expiryDate,
      cvv,
      cardholderName,
    };
  }

  async init() {
    this.containerEl.insertAdjacentHTML('afterbegin', template);
    this.wireCardInputs();
  }

  renderCardForm(): void {
    // Card form is part of the base template; no-op for default skin.
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
      cardElements: this.getCardInputElements(),
      card: {
        cardholderName: {
          required: !!this.checkoutConfig?.card?.cardholderName,
        },
      },
    };
  }

  onInputError = (event: { name: keyof CardInputSelectors; error: string }) => {
    const { name, error } = event;
    const cardInputElements: CardInputElements = this.getCardInputElements();
    const elementsMap = {
      cardNumber: cardInputElements.cardNumber.parentElement,
      expiryDate: cardInputElements.expiryDate.parentElement,
      cvv: cardInputElements.cvv.parentElement,
      cardholderName: cardInputElements.cardholderName?.parentElement,
    };
    const errorContainer = elementsMap[name]?.querySelector('.errorContainer');
    if (errorContainer) {
      errorContainer.textContent = error || '';
    }
    if (name === 'cardholderName') {
      if (error) {
        cardInputElements.cardholderName?.classList?.add('error');
      } else {
        cardInputElements.cardholderName?.classList?.remove('error');
      }
    }
  };
  onMethodRender = () => {
    this.containerEl.style.display = 'block';
  };
}

export default CardSkin;
