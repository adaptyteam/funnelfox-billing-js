import { getStripe } from './stripe-loader';
import type { Stripe } from '@stripe/stripe-js';
import type { StripeClientSessionResponse, StripeWalletOptions } from '../types';

function buildPaymentRequest(
  stripe: Stripe,
  stripe_intent: StripeClientSessionResponse['data']['stripe_intent'],
  totalLabel?: string
) {
  return stripe.paymentRequest({
    country: stripe_intent.country,
    currency: stripe_intent.currency,
    total: {
      label: totalLabel ?? 'Total',
      amount: stripe_intent.amount,
    },
    requestPayerName: false,
    requestPayerEmail: false,
  });
}

export async function getAvailableWallet(
  session: StripeClientSessionResponse
): Promise<'APPLE_PAY' | 'GOOGLE_PAY' | null> {
  const { stripe_public_key, stripe_intent } = session.data;

  const stripe = await getStripe(stripe_public_key);
  if (!stripe) throw new Error('Failed to load Stripe');

  const paymentRequest = buildPaymentRequest(stripe, stripe_intent);
  const result = await paymentRequest.canMakePayment();
  if (!result) return null;
  if (result.applePay) return 'APPLE_PAY';
  if (result.googlePay) return 'GOOGLE_PAY';
  return null;
}

export async function purchaseWallet(
  session: StripeClientSessionResponse,
  params: Pick<
    StripeWalletOptions,
    | 'totalLabel'
    | 'onPaymentSuccess'
    | 'onPaymentFail'
    | 'onPaymentCancel'
    | 'onLoaderChange'
  >
): Promise<void> {
  const { stripe_public_key, stripe_intent } = session.data;
  const { intent_client_secret } = stripe_intent;

  const stripe = await getStripe(stripe_public_key);
  if (!stripe) throw new Error('Failed to load Stripe');

  const paymentRequest = buildPaymentRequest(stripe, stripe_intent, params.totalLabel);

  const canPay = await paymentRequest.canMakePayment();
  if (!canPay) throw new Error('No wallet payment method available');

  return new Promise<void>((resolve, reject) => {
    paymentRequest.on('paymentmethod', async event => {
      params.onLoaderChange?.(true);
      try {
        const { error } = await stripe.confirmCardPayment(
          intent_client_secret,
          { payment_method: event.paymentMethod.id },
          { handleActions: false }
        );
        if (error) {
          event.complete('fail');
          throw error;
        }
        event.complete('success');
        params.onPaymentSuccess?.(event.paymentMethod);
        resolve();
      } catch (err) {
        params.onPaymentFail?.(err as Error);
        reject(err);
      } finally {
        params.onLoaderChange?.(false);
      }
    });

    paymentRequest.on('cancel', () => {
      params.onPaymentCancel?.();
      resolve();
    });

    paymentRequest.show();
  });
}
