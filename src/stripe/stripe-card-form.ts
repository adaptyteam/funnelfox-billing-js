import { getStripe } from './stripe-loader';
import type APIClient from '../api-client';
import type {
  StripeClientSessionResponse,
  StripeCardFormOptions,
  StripeCardForm,
} from '../types';

const TAX_RECALC_DEBOUNCE_MS = 600;

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
    | 'enableTax'
    | 'onTaxChange'
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

  // Tax mode mounts an Address Element above the Payment Element and recalculates tax (via Stripe
  // Tax on the backend) as the address changes, updating the displayed total live. The resulting
  // calculation id is attached to the PaymentIntent at payment time so Stripe records the tax.
  let taxCalculationId: string | undefined;
  let taxAddress: { country?: string; postalCode?: string; state?: string } =
    {};

  if (params.enableTax) {
    const addressContainer = document.createElement('div');
    const paymentContainer = document.createElement('div');
    element.appendChild(addressContainer);
    element.appendChild(paymentContainer);

    const addressElement = stripeElements.create('address', {
      mode: 'billing',
    });
    addressElement.mount(addressContainer);
    paymentElement.mount(paymentContainer);

    let debounce: ReturnType<typeof setTimeout> | undefined;
    addressElement.on('change', event => {
      const address = event.value.address;
      taxAddress = {
        country: address.country,
        postalCode: address.postal_code || undefined,
        state: address.state || undefined,
      };
      if (!taxAddress.country) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        try {
          const tax = await params.apiClient.recalculateTax({
            orderId: order_id,
            countryCode: taxAddress.country as string,
            postalCode: taxAddress.postalCode,
            subdivision: taxAddress.state,
          });
          taxCalculationId = tax.tax_calculation_id;
          stripeElements.update({ amount: tax.amount_total });
          params.onTaxChange?.({
            amountTotal: tax.amount_total,
            taxAmount: tax.tax_amount,
            currency: tax.currency,
          });
        } catch {
          // Best-effort: keep the current total if recalculation fails.
        }
      }, TAX_RECALC_DEBOUNCE_MS);
    });
  } else {
    paymentElement.mount(element);
  }

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
          countryCode: params.enableTax
            ? taxAddress.country
            : params.countryCode,
          postalCode: params.enableTax ? taxAddress.postalCode : undefined,
          subdivision: params.enableTax ? taxAddress.state : undefined,
          taxCalculationId: params.enableTax ? taxCalculationId : undefined,
          clientMetadata: params.clientMetadata,
        });
        const result = params.apiClient.processPaymentResponse(raw);

        if (result.type === 'action_required') {
          const { error: actionError } = await stripe.handleNextAction({
            clientSecret: result.clientToken,
          });
          if (actionError) throw actionError;
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
