import { getVisibleHostedInputError } from '../src/utils/helpers';

// Payloads recorded from Primer's hosted inputs (checkout-web 2.57.3) on the
// card form: card number 4111111111111111111, expiry 3254.
const typingIncompleteCardNumber = {
  error: 'Card number is incomplete',
  errorCode: 'cardIncomplete',
  valid: false,
  active: true,
  dirty: true,
  touched: false,
  submitted: false,
};
const leftIncompleteCardNumber = {
  ...typingIncompleteCardNumber,
  active: false,
  touched: true,
};
const retypingIncompleteCardNumber = {
  ...typingIncompleteCardNumber,
  touched: true,
};
const typingInvalidCardNumber = {
  error: 'Card number is invalid',
  errorCode: 'cardInvalid',
  valid: false,
  active: true,
  dirty: true,
  touched: false,
  submitted: false,
};
const typingInvalidExpiryYear = {
  error: 'Expiry date year is invalid',
  errorCode: 'expiryYearInvalid',
  valid: false,
  active: true,
  dirty: true,
  touched: false,
  submitted: false,
};
const cvvNotReachedYet = {
  error: 'CVV number is required',
  errorCode: 'cvvRequired',
  valid: false,
  active: false,
  dirty: false,
  touched: false,
  submitted: false,
};
const cvvTabbedThrough = { ...cvvNotReachedYet, touched: true };
const cvvAfterSubmit = { ...cvvNotReachedYet, submitted: true };
const cardNumberClearedAndLeft = {
  error: 'Card number is required',
  errorCode: 'cardRequired',
  valid: false,
  active: false,
  dirty: true,
  touched: true,
  submitted: false,
};
const retypingIncompleteAfterSubmit = {
  ...retypingIncompleteCardNumber,
  submitted: true,
};
const validCardNumber = {
  error: null,
  errorCode: null,
  valid: true,
  active: false,
  dirty: true,
  touched: true,
  submitted: true,
};

describe('getVisibleHostedInputError', () => {
  test('hides an incomplete value while the buyer is typing', () => {
    expect(getVisibleHostedInputError(typingIncompleteCardNumber)).toBeNull();
  });

  test('shows an incomplete value once the buyer leaves the field', () => {
    expect(getVisibleHostedInputError(leftIncompleteCardNumber)).toBe(
      'Card number is incomplete'
    );
  });

  test('hides an incomplete value again when the buyer returns to the field', () => {
    expect(getVisibleHostedInputError(retypingIncompleteCardNumber)).toBeNull();
  });

  test('hides an incomplete value in the focused field after a submit attempt', () => {
    expect(
      getVisibleHostedInputError(retypingIncompleteAfterSubmit)
    ).toBeNull();
  });

  test('shows a card number that can never become valid while the buyer is typing', () => {
    expect(getVisibleHostedInputError(typingInvalidCardNumber)).toBe(
      'Card number is invalid'
    );
  });

  test('waits for the buyer to leave the expiry field, since a half-typed date looks invalid', () => {
    expect(getVisibleHostedInputError(typingInvalidExpiryYear)).toBeNull();
    expect(
      getVisibleHostedInputError({
        ...typingInvalidExpiryYear,
        active: false,
        touched: true,
      })
    ).toBe('Expiry date year is invalid');
  });

  test('stays quiet for a field the buyer has not reached', () => {
    expect(getVisibleHostedInputError(cvvNotReachedYet)).toBeNull();
  });

  test('stays quiet for an empty field the buyer left', () => {
    expect(getVisibleHostedInputError(cvvTabbedThrough)).toBeNull();
    expect(getVisibleHostedInputError(cardNumberClearedAndLeft)).toBeNull();
  });

  test('shows an empty field error after a submit attempt', () => {
    expect(getVisibleHostedInputError(cvvAfterSubmit)).toBe(
      'CVV number is required'
    );
  });

  test('clears the error once the value is valid', () => {
    expect(getVisibleHostedInputError(validCardNumber)).toBeNull();
  });
});
