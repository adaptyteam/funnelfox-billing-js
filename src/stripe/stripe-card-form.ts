import { getStripe } from './stripe-loader';
import type APIClient from '../api-client';
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
    | 'appearance'
    | 'onRenderSuccess'
    | 'onRenderError'
    | 'onPaymentSuccess'
    | 'onPaymentFail'
    | 'onLoaderChange'
    | 'email'
    | 'countryCode'
    | 'clientMetadata'
  > & {
    apiClient: APIClient;
  }
): Promise<StripeCardForm> {
  const { stripe_public_key, amount, currency, order_id, is_link_enabled } =
    session.data;

  const stripe = await getStripe(stripe_public_key);
  if (!stripe) throw new Error('Failed to load Stripe');

  const stripeElements = stripe.elements({
    mode: 'subscription',
    amount,
    currency,
    paymentMethodCreation: 'manual',
    paymentMethodTypes: is_link_enabled ? ['card', 'link'] : ['card'],
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

        const raw = await params.apiClient.createPayment({
          orderId: order_id,
          paymentMethodToken: paymentMethod.id,
          email: params.email,
          countryCode: params.countryCode,
          clientMetadata: params.clientMetadata,
        });
        const result = params.apiClient.processPaymentResponse(raw);

        if (result.type === 'action_required') {
          const { error: confirmError } = await stripe.confirmPayment({
            clientSecret: result.clientToken,
            redirect: 'if_required',
            confirmParams: { return_url: window.location.href },
          });
          if (confirmError) throw confirmError;
        }

        params.onPaymentSuccess?.(paymentMethod, order_id);
      } catch (err) {
        params.onPaymentFail?.(err as Error);
        throw err;
      } finally {
        params.onLoaderChange?.(false);
      }
    },
  };
}
