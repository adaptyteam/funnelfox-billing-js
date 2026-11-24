import { DEFAULT_BUTTONS_OPTIONS } from './constants';
import { PaymentMethod } from './enums';
import type { CheckoutConfigWithCallbacks, MethodGroupOptions } from './types';

export function methodCheckoutConfig(
  options: MethodGroupOptions
): CheckoutConfigWithCallbacks {
  return {
    priceId: options.priceId,
    customer: {
      externalId: options.externalId,
      email: options.email,
    },
    container: '',
    clientMetadata: options.meta,
    displayCurrency: options.displayCurrency,
    displayCountry: options.displayCountry,
    sessionScope: options.sessionScope,
    card: options.card,
    style: options.style,
    applePay: {
      ...DEFAULT_BUTTONS_OPTIONS[PaymentMethod.APPLE_PAY],
      ...(options.applePay || {}),
    },
    paypal: {
      ...DEFAULT_BUTTONS_OPTIONS[PaymentMethod.PAYPAL],
      ...(options.paypal || {}),
    },
    googlePay: {
      ...DEFAULT_BUTTONS_OPTIONS[PaymentMethod.GOOGLE_PAY],
      ...(options.googlePay || {}),
    },
    onTaxChange: options.onTaxChange,
    onTaxError: options.onTaxError,
    onTaxPending: options.onTaxPending,
  };
}
