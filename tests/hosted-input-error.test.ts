import { shouldShowHostedInputError } from '../src/utils/helpers';

// Payloads recorded from Primer's hosted inputs (checkout-web 2.57.3) on the
// card form: card number 4111111111111111111, expiry 3254.
const typingCardNumber = {
  error: 'Card number is invalid',
  errorCode: 'cardInvalid',
  valid: false,
  active: true,
  dirty: true,
  touched: false,
  submitted: false,
};
const leftCardNumber = { ...typingCardNumber, active: false, touched: true };
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

describe('shouldShowHostedInputError', () => {
  test('hides the error while the buyer is still typing', () => {
    expect(shouldShowHostedInputError(typingCardNumber)).toBe(false);
  });

  test('shows the error once the buyer leaves a field they typed into', () => {
    expect(shouldShowHostedInputError(leftCardNumber)).toBe(true);
  });

  test('stays quiet for a field the buyer has not reached', () => {
    expect(shouldShowHostedInputError(cvvNotReachedYet)).toBe(false);
  });

  test('stays quiet for an empty field the buyer only tabbed through', () => {
    expect(shouldShowHostedInputError(cvvTabbedThrough)).toBe(false);
  });

  test('shows every error after a submit attempt', () => {
    expect(shouldShowHostedInputError(cvvAfterSubmit)).toBe(true);
  });
});
