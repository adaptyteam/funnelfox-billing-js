/**
 * @fileoverview The SDK card skin on Primer Checkout's card form: our labels and fields around Primer's secure
 * inputs, which are styled only through Primer's CSS tokens.
 */

import type {
  CardInputElements,
  CardInputElementsWithButton,
  CardInputSelectors,
  CheckoutRenderOptions,
} from './types';
import { isValidEmail } from './utils/validation';

const TOKENS_STYLE_ID = 'ff-primer-card-tokens';

// Matches the hosted-input skin: 36 px fields, 10 px text inset, 6 px radius, the same border and error colors.
// Primer sizes a field as line-height + 2 x --primer-space-medium and insets the text by the same token, so the
// 36 px height with a 10 px inset is 14 px + 2 x 10 px + 2 x 1 px border.
const TOKENS_CSS = `
.ff-primer-card primer-card-form {
  --primer-typography-body-large-font: inherit;
  --primer-typography-body-large-size: 16px;
  --primer-typography-body-large-line-height: 14px;
  --primer-space-medium: 10px;
  --primer-space-xsmall: 4px;
  --primer-radius-small: 6px;
  --primer-width-default: 1;
  --primer-width-focus: 1;
  --primer-width-error: 1;
  --primer-color-border-outlined-default: rgb(0 0 0 / 10%);
  --primer-color-border-outlined-hover: rgb(0 0 0 / 10%);
  --primer-color-border-outlined-active: rgb(0 0 0 / 10%);
  --primer-color-border-outlined-focus: rgb(0 0 0 / 10%);
  --primer-color-border-outlined-error: rgb(227, 47, 65);
  --primer-color-background-outlined-default: transparent;
  --primer-color-background-outlined-hover: transparent;
  --primer-color-background-outlined-active: transparent;
  --primer-color-background-outlined-focus: transparent;
  --primer-color-background-outlined-error: transparent;
  --primer-color-text-outlined-default: #000;
  --primer-color-text-placeholder: #757575;
  --primer-color-text-negative: #df1b41;
  --primer-typography-error-font: inherit;
  --primer-typography-error-size: 15px;
  --primer-typography-error-line-height: 17px;
  --primer-color-focus: transparent;
  display: block;
}
/* Primer sizes a wallet button as 20 px + 2 x --primer-space-medium: 54 px, as in the legacy skin. */
.ff-primer-wallet {
  --primer-space-medium: 17px;
}
.ff-primer-card primer-input-card-number,
.ff-primer-card primer-input-card-expiry,
.ff-primer-card primer-input-cvv {
  display: block;
}
`;

