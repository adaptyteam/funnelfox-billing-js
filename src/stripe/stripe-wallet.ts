import { getStripe } from './stripe-loader';
import type { StripeClientSessionResponse, StripeWalletOptions } from '../types';

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
  const { clientSecret, amount, currency, country } = stripe_intent;

  const stripe = await getStripe(stripe_public_key);
  if (!stripe) throw new Error('Failed to load Stripe');

  const paymentRequest = stripe.paymentRequest({
    country,
    currency,
    total: {
      label: params.totalLabel ?? 'Total',
      amount,
    },
    requestPayerName: false,
    requestPayerEmail: false,
  });

  const canPay = await paymentRequest.canMakePayment();
  if (!canPay) throw new Error('No wallet payment method available');

  return new Promise<void>((resolve, reject) => {
    paymentRequest.on('paymentmethod', async event => {
      params.onLoaderChange?.(true);
      try {
        const { error } = await stripe.confirmCardPayment(
          clientSecret,
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
