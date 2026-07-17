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
  setIdle(): void;
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
    setIdle() {
      root.classList.remove('ff-tax-summary--updating');
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
    | 'onTaxError'
  > & {
    apiClient: APIClient;
    invalidateSession?: () => void;
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

  // Which location fields the org collects at checkout (Taxes → Settings). When neither is on, tax
  // follows the IP-derived location the backend already used for the session estimate.
  const showCountry = session.data.show_country_selector_field ?? false;
  const showPostal = session.data.show_postal_code_field ?? false;
  const collectLocation = showCountry || showPostal;

  const paymentElement = stripeElements.create('payment', {
    layout: 'tabs',
    wallets: {
      applePay: params.showWallets ? 'auto' : 'never',
      googlePay: params.showWallets ? 'auto' : 'never',
    },
    terms: { card: 'never' },
    fields: {
      billingDetails: {
        // In tax mode collect only what the org configured (country and/or postal) and hide the rest
        // of the address; otherwise use Stripe's default card billing (country + postal).
        address: taxEnabled
          ? {
              line1: 'never',
              line2: 'never',
              city: 'never',
              state: 'never',
              country: showCountry ? 'auto' : 'never',
              postalCode: collectLocation ? 'auto' : 'never',
            }
          : 'auto',
      },
    },
    ...(session.data.detected_country_code && (!taxEnabled || showCountry)
      ? {
          defaultValues: {
            billingDetails: {
              address: { country: session.data.detected_country_code },
            },
          },
        }
      : {}),
  });

  // Address fields we hid (fields=never) must still be supplied to createPaymentMethod. Only country +
  // postal matter for tax; country is hidden only when the selector is off, postal only when we collect
  // no location at all.
  const hiddenBillingAddress: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    country?: string;
    postal_code?: string;
  } = { line1: '', line2: '', city: '', state: '' };
  if (!showCountry)
    hiddenBillingAddress.country = session.data.detected_country_code ?? '';
  if (!collectLocation) hiddenBillingAddress.postal_code = '';

  // Tax needs only the country + postal code. When the org collects location on the form we read it from
  // the Payment Element's change events as the buyer types and recalculate tax live, then attach the
  // calculation id to the charge. When it does not, tax follows the IP-derived session estimate.
  let taxCalc: { id: string; country?: string; postal?: string } | undefined;
  let recalcSeq = 0;
  if (taxEnabled && session.data.tax_calculation_id) {
    taxCalc = {
      id: session.data.tax_calculation_id,
      country: session.data.detected_country_code ?? undefined,
      postal: undefined,
    };
  }
  let taxAddress: { country?: string; postalCode?: string } = {};
  let flushTaxRecalc = async (): Promise<void> => {};

  const runRecalc = async (): Promise<void> => {
    const country = taxAddress.country;
    const postal = taxAddress.postalCode;
    if (!country) {
      taxSummary.setIdle();
      return;
    }
    const seq = ++recalcSeq;
    try {
      const tax = await params.apiClient.recalculateTax({
        orderId: order_id,
        clientToken: session.data.client_token,
        countryCode: country,
        postalCode: postal,
      });
      if (seq !== recalcSeq) return; // a newer recalc superseded this one
      taxCalc = { id: tax.tax_calculation_id, country, postal };
      const info: TaxInfo = {
        amountTotal: tax.amount_total,
        taxAmount: tax.tax_amount,
        currency: tax.currency,
      };
      taxSummary.render(info);
      params.onTaxChange?.(info);
    } catch (err) {
      if (seq !== recalcSeq) return;
      if (
        !(taxCalc && taxCalc.country === country && taxCalc.postal === postal)
      ) {
        taxCalc = undefined;
        params.onTaxError?.(err as Error);
      }
      taxSummary.setIdle();
    }
  };

  paymentElement.mount(element);

  if (taxEnabled && collectLocation) {
    taxAddress = { country: session.data.detected_country_code || undefined };
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
      // not yet reflected in the installed @stripe/stripe-js types), so we recalculate tax live. The
      // country falls back to the detected one when only a postal field is shown.
      const address = (
        event.value as {
          billingDetails?: {
            address?: { country?: string; postalCode?: string };
          };
        }
      ).billingDetails?.address;
      taxAddress = {
        country:
          address?.country || session.data.detected_country_code || undefined,
        postalCode: address?.postalCode || undefined,
      };
      if (!taxAddress.country) return;
      taxSummary.setPending();
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(runRecalc, TAX_RECALC_DEBOUNCE_MS);
    });
  }

  // SDK-owned summary lives below the form and reflects the session's tax estimate immediately; when the
  // org collects location, the Payment Element's fields then keep it in sync as the buyer edits them.
  element.appendChild(taxSummary.root);
  taxSummary.render(
    amount_total != null
      ? { amountTotal: amount_total, taxAmount: tax_amount ?? 0, currency }
      : null
  );
  // Refine the initial estimate against the pre-filled country right away.
  if (taxEnabled && collectLocation) void runRecalc();

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
        if (taxEnabled && collectLocation) await flushTaxRecalc();

        const { error: submitError } = await stripeElements.submit();
        if (submitError) throw submitError;

        const { error, paymentMethod } = await stripe.createPaymentMethod({
          elements: stripeElements,
          // Supply the address fields we hid on the Payment Element (fields=never); Stripe requires
          // them here. Country/postal collected by the element are filled by Stripe automatically.
          ...(taxEnabled
            ? { params: { billing_details: { address: hiddenBillingAddress } } }
            : {}),
        });
        if (error) throw error;

        const finalCountry = taxEnabled
          ? ((collectLocation
              ? taxAddress.country
              : session.data.detected_country_code) ?? params.countryCode)
          : params.countryCode;
        const finalPostal =
          taxEnabled && collectLocation ? taxAddress.postalCode : undefined;
        const calcIdMatchesAddress =
          taxEnabled &&
          taxCalc &&
          taxCalc.country === finalCountry &&
          taxCalc.postal === finalPostal;

        const raw = await params.apiClient.createPayment({
          orderId: order_id,
          paymentMethodToken: paymentMethod.id,
          email: params.email,
          countryCode: finalCountry,
          postalCode: finalPostal,
          taxCalculationId: calcIdMatchesAddress ? taxCalc!.id : undefined,
          clientMetadata: params.clientMetadata,
        });
        const result = params.apiClient.processPaymentResponse(raw);

        if (result.type === 'action_required') {
          const { error: actionError } = await stripe.handleNextAction({
            clientSecret: result.clientToken,
          });
          if (actionError) throw actionError;
        }

        params.invalidateSession?.();
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
