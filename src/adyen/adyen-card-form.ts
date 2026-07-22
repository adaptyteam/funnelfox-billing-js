import {
  getAdyenWeb,
  findAdyenPaymentMethod,
  isAdyenCancel,
} from './adyen-loader';
import type { AdyenActions, AdyenState } from './adyen-loader';
import type APIClient from '../api-client';
import type {
  AdyenClientSessionResponse,
  AdyenCardFormOptions,
  CreatePaymentResponse,
} from '../types';

const TAX_RECALC_DEBOUNCE_MS = 600;

/**
 * Mounts Adyen Drop-in, which renders every method present in the session's `/paymentMethods`
 * response (card, wallets, and any other method enabled on the Adyen account) with no per-method
 * code here — enabling a new method on Adyen is enough for it to appear.
 */
export async function mountAdyenCardForm(
  element: HTMLElement,
  session: AdyenClientSessionResponse,
  params: Pick<
    AdyenCardFormOptions,
    | 'onRenderSuccess'
    | 'onPaymentSuccess'
    | 'onPaymentFail'
    | 'onPaymentCancel'
    | 'onLoaderChange'
    | 'email'
    | 'countryCode'
    | 'clientMetadata'
    | 'enableTax'
    | 'onTaxChange'
  > & { apiClient: APIClient }
): Promise<void> {
  const {
    adyen_client_key,
    adyen_payment_methods,
    adyen_google_pay_merchant_id,
    amount,
    amount_total,
    currency,
    is_livemode,
    order_id,
    client_token,
    detected_country_code,
    show_country_selector_field,
    show_postal_code_field,
    tax_calculation_id: sessionTaxCalculationId,
  } = session.data;
  const taxEnabled = session.data.tax_enabled ?? params.enableTax ?? false;
  const currencyUpper = (currency || 'usd').toUpperCase();
  // Mandatory in v6; falls back for the rare case IP geolocation didn't resolve a country.
  const countryCode = detected_country_code || params.countryCode || 'US';

  const { AdyenCheckout, Dropin } = await getAdyenWeb(!!is_livemode);
  // Remounting (e.g. picking another price) must replace the form, not stack a second one.
  element.replaceChildren();

  let liveTaxCalculationId: string | undefined;
  let taxAddress: { country?: string; postalCode?: string; state?: string } =
    {};
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let flushTaxRecalc = async (): Promise<void> => {};

  const runRecalc = async (): Promise<void> => {
    const country = taxAddress.country || detected_country_code;
    // US tax needs the ZIP to resolve a jurisdiction; skip until it's entered.
    if (!country || (country === 'US' && !taxAddress.postalCode)) return;
    try {
      const tax = await params.apiClient.recalculateTax({
        orderId: order_id,
        clientToken: client_token,
        countryCode: country,
        postalCode: taxAddress.postalCode,
        subdivision: taxAddress.state,
      });
      liveTaxCalculationId = tax.tax_calculation_id;
      params.onTaxChange?.({
        amountTotal: tax.amount_total,
        taxAmount: tax.tax_amount,
        currency: tax.currency,
      });
      // Keeps Drop-in's own pay button and any wallet sheet showing the recalculated total.
      // shouldReinitializeCheckout:false avoids remounting Drop-in (which would collapse the
      // in-progress card fields) on every debounce tick.
      await checkout.update(
        { amount: { value: tax.amount_total, currency: currencyUpper } },
        { shouldReinitializeCheckout: false }
      );
    } catch {
      // Best-effort: keep the current total if recalculation fails.
    }
  };

  const respond = async (
    raw: CreatePaymentResponse,
    actions: AdyenActions
  ): Promise<void> => {
    const result = params.apiClient.processPaymentResponse(raw);
    if (result.type === 'action_required') {
      // Adyen packs the next action (3DS) JSON into action_required_token; Drop-in performs it
      // and the challenge result comes back through onAdditionalDetails.
      actions.resolve({ action: JSON.parse(result.clientToken) });
      return;
    }
    params.onPaymentSuccess?.(order_id);
    actions.resolve({ resultCode: 'Authorised' });
  };

  const checkout = await AdyenCheckout({
    environment: is_livemode ? 'live' : 'test',
    clientKey: adyen_client_key,
    countryCode,
    paymentMethodsResponse: adyen_payment_methods,
    amount: { value: amount_total ?? amount ?? 0, currency: currencyUpper },
    locale: 'en-US',
    onSubmit: (state: AdyenState, _component, actions) => {
      void (async () => {
        params.onLoaderChange?.(true);
        try {
          await flushTaxRecalc();
          // Card gets a live-recalculated tax id from typed-address debouncing; wallets/other
          // methods finalize address only at submit, so they use the session's original estimate.
          const isCard =
            (state.data.paymentMethod as { type?: string } | undefined)
              ?.type === 'scheme';
          const address = state.data.billingAddress || {};
          const raw = await params.apiClient.createPayment({
            orderId: order_id,
            paymentMethodToken: JSON.stringify(state.data),
            email: params.email,
            countryCode: taxEnabled
              ? isCard
                ? address.country
                : address.country || detected_country_code || params.countryCode
              : params.countryCode,
            postalCode: taxEnabled
              ? address.postalCode || undefined
              : undefined,
            subdivision: taxEnabled
              ? address.stateOrProvince || undefined
              : undefined,
            taxCalculationId: taxEnabled
              ? isCard
                ? liveTaxCalculationId
                : sessionTaxCalculationId
              : undefined,
            clientMetadata: params.clientMetadata,
          });
          await respond(raw, actions);
        } catch (err) {
          params.onPaymentFail?.(err as Error);
          actions.reject();
        } finally {
          params.onLoaderChange?.(false);
        }
      })();
    },
    onAdditionalDetails: (state: AdyenState, _component, actions) => {
      void (async () => {
        params.onLoaderChange?.(true);
        try {
          const raw = await params.apiClient.resumePayment({
            orderId: order_id,
            resumeToken: JSON.stringify(state.data),
          });
          await respond(raw, actions);
        } catch (err) {
          params.onPaymentFail?.(err as Error);
          actions.reject();
        } finally {
          params.onLoaderChange?.(false);
        }
      })();
    },
    onError: error => {
      if (isAdyenCancel(error)) {
        params.onPaymentCancel?.();
        return;
      }
      params.onPaymentFail?.(error as Error);
    },
  });

  const billingFields: string[] = [];
  if (show_country_selector_field) billingFields.push('country');
  if (show_postal_code_field) billingFields.push('postalCode');

  // billingAddressRequiredFields renders exactly the listed fields and is country-aware (US shows a
  // localized "Zip code"). Do NOT use billingAddressMode:'partial' — it forces a postal-only layout
  // and hides the country selector even when 'country' is required.
  const cardConfig: Record<string, unknown> = {
    billingAddressRequired: billingFields.length > 0,
    billingAddressRequiredFields: billingFields,
    onChange: (state: AdyenState) => {
      if (!taxEnabled) return;
      const address = state.data.billingAddress;
      if (!address) return;
      taxAddress = {
        country: address.country,
        postalCode: address.postalCode || undefined,
        state: address.stateOrProvince || undefined,
      };
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void runRecalc(), TAX_RECALC_DEBOUNCE_MS);
    },
  };
  if (detected_country_code) {
    cardConfig.data = { billingAddress: { country: detected_country_code } };
  }

  const paymentMethodsConfiguration: Record<string, unknown> = {
    card: cardConfig,
  };
  if (taxEnabled) {
    paymentMethodsConfiguration.applepay = {
      requiredBillingContactFields: ['postalAddress'],
    };
    paymentMethodsConfiguration.googlepay = {
      billingAddressRequired: true,
      billingAddressParameters: { format: 'FULL' },
    };
  }
  if (adyen_google_pay_merchant_id) {
    // /paymentMethods carries gatewayMerchantId (and merchantId when set in the Customer Area);
    // the org-level Google Pay Console merchant id from the session overrides it — Google requires
    // it for production web integrations.
    const existingConfig = findAdyenPaymentMethod(
      adyen_payment_methods,
      'googlepay'
    )?.configuration;
    paymentMethodsConfiguration.googlepay = {
      ...(paymentMethodsConfiguration.googlepay as
        | Record<string, unknown>
        | undefined),
      configuration: {
        ...existingConfig,
        merchantId: adyen_google_pay_merchant_id,
      },
    };
  }

  // Adyen lays postalCode out at 30% width (a col meant to share a row with city); we don't collect
  // city, so it sits alone at a third of the form. Widen it to fill the row.
  const POSTAL_STYLE_ID = 'ff-adyen-postal-width';
  if (
    typeof document !== 'undefined' &&
    !document.getElementById(POSTAL_STYLE_ID)
  ) {
    const style = document.createElement('style');
    style.id = POSTAL_STYLE_ID;
    style.textContent =
      '.adyen-checkout__field--postalCode.adyen-checkout__field--col-30{width:100%!important}';
    document.head.appendChild(style);
  }

  new Dropin(checkout, { paymentMethodsConfiguration }).mount(element);

  flushTaxRecalc = async () => {
    if (debounce) {
      clearTimeout(debounce);
      debounce = undefined;
    }
    if (taxEnabled) await runRecalc();
  };

  params.onRenderSuccess?.();
}
