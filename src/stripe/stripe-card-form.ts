import { getStripe } from './stripe-loader';
import type {
  StripeClientSessionResponse,
  StripeCardFormOptions,
  StripeCardForm,
} from '../types';

export async function mountStripeCardForm(
  element: HTMLElement,
  session: StripeClientSessionResponse,
  params: Pick<
    StripeCardFormOptions,
    | 'showWallets'
    | 'linkEnabled'
    | 'appearance'
    | 'onRenderSuccess'
    | 'onRenderError'
    | 'onPaymentSuccess'
    | 'onPaymentFail'
    | 'onLoaderChange'
  >
): Promise<StripeCardForm> {
  const { stripe_public_key, stripe_intent } = session.data;
  const { clientSecret, customerSessionClientSecret } = stripe_intent;

  const stripe = await getStripe(stripe_public_key);
  if (!stripe) throw new Error('Failed to load Stripe');

  const stripeElements = stripe.elements({
    clientSecret,
    customerSessionClientSecret,
    appearance: params.appearance,
  });

  const paymentElement = stripeElements.create('payment', {
    layout: 'tabs',
    wallets: {
      applePay: params.showWallets ? 'auto' : 'never',
      googlePay: params.showWallets ? 'auto' : 'never',
    },
    terms: { card: 'never' },
  });

  paymentElement.mount(element);

  await new Promise<void>((resolve, reject) => {
    paymentElement.once('ready', () => resolve());
    // 'loaderror' is a valid Stripe event but not yet in the @stripe/stripe-js types
    paymentElement.once('loaderror', e => reject(e.error));
  });

  params.onRenderSuccess?.();

  return {
    submit: async () => {
      params.onLoaderChange?.(true);
      try {
        const { error: submitError } = await stripeElements.submit();
        if (submitError) throw submitError;

        const { error, paymentMethod } = await stripe.createPaymentMethod({
          elements: stripeElements,
        });
        if (error) throw error;

        // TODO: send paymentMethod.id to backend to confirm PaymentIntent
        params.onPaymentSuccess?.(paymentMethod);
      } catch (err) {
        params.onPaymentFail?.(err as Error);
        throw err;
      } finally {
        params.onLoaderChange?.(false);
      }
    },
  };
}