export function ensureTokens() {
  if (document.getElementById(TOKENS_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = TOKENS_STYLE_ID;
  style.textContent = TOKENS_CSS;
  document.head.appendChild(style);
}

export interface PrimerCardForm {
  submit(): Promise<void>;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

/**
 * Moves the rendered card skin into `<primer-card-form>` (Primer's inputs must live inside it) and puts Primer's
 * number, expiry and CVV inputs into the skin's containers. Our own fields keep the legacy wrapper's validation.
 */
export function renderPrimerCardForm(
  provider: HTMLElement,
  htmlNode: HTMLElement,
  elements: CardInputElements | CardInputElementsWithButton,
  options: CheckoutRenderOptions,
  setCardholderName: (cardholderName: string) => void
): PrimerCardForm {
  ensureTokens();
  const formRoot =
    elements.cardNumber.closest<HTMLElement>('.ff-card-form-container') ||
    htmlNode;

  const form = document.createElement('primer-card-form');
  form.setAttribute('hide-labels', '');
  const slot = document.createElement('div');
  slot.slot = 'card-form-content';
  while (formRoot.firstChild) {
    slot.appendChild(formRoot.firstChild);
  }
  form.appendChild(slot);
  provider.classList.add('ff-primer-card');
  provider.appendChild(form);
  formRoot.appendChild(provider);

  const secureInputs: [HTMLElement, string, string][] = [
    [elements.cardNumber, 'primer-input-card-number', '1234 1234 1234 1234'],
    [elements.expiryDate, 'primer-input-card-expiry', 'MM/YY'],
    [elements.cvv, 'primer-input-cvv', '123'],
  ];
  for (const [container, tag, placeholder] of secureInputs) {
    const input = document.createElement(tag);
    input.setAttribute('placeholder', placeholder);
    container.prepend(input);
  }

  const dispatchError = (
    name: keyof CardInputSelectors,
    error: string | null
  ) => {
    options.onInputChange?.(name, error);
  };
  const getEmailError = () => {
    if (!elements.emailAddress) {
      return null;
    }
    return isValidEmail(elements.emailAddress.value.trim())
      ? null
      : 'Please enter a valid email address';
  };
  const getPostalCodeError = () =>
    options.isPostalCodeRequired?.() && !elements.postalCode?.value.trim()
      ? 'Please enter a postal code'
      : null;
  const getCardholderError = () =>
    options.isCardholderNameRequired?.() &&
    !elements.cardholderName?.value.trim()
      ? 'Please enter the cardholder name'
      : null;

  const onCardholderInput = (event: Event) => {
    setCardholderName((event.target as HTMLInputElement).value);
    dispatchError('cardholderName', null);
  };
  const onEmailInput = (event: Event) => {
    const email = (event.target as HTMLInputElement).value.trim();
    options.onCardInputValueChange?.('emailAddress', email);
    dispatchError(
      'emailAddress',
      email && !isValidEmail(email)
        ? 'Please enter a valid email address'
        : null
    );
  };
  const onCountryChange = (event: Event) => {
    options.onCardInputValueChange?.(
      'countryCode',
      (event.target as HTMLSelectElement).value.trim()
    );
    if (!options.isPostalCodeRequired?.()) {
      dispatchError('postalCode', null);
    }
  };
  const onPostalCodeInput = (event: Event) => {
    options.onCardInputValueChange?.(
      'postalCode',
      (event.target as HTMLInputElement).value.trim()
    );
    dispatchError('postalCode', getPostalCodeError());
  };

  const submit = async () => {
    const cardholderError = getCardholderError();
    const emailError = getEmailError();
    const postalCodeError = getPostalCodeError();
    dispatchError('cardholderName', cardholderError);
    dispatchError('emailAddress', emailError);
    dispatchError('postalCode', postalCodeError);
    if (cardholderError || emailError || postalCodeError) {
      return;
    }
    // The card form listens on itself: a submit dispatched on the document does not reach a form inside a provider.
    form.dispatchEvent(
      new CustomEvent('primer:card-submit', { bubbles: true, composed: true })
    );
  };
  const onButtonClick = () => {
    void submit();
  };

  const button = 'button' in elements ? elements.button : undefined;
  if (button) {
    // A submit-type button inside the card form would be submitted by Primer too, past our validation.
    button.type = 'button';
  }
  elements.cardholderName?.addEventListener('input', onCardholderInput);
  elements.emailAddress?.addEventListener('input', onEmailInput);
  elements.countrySelector?.addEventListener('change', onCountryChange);
  elements.postalCode?.addEventListener('input', onPostalCodeInput);
  button?.addEventListener('click', onButtonClick);

  const ownFields = [
    elements.cardholderName,
    elements.emailAddress,
    elements.countrySelector,
    elements.postalCode,
    button,
  ];

  return {
    submit,
    setDisabled: (disabled: boolean) => {
      form.toggleAttribute('disabled', disabled);
      for (const field of ownFields) {
        if (field) {
          field.disabled = disabled;
        }
      }
    },
    destroy: () => {
      elements.cardholderName?.removeEventListener('input', onCardholderInput);
      elements.emailAddress?.removeEventListener('input', onEmailInput);
      elements.countrySelector?.removeEventListener('change', onCountryChange);
      elements.postalCode?.removeEventListener('input', onPostalCodeInput);
      button?.removeEventListener('click', onButtonClick);
    },
  };
}
