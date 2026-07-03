import template from './template.html';
import './styles.css';
import type { Skin } from '../types';
import type { CardSessionFieldConfig } from '../types';
import {
  CardInputSelectors,
  CheckoutConfig,
  CardInputElements,
  PaymentMethod,
  TaxInfo,
} from '../../types';
import { formatCurrencyAmount } from '../../utils/helpers';

class CardSkin implements Skin {
  private containerEl: HTMLElement;
  private cardInputElements: CardInputElements;
  currentPurchaseMethod: PaymentMethod;
  checkoutConfig: CheckoutConfig;
  cardSessionFieldConfig?: CardSessionFieldConfig;

  constructor(
    containerEl: HTMLElement,
    checkoutConfig: CheckoutConfig,
    cardSessionFieldConfig?: CardSessionFieldConfig
  ) {
    if (!containerEl) {
      throw new Error('Container element not found');
    }

    this.containerEl = containerEl;
    this.checkoutConfig = checkoutConfig;
    this.cardSessionFieldConfig = cardSessionFieldConfig;
    this.containerEl.style.display = 'none';
  }

  private normalizeCountryCode(
    countryCode?: string | null
  ): string | undefined {
    const normalized = countryCode?.trim().toUpperCase();
    return normalized || undefined;
  }

  private getSelectedCountryCode(): string | undefined {
    const selector = this.containerEl.querySelector<HTMLSelectElement>(
      '#countrySelectorInput'
    );

    return (
      this.normalizeCountryCode(selector?.value) ||
      this.normalizeCountryCode(
        this.cardSessionFieldConfig?.detectedCountryCode
      )
    );
  }

  private getCountryFieldOverride(countryCode = this.getSelectedCountryCode()) {
    if (!countryCode) {
      return undefined;
    }

    return this.cardSessionFieldConfig?.countryFieldOverrides?.[countryCode];
  }

  private isCountrySelectorVisible(): boolean {
    return !!this.cardSessionFieldConfig?.showCountrySelector;
  }

  private isCardholderNameVisible(): boolean {
    return !!this.checkoutConfig.card?.cardholderName?.required;
  }

  private isPostalCodeVisible(
    countryCode = this.getSelectedCountryCode()
  ): boolean {
    const defaultVisible = !!this.cardSessionFieldConfig?.showPostalCode;
    const overrideValue =
      this.getCountryFieldOverride(countryCode)?.show_postal_code;

    if (overrideValue === null || overrideValue === undefined) {
      return defaultVisible;
    }

    return overrideValue;
  }

  private setFieldVisibility(inputId: string, isVisible: boolean) {
    const field = this.containerEl.querySelector<HTMLElement>(`#${inputId}`);
    if (field?.parentElement) {
      field.parentElement.style.display = isVisible ? '' : 'none';
    }
  }

  private setContainerVisibility(containerId: string, isVisible: boolean) {
    const container = this.containerEl.querySelector<HTMLElement>(
      `#${containerId}`
    );
    if (container) {
      container.style.display = isVisible ? '' : 'none';
    }
  }

  private populateCountrySelector(selectEl: HTMLSelectElement) {
    const validCountries = this.cardSessionFieldConfig?.validCountries || [];
    const selectedCountryCode = this.getSelectedCountryCode();

    selectEl.innerHTML = '';
    selectEl.disabled = false;

    if (!validCountries.length) {
      const fallbackOption = document.createElement('option');
      fallbackOption.value = selectedCountryCode || '';
      fallbackOption.textContent = selectedCountryCode
        ? `Detected country: ${selectedCountryCode}`
        : 'Country unavailable';
      selectEl.appendChild(fallbackOption);
      selectEl.disabled = true;
      return;
    }

    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = 'Select country';
    selectEl.appendChild(placeholderOption);

    validCountries.forEach(country => {
      const option = document.createElement('option');
      option.value = country.code;
      option.textContent = country.name;
      selectEl.appendChild(option);
    });

    if (selectedCountryCode) {
      selectEl.value = selectedCountryCode;
    }
  }

  private updateDynamicFieldVisibility(
    countryCode = this.getSelectedCountryCode()
  ) {
    this.setFieldVisibility('cardHolderInput', this.isCardholderNameVisible());
    this.setFieldVisibility(
      'postalCodeInput',
      this.isPostalCodeVisible(countryCode)
    );

    const postalCodeInput =
      this.containerEl.querySelector<HTMLInputElement>('#postalCodeInput');
    if (!this.isPostalCodeVisible(countryCode) && postalCodeInput) {
      postalCodeInput.value = '';
    }
  }

  wireCardInputs() {
    const cardNumber =
      this.containerEl.querySelector<HTMLElement>('#cardNumberInput');
    const expiryDate =
      this.containerEl.querySelector<HTMLElement>('#expiryInput');
    const cvv = this.containerEl.querySelector<HTMLElement>('#cvvInput');
    const cardholderName =
      this.containerEl.querySelector<HTMLInputElement>('#cardHolderInput');
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
    const countrySelector = this.containerEl.querySelector<HTMLSelectElement>(
      '#countrySelectorInput'
    );
    const postalCode =
      this.containerEl.querySelector<HTMLInputElement>('#postalCodeInput');

    if (countrySelector) {
      this.populateCountrySelector(countrySelector);
      countrySelector.addEventListener('change', () => {
        this.updateDynamicFieldVisibility(
          this.normalizeCountryCode(countrySelector.value)
        );
      });
    }

    this.setContainerVisibility(
      'countrySelectorField',
      this.isCountrySelectorVisible()
    );
    this.updateDynamicFieldVisibility();

    if (
      !cardNumber ||
      !expiryDate ||
      !cvv ||
      !cardholderName ||
      (hasEmailInput && !emailAddress) ||
      !countrySelector ||
      !postalCode
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
      countrySelector,
      postalCode,
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
      postalCode: cardInputElements.postalCode?.parentElement,
    };
    const errorContainer = elementsMap[name]?.querySelector('.errorContainer');
    if (errorContainer) {
      errorContainer.textContent = error || '';
    }
    if (
      name === 'cardholderName' ||
      name === 'emailAddress' ||
      name === 'postalCode'
    ) {
      const field =
        name === 'cardholderName'
          ? cardInputElements.cardholderName
          : name === 'emailAddress'
            ? cardInputElements.emailAddress
            : cardInputElements.postalCode;
      if (error) {
        field?.classList?.add('error');
      } else {
        field?.classList?.remove('error');
      }
    }
  };
  onTaxChange = (info: TaxInfo) => {
    const summary =
      this.containerEl.querySelector<HTMLElement>('#ffTaxSummary');
    if (!summary) {
      return;
    }
    const subtotal = this.containerEl.querySelector('#ffTaxSubtotal');
    const tax = this.containerEl.querySelector('#ffTaxAmount');
    const total = this.containerEl.querySelector('#ffTaxTotal');
    if (subtotal) {
      subtotal.textContent = formatCurrencyAmount(
        info.amountTotal - info.taxAmount,
        info.currency
      );
    }
    if (tax) {
      tax.textContent = formatCurrencyAmount(info.taxAmount, info.currency);
    }
    if (total) {
      total.textContent = formatCurrencyAmount(info.amountTotal, info.currency);
    }
    summary.hidden = false;
    summary.classList.remove('ff-tax-summary--updating');
  };

  onTaxPending = () => {
    const summary =
      this.containerEl.querySelector<HTMLElement>('#ffTaxSummary');
    if (summary && !summary.hidden) {
      summary.classList.add('ff-tax-summary--updating');
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
