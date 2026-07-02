/**
 * @fileoverview Adyen wallet purchase (Apple Pay / Google Pay) via unmounted Adyen Web components.
 *
 * Mirrors `stripe/stripe-wallet.ts`: the host page renders its own wallet button and calls
 * `purchaseWallet` from the click; the Adyen component is created without mounting and
 * `submit()` opens the native sheet. Availability comes from the session's /paymentMethods
 * response plus the component's own `isAvailable()` device check.
 */

import { getAdyenCheckout } from './adyen-loader';
import type {
  AdyenCheckoutInstance,
  AdyenComponent,
  AdyenState,
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

interface PaymentMethodsEntry {
  type?: string;
  configuration?: Record<string, unknown>;
}

function paymentMethodEntry(
  session: AdyenClientSessionResponse,
  txVariant: string
): PaymentMethodsEntry | undefined {
  const methods = (
    session.data.adyen_payment_methods as {
      paymentMethods?: PaymentMethodsEntry[];
    } | null
  )?.paymentMethods;
  return methods?.find(m => m.type === txVariant);
}

function walletConfig(
  session: AdyenClientSessionResponse,
  txVariant: string,
  collectBillingAddress: boolean
): Record<string, unknown> {
  const { detected_country_code, adyen_google_pay_merchant_id } = session.data;
  const config: Record<string, unknown> = {};
  if (detected_country_code) config.countryCode = detected_country_code;
  if (txVariant === 'googlepay') {
    // /paymentMethods carries gatewayMerchantId (and merchantId when set in the Customer Area);
    // the org-level Google Pay Console merchant id from the session overrides — Google requires
    // it for production web integrations.
    const configuration = {
      ...paymentMethodEntry(session, txVariant)?.configuration,
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
  checkout: AdyenCheckoutInstance,
  session: AdyenClientSessionResponse,
  collectBillingAddress: boolean
): Promise<{ wallet: AdyenWallet; component: AdyenComponent } | null> {
  for (const [wallet, txVariant] of WALLET_TX_VARIANTS) {
    if (!paymentMethodEntry(session, txVariant)) continue;
    const component = checkout.create(
      txVariant,
      walletConfig(session, txVariant, collectBillingAddress)
    );
    if (await isComponentAvailable(component)) return { wallet, component };
  }
  return null;
}

async function buildCheckout(
  session: AdyenClientSessionResponse,
  handlers: Pick<
    Parameters<Awaited<ReturnType<typeof getAdyenCheckout>>>[0],
    'onSubmit' | 'onAdditionalDetails' | 'onError'
  >
): Promise<AdyenCheckoutInstance> {
  const {
    adyen_client_key,
    adyen_payment_methods,
    amount,
    amount_total,
    currency,
    is_livemode,
  } = session.data;
  const AdyenCheckout = await getAdyenCheckout(!!is_livemode);
  return AdyenCheckout({
    environment: is_livemode ? 'live' : 'test',
    clientKey: adyen_client_key,
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
  const checkout = await buildCheckout(session, {});
  const picked = await pickWallet(checkout, session, false);
  return picked?.wallet ?? null;
}

function isCancel(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'CANCEL';
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

  return new Promise<void>((resolve, reject) => {
    const fail = (err: Error): void => {
      params.onPaymentFail?.(err);
      reject(err);
    };

    const onSubmit = (state: AdyenState, component: AdyenComponent): void => {
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
            component.handleAction(JSON.parse(result.clientToken));
            return;
          }
          params.onPaymentSuccess?.(order_id);
          resolve();
        } catch (err) {
          fail(err as Error);
        } finally {
          params.onLoaderChange?.(false);
        }
      })();
    };

    const onAdditionalDetails = (
      state: AdyenState,
      component: AdyenComponent
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
            component.handleAction(JSON.parse(result.clientToken));
            return;
          }
          params.onPaymentSuccess?.(order_id);
          resolve();
        } catch (err) {
          fail(err as Error);
        } finally {
          params.onLoaderChange?.(false);
        }
      })();
    };

    void (async () => {
      try {
        const checkout = await buildCheckout(session, {
          onSubmit,
          onAdditionalDetails,
          onError: error => {
            if (isCancel(error)) {
              params.onPaymentCancel?.();
              resolve();
              return;
            }
            fail(error as Error);
          },
        });
        const picked = await pickWallet(checkout, session, taxEnabled);
        if (!picked) throw new Error('No wallet payment method available');
        picked.component.submit();
      } catch (err) {
        fail(err as Error);
      }
    })();
  });
}
