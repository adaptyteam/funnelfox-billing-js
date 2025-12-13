import template from './template.html';
import './styles.css';
import type { Skin, CardInputElements } from '../types';
import type { PaymentMethod } from '../../enums';
import { CardInputSelectors } from '../../types';

class CardSkin implements Skin {
  private containerEl: HTMLElement;
  private cardInputElements: CardInputElements;
  currentPurchaseMethod: PaymentMethod;

  constructor(containerEl: HTMLElement) {
    if (!containerEl) {
      throw new Error('Container element not found');
    }

    this.containerEl = containerEl;

    // Initialize with placeholders; real nodes will be wired in `init`.
    this.cardInputElements = {
      cardNumber: document.createElement('div'),
      expiryDate: document.createElement('div'),
      cvv: document.createElement('div'),
    };
  }

  wireCardInputs() {
    const cardNumber =
      this.containerEl.querySelector<HTMLElement>('#cardNumberInput');
    const expiryDate =
      this.containerEl.querySelector<HTMLElement>('#expiryInput');
    const cvv = this.containerEl.querySelector<HTMLElement>('#cvvInput');

    if (!cardNumber || !expiryDate || !cvv) {
      throw new Error(
        'One or more card input elements are missing in the default skin'
      );
    }

    this.cardInputElements = {
      cardNumber,
      expiryDate,
      cvv,
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
          required: false,
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
    };
    const errorContainer = elementsMap[name]?.querySelector('.errorContainer');
    if (errorContainer) {
      errorContainer.textContent = error || '';
    }
  };
}

export default CardSkin;
