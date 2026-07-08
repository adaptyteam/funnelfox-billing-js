import { getStripe } from './stripe-loader';
import { formatCurrencyAmount } from '../utils/helpers';
import type APIClient from '../api-client';
import type {
  StripeClientSessionResponse,
  StripeCardFormOptions,
  StripeCardForm,
  TaxInfo,
} from '../types';

const TAX_STYLE_ID = 'ff-stripe-tax-styles';
const TAX_RECALC_DEBOUNCE_MS = 600;

// The Stripe card form renders Stripe Elements (not the card skin), so it owns its own subtotal/tax/
// total summary here — mirroring the hosted card skin so every integration shows tax consistently
// without the host page reimplementing it.
function injectTaxStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(TAX_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TAX_STYLE_ID;
  style.textContent = [
    '.ff-tax-summary{margin-top:12px;padding-top:12px;border-top:1px solid rgb(0 0 0 / 10%);font-size:16px;transition:opacity .2s ease}',
    '.ff-tax-summary[hidden]{display:none}',
    '.ff-tax-summary--updating{opacity:.55}',
    '.ff-tax-row{display:flex;justify-content:space-between;gap:10px;margin-bottom:6px}',
    '.ff-tax-row.ff-tax-total{margin-top:8px;margin-bottom:0;font-weight:600}',
  ].join('\n');
  document.head.appendChild(style);
}

interface TaxSummary {
  root: HTMLElement;
  render(info: TaxInfo | null): void;
  setPending(): void;
}

function createTaxSummary(): TaxSummary {
  const root = document.createElement('div');
  root.className = 'ff-tax-summary';
  root.hidden = true;

  const makeRow = (label: string, isTotal = false): HTMLElement => {
    const rowEl = document.createElement('div');
    rowEl.className = isTotal ? 'ff-tax-row ff-tax-total' : 'ff-tax-row';
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    rowEl.append(labelEl, valueEl);
    root.appendChild(rowEl);
    return valueEl;
  };
  const subtotalEl = makeRow('Subtotal');
  const taxEl = makeRow('Tax');
  const totalEl = makeRow('Total', true);

  return {
    root,
    // taxAmount is the tax added on top of the price; it is 0 for tax-inclusive pricing and for
    // non-taxed locations — in both cases there is nothing to itemise, so the summary stays hidden.
    render(info: TaxInfo | null) {
      root.classList.remove('ff-tax-summary--updating');
      if (!info || !(info.taxAmount > 0)) {
        root.hidden = true;
        return;
      }
      subtotalEl.textContent = formatCurrencyAmount(
        info.amountTotal - info.taxAmount,
        info.currency
      );
      taxEl.textContent = formatCurrencyAmount(info.taxAmount, info.currency);
      totalEl.textContent = formatCurrencyAmount(
        info.amountTotal,
        info.currency
      );
      root.hidden = false;
    },
    setPending() {
      if (!root.hidden) root.classList.add('ff-tax-summary--updating');
    },
  };
}

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
  const {
    stripe_public_key,
    amount,
    currency,
    order_id,
    is_link_enabled,
    tax_amount,
    amount_total,
  } = session.data;
  // Tax flow is driven by the tenant setting (session.tax_enabled); enableTax is a legacy override.
  const taxEnabled = session.data.tax_enabled ?? params.enableTax ?? false;

  const stripe = await getStripe(stripe_public_key);
  if (!stripe) throw new Error('Failed to load Stripe');

  // Remounting (e.g. picking another price) must replace the form, not stack a second one.
  element.replaceChildren();

  injectTaxStyles();
  const taxSummary = createTaxSummary();

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
    // Collect only the country + postal code Stripe Tax needs; hide the rest of the billing address.
    fields: {
      billingDetails: {
        address: {
          line1: 'never' as const,
          line2: 'never' as const,
          city: 'never' as const,
          state: 'never' as const,
          country: 'auto' as const,
          postalCode: 'auto' as const,
        },
      },
    },
    ...(session.data.detected_country_code
      ? {
          defaultValues: {
            billingDetails: {
              address: { country: session.data.detected_country_code },
            },
          },
        }
      : {}),
  });

  // Tax needs only the country + postal code, which the Payment Element collects (see fields above). We
  // read them from its change events as the buyer types to recalculate tax live, then attach the
  // calculation id to the charge so the PaymentIntent records the right tax. The country is pre-filled
  // from the detected location so the first calculation matches the buyer's likely jurisdiction.
  let taxCalculationId: string | undefined;
  let taxAddress: { country?: string; postalCode?: string } = {};
  let flushTaxRecalc = async (): Promise<void> => {};

  const runRecalc = async (): Promise<void> => {
    const country = taxAddress.country;
    if (!country) return;
    try {
      const tax = await params.apiClient.recalculateTax({
        orderId: order_id,
        clientToken: session.data.client_token,
        countryCode: country,
        postalCode: taxAddress.postalCode,
      });
      taxCalculationId = tax.tax_calculation_id;
      const info: TaxInfo = {
        amountTotal: tax.amount_total,
        taxAmount: tax.tax_amount,
        currency: tax.currency,
      };
      taxSummary.render(info);
      params.onTaxChange?.(info);
    } catch {
      // Best-effort: keep the current tax estimate if recalculation fails.
    }
  };

  paymentElement.mount(element);

  if (taxEnabled) {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    flushTaxRecalc = async () => {
      if (debounce) {
        clearTimeout(debounce);
        debounce = undefined;
      }
      await runRecalc();
    };
    paymentElement.on('change', event => {
      // Stripe exposes the entered billing address on the change event as the buyer types (camelCase,
      // not yet reflected in the installed @stripe/stripe-js types), so we recalculate tax live.
      const address = (
        event.value as {
          billingDetails?: { address?: { country?: string; postalCode?: string } };
        }
      ).billingDetails?.address;
      if (!address?.country) return;
      taxAddress = {
        country: address.country,
        postalCode: address.postalCode || undefined,
      };
      taxSummary.setPending();
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(runRecalc, TAX_RECALC_DEBOUNCE_MS);
    });
  }

  // SDK-owned summary lives below the form and reflects the session's tax estimate immediately; in tax
  // mode the Payment Element's country + postal fields then keep it in sync as the buyer edits them.
  element.appendChild(taxSummary.root);
  taxSummary.render(
    amount_total != null
      ? { amountTotal: amount_total, taxAmount: tax_amount ?? 0, currency }
      : null
  );
  // Refine the initial estimate against the pre-filled country right away.
  if (taxEnabled) void runRecalc();

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
        // Flush any pending debounce so the charge reflects the final entered country + postal code.
        if (taxEnabled) await flushTaxRecalc();

        const { error: submitError } = await stripeElements.submit();
        if (submitError) throw submitError;

        const { error, paymentMethod } = await stripe.createPaymentMethod({
          elements: stripeElements,
          // We hide line1/line2/city/state on the Payment Element (fields=never); Stripe then requires
          // those values here. Only country + postal (collected by the element) matter for tax.
          ...(taxEnabled
            ? {
                params: {
                  billing_details: {
                    address: { line1: '', line2: '', city: '', state: '' },
                  },
                },
              }
            : {}),
        });
        if (error) throw error;

        const raw = await params.apiClient.createPayment({
          orderId: order_id,
          paymentMethodToken: paymentMethod.id,
          email: params.email,
          countryCode: taxEnabled ? taxAddress.country : params.countryCode,
          postalCode: taxEnabled ? taxAddress.postalCode : undefined,
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
