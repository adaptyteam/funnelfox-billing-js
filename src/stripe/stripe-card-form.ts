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
  // Tax flow is driven by the tenant setting (session.tax_enabled); enableTax is a legacy override.
  const taxEnabled = session.data.tax_enabled ?? params.enableTax ?? false;

  const stripe = await getStripe(stripe_public_key);
  if (!stripe) throw new Error('Failed to load Stripe');

  // Remounting (e.g. picking another price) must replace the form, not stack a second one.
  element.replaceChildren();

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

  // Tax mode mounts Stripe's Address Element (its change events are readable, so tax recalculates live
  // as the buyer edits the address) above the Payment Element. The country is pre-filled from the
  // detected location so tax is computed from the address (not a separate IP estimate); the resulting
  // calculation id is attached to the PaymentIntent at payment time so Stripe records the tax.
  let taxCalculationId: string | undefined;
  let taxAddress: { country?: string; postalCode?: string; state?: string } =
    {};
  // Flushed on submit so the charge always reflects the final entered address (no estimate drift).
  let flushTaxRecalc = async (): Promise<void> => {};

  if (taxEnabled) {
    const addressContainer = document.createElement('div');
    const paymentContainer = document.createElement('div');
    element.appendChild(addressContainer);
    element.appendChild(paymentContainer);

    const addressElement = stripeElements.create('address', {
      mode: 'billing',
      fields: { phone: 'never' },
      ...(session.data.detected_country_code
        ? {
            defaultValues: {
              address: { country: session.data.detected_country_code },
            },
          }
        : {}),
    });
    addressElement.mount(addressContainer);
    paymentElement.mount(paymentContainer);

    const runRecalc = async (): Promise<void> => {
      const country = taxAddress.country;
      if (!country) return;
      try {
        const tax = await params.apiClient.recalculateTax({
          orderId: order_id,
          clientToken: session.data.client_token,
          countryCode: country,
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
    };

    let debounce: ReturnType<typeof setTimeout> | undefined;
    flushTaxRecalc = async () => {
      if (debounce) {
        clearTimeout(debounce);
        debounce = undefined;
      }
      await runRecalc();
    };

    addressElement.on('change', event => {
      const address = event.value.address;
      taxAddress = {
        country: address.country,
        postalCode: address.postal_code || undefined,
        state: address.state || undefined,
      };
      if (!taxAddress.country) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(runRecalc, TAX_RECALC_DEBOUNCE_MS);
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
        await flushTaxRecalc();
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
          countryCode: taxEnabled ? taxAddress.country : params.countryCode,
          postalCode: taxEnabled ? taxAddress.postalCode : undefined,
          subdivision: taxEnabled ? taxAddress.state : undefined,
          taxCalculationId: taxEnabled ? taxCalculationId : undefined,
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
