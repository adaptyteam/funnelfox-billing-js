import template from './template.html';
import './styles.css';
import type { Skin } from '../types';
import type { PaymentMethod } from '../../types';
import {
  CardInputSelectors,
  CheckoutConfig,
  CardInputElements,
} from '../../types';

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
    this.containerEl.style.display = 'none';
  }

  wireCardInputs() {
    const cardNumber =
      this.containerEl.querySelector<HTMLElement>('#cardNumberInput');
    const expiryDate =
      this.containerEl.querySelector<HTMLElement>('#expiryInput');
    const cvv = this.containerEl.querySelector<HTMLElement>('#cvvInput');
    const hasCardholderInput =
      !!this.checkoutConfig?.card?.cardholderName?.required;
    let cardholderName: HTMLInputElement | undefined = undefined;
    if (hasCardholderInput) {
      cardholderName =
        this.containerEl.querySelector<HTMLInputElement>('#cardHolderInput');
    } else {
      this.containerEl.querySelector<HTMLInputElement>(
        '#cardHolderInput'
      ).parentElement.style.display = 'none';
    }
    const hasEmailInput = !!this.checkoutConfig?.card?.emailAddress?.visible;
    let emailAddress: HTMLInputElement | undefined = undefined;
    if (hasEmailInput) {
      emailAddress =
        this.containerEl.querySelector<HTMLInputElement>('#emailAddressInput');
      if (emailAddress) {
        emailAddress.value = this.checkoutConfig.customer.email || '';
      }
    } else {
      this.containerEl.querySelector<HTMLInputElement>(
        '#emailAddressInput'
      ).parentElement.style.display = 'none';
    }

    if (
      !cardNumber ||
      !expiryDate ||
      !cvv ||
      (hasCardholderInput && !cardholderName) ||
      (hasEmailInput && !emailAddress)
    ) {
      throw new Error(
        'One or more card input elements are missing in the default skin'
      );
    }

    this.cardInputElements = {
      cardNumber,
      expiryDate,
      cvv,
      cardholderName,
      emailAddress,
    };
  }

  async init() {
    this.containerEl.insertAdjacentHTML('afterbegin', template);
    this.wireCardInputs();
  }

  renderCardForm(): void {
    // Card form is part of the base template; no-op for default skin.
  }

  getCardInputElements(): CardInputElements {
    return this.cardInputElements;
  }

  getCheckoutOptions(): ReturnType<Skin['getCheckoutOptions']> {
    return {
      cardElements: this.getCardInputElements(),
      card: {
        cardholderName: {
          required: !!this.checkoutConfig?.card?.cardholderName?.required,
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
      emailAddress: cardInputElements.emailAddress?.parentElement,
    };
    const errorContainer = elementsMap[name]?.querySelector('.errorContainer');
    if (errorContainer) {
      errorContainer.textContent = error || '';
    }
    if (name === 'cardholderName' || name === 'emailAddress') {
      const field =
        name === 'cardholderName'
          ? cardInputElements.cardholderName
          : cardInputElements.emailAddress;
      if (error) {
        field?.classList?.add('error');
      } else {
        field?.classList?.remove('error');
      }
    }
  };
  onMethodRender = () => {
    this.containerEl.style.display = 'block';
  };
  onDestroy = () => {
    if (this.containerEl.innerHTML) {
      this.containerEl.innerHTML = '';
    }
  };
}

export default CardSkin;
