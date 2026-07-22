/**
 * @fileoverview Adyen wallet purchase (Apple Pay / Google Pay) via unmounted Adyen Web components.
 *
 * Mirrors `stripe/stripe-wallet.ts`: the host page renders its own wallet button and calls
 * `purchaseWallet` from the click; the Adyen component is created without mounting and
 * `submit()` opens the native sheet. Availability comes from the session's /paymentMethods
 * response plus the component's own `isAvailable()` device check.
 *
 * Standalone from `adyen-card-form.ts`'s Drop-in, which already renders these same wallets inline —
 * this is for hosts that want a prominent wallet button outside the full payment form.
 */

import {
  getAdyenWeb,
  findAdyenPaymentMethod,
  isAdyenCancel,
} from './adyen-loader';
import type {
  AdyenActions,
  AdyenCheckoutConfig,
  AdyenCheckoutInstance,
  AdyenComponent,
  AdyenState,
  AdyenWeb,
} from './adyen-loader';
import type APIClient from '../api-client';
import type { AdyenClientSessionResponse, AdyenWalletOptions } from '../types';

type AdyenWallet = 'APPLE_PAY' | 'GOOGLE_PAY';

// Availability is probed in this order; Apple Pay wins when both report available (Safari),
// matching the Stripe paymentRequest preference.
const WALLET_TX_VARIANTS: [AdyenWallet, string][] = [
  ['APPLE_PAY', 'applepay'],
  ['GOOGLE_PAY', 'googlepay'],
];

const WALLET_COMPONENT: Record<string, 'GooglePay' | 'ApplePay'> = {
  googlepay: 'GooglePay',
  applepay: 'ApplePay',
};

type AdyenCheckoutHandlers = Pick<
  AdyenCheckoutConfig,
  'onSubmit' | 'onAdditionalDetails' | 'onError'
>;

function walletConfig(
  session: AdyenClientSessionResponse,
  txVariant: string,
  collectBillingAddress: boolean
): Record<string, unknown> {
  const { adyen_google_pay_merchant_id } = session.data;
  const config: Record<string, unknown> = {};
  if (txVariant === 'googlepay') {
    // /paymentMethods carries gatewayMerchantId (and merchantId when set in the Customer Area);
    // the org-level Google Pay Console merchant id from the session overrides — Google requires
    // it for production web integrations.
    const configuration = {
      ...findAdyenPaymentMethod(session.data.adyen_payment_methods, txVariant)
        ?.configuration,
      ...(adyen_google_pay_merchant_id
        ? { merchantId: adyen_google_pay_merchant_id }
        : {}),
    };
    if (Object.keys(configuration).length) config.configuration = configuration;
    if (collectBillingAddress) {
      config.billingAddressRequired = true;
      config.billingAddressParameters = { format: 'FULL' };
    }
  }
  if (txVariant === 'applepay' && collectBillingAddress) {
    config.requiredBillingContactFields = ['postalAddress'];
  }
  return config;
}

async function isComponentAvailable(
  component: AdyenComponent
): Promise<boolean> {
  try {
    return (await component.isAvailable?.()) !== false;
  } catch {
    return false;
  }
}

async function pickWallet(
  adyenWeb: AdyenWeb,
  checkout: AdyenCheckoutInstance,
  session: AdyenClientSessionResponse,
  collectBillingAddress: boolean
): Promise<{ wallet: AdyenWallet; component: AdyenComponent } | null> {
  for (const [wallet, txVariant] of WALLET_TX_VARIANTS) {
    if (!findAdyenPaymentMethod(session.data.adyen_payment_methods, txVariant))
      continue;
    const Component = adyenWeb[WALLET_COMPONENT[txVariant]];
    const component = new Component(
      checkout,
      walletConfig(session, txVariant, collectBillingAddress)
    );
    if (await isComponentAvailable(component)) return { wallet, component };
  }
  return null;
}

async function buildCheckout(
  adyenWeb: AdyenWeb,
  session: AdyenClientSessionResponse,
  handlers: AdyenCheckoutHandlers,
  countryCode?: string
): Promise<AdyenCheckoutInstance> {
  const {
    adyen_client_key,
    adyen_payment_methods,
    amount,
    amount_total,
    currency,
    is_livemode,
    detected_country_code,
  } = session.data;
  return adyenWeb.AdyenCheckout({
    environment: is_livemode ? 'live' : 'test',
    clientKey: adyen_client_key,
    countryCode: detected_country_code || countryCode || 'US',
    paymentMethodsResponse: adyen_payment_methods,
    // The wallet sheet total is fixed at open: first-payment amount plus the detected-country tax
    // estimate, same as the Stripe wallet sheet.
    amount: {
      value: amount_total ?? amount ?? 0,
      currency: (currency || 'usd').toUpperCase(),
    },
    locale: 'en-US',
    ...handlers,
  });
}

export async function getAvailableWallet(
  session: AdyenClientSessionResponse
): Promise<AdyenWallet | null> {
  const adyenWeb = await getAdyenWeb(!!session.data.is_livemode);
  const checkout = await buildCheckout(adyenWeb, session, {});
  const picked = await pickWallet(adyenWeb, checkout, session, false);
  return picked?.wallet ?? null;
}

export async function purchaseWallet(
  session: AdyenClientSessionResponse,
  params: Pick<
    AdyenWalletOptions,
    | 'onPaymentSuccess'
    | 'onPaymentFail'
    | 'onPaymentCancel'
    | 'onLoaderChange'
    | 'email'
    | 'countryCode'
    | 'clientMetadata'
  > & { apiClient: APIClient }
): Promise<void> {
  const { order_id, detected_country_code, tax_calculation_id } = session.data;
  const taxEnabled = session.data.tax_enabled ?? false;
  const adyenWeb = await getAdyenWeb(!!session.data.is_livemode);

  return new Promise<void>((resolve, reject) => {
    const fail = (err: Error): void => {
      params.onPaymentFail?.(err);
      reject(err);
    };

    const onSubmit = (
      state: AdyenState,
      _component: AdyenComponent,
      actions: AdyenActions
    ): void => {
      void (async () => {
        params.onLoaderChange?.(true);
        try {
          // Tax on: the charge stays the estimate the sheet authorized (tax_calculation_id); the
          // wallet's billing address finalizes the committed tax. Tax off: caller country only.
          const address = state.data.billingAddress || {};
          const raw = await params.apiClient.createPayment({
            orderId: order_id,
            paymentMethodToken: JSON.stringify(state.data),
            email: params.email,
            countryCode: taxEnabled
              ? address.country || detected_country_code || params.countryCode
              : params.countryCode,
            postalCode: taxEnabled
              ? address.postalCode || undefined
              : undefined,
            subdivision: taxEnabled
              ? address.stateOrProvince || undefined
              : undefined,
            taxCalculationId: taxEnabled ? tax_calculation_id : undefined,
            clientMetadata: params.clientMetadata,
          });
          const result = params.apiClient.processPaymentResponse(raw);
          if (result.type === 'action_required') {
            actions.resolve({ action: JSON.parse(result.clientToken) });
            return;
          }
          params.onPaymentSuccess?.(order_id);
          actions.resolve({ resultCode: 'Authorised' });
          resolve();
        } catch (err) {
          actions.reject();
          fail(err as Error);
        } finally {
          params.onLoaderChange?.(false);
        }
      })();
    };

    const onAdditionalDetails = (
      state: AdyenState,
      _component: AdyenComponent,
      actions: AdyenActions
    ): void => {
      void (async () => {
        params.onLoaderChange?.(true);
        try {
          const raw = await params.apiClient.resumePayment({
            orderId: order_id,
            resumeToken: JSON.stringify(state.data),
          });
          const result = params.apiClient.processPaymentResponse(raw);
          if (result.type === 'action_required') {
            actions.resolve({ action: JSON.parse(result.clientToken) });
            return;
          }
          params.onPaymentSuccess?.(order_id);
          actions.resolve({ resultCode: 'Authorised' });
          resolve();
        } catch (err) {
          actions.reject();
          fail(err as Error);
        } finally {
          params.onLoaderChange?.(false);
        }
      })();
    };

    void (async () => {
      try {
        const checkout = await buildCheckout(
          adyenWeb,
          session,
          {
            onSubmit,
            onAdditionalDetails,
            onError: error => {
              if (isAdyenCancel(error)) {
                params.onPaymentCancel?.();
                resolve();
                return;
              }
              fail(error as Error);
            },
          },
          params.countryCode
        );
        const picked = await pickWallet(
          adyenWeb,
          checkout,
          session,
          taxEnabled
        );
        if (!picked) throw new Error('No wallet payment method available');
        picked.component.submit?.();
      } catch (err) {
        fail(err as Error);
      }
    })();
  });
}
