/**
 * @fileoverview Adyen Web SDK (Drop-in/Components) CDN loader.
 *
 * Adyen Web is loaded from the checkoutshopper CDN (not npm), so we declare the minimal shapes we
 * use rather than depend on @adyen/adyen-web types. v6's UMD build exposes a single `window.AdyenWeb`
 * namespace (AdyenCheckout factory + component constructors), replacing v5's bare `window.AdyenCheckout`.
 */

import { loadScript, loadStylesheet } from '../utils/script-loader';

const ADYEN_WEB_VERSION = '6.40.1';

export interface AdyenBillingAddress {
  country?: string;
  postalCode?: string;
  stateOrProvince?: string;
}

export interface AdyenState {
  data: { billingAddress?: AdyenBillingAddress } & Record<string, unknown>;
  isValid?: boolean;
}

export interface AdyenActions {
  resolve(result: {
    resultCode?: string;
    action?: unknown;
    order?: unknown;
    donationToken?: string;
  }): void;
  reject(): void;
}

export interface AdyenComponent {
  mount(target: HTMLElement | string): AdyenComponent;
  unmount?(): void;
  handleAction?(action: unknown): void;
  updateAmount?(amount: { value: number; currency: string }): void;
  // Standalone (unmounted) wallet components: triggers the native sheet directly.
  submit?(): void;
  // Wallet components only (googlepay/applepay): device/browser availability check.
  isAvailable?(): Promise<unknown>;
}

export interface AdyenCheckoutConfig {
  environment: string;
  clientKey: string;
  // Mandatory in v6 (was optional/inferred in v5); drives the whole checkout's locale/currency
  // defaults, so per-component countryCode overrides are no longer needed.
  countryCode: string;
  paymentMethodsResponse?: unknown;
  amount?: { value: number; currency: string };
  locale?: string;
  onSubmit?: (
    state: AdyenState,
    component: AdyenComponent,
    actions: AdyenActions
  ) => void;
  onAdditionalDetails?: (
    state: AdyenState,
    component: AdyenComponent,
    actions: AdyenActions
  ) => void;
  onError?: (error: unknown, component?: AdyenComponent) => void;
}

export interface AdyenCheckoutInstance {
  // Debounced tax recalcs push the new amount here so mounted components (Drop-in, wallet sheets)
  // reflect it; shouldReinitializeCheckout:false avoids remounting Drop-in mid-edit.
  update(
    config: Partial<AdyenCheckoutConfig>,
    options?: { shouldReinitializeCheckout?: boolean }
  ): Promise<AdyenCheckoutInstance>;
}

export interface AdyenDropinConfig {
  paymentMethodsConfiguration?: Record<string, unknown>;
}

export type AdyenDropinInstance = AdyenComponent;

type AdyenCheckoutFactory = (
  config: AdyenCheckoutConfig
) => Promise<AdyenCheckoutInstance>;

interface AdyenDropinConstructor {
  new (
    checkout: AdyenCheckoutInstance,
    config?: AdyenDropinConfig
  ): AdyenDropinInstance;
}

interface AdyenComponentConstructor {
  new (
    checkout: AdyenCheckoutInstance,
    config?: Record<string, unknown>
  ): AdyenComponent;
}

export interface AdyenWeb {
  AdyenCheckout: AdyenCheckoutFactory;
  Dropin: AdyenDropinConstructor;
  GooglePay: AdyenComponentConstructor;
  ApplePay: AdyenComponentConstructor;
}

/**
 * Loads Adyen Web (adyen.js + adyen.css) from the CDN and returns its `AdyenWeb` namespace. Host is
 * livemode-aware; the loaders dedupe so repeated calls are cheap.
 */
export async function getAdyenWeb(isLivemode: boolean): Promise<AdyenWeb> {
  const host = isLivemode
    ? 'https://checkoutshopper-live.adyen.com'
    : 'https://checkoutshopper-test.adyen.com';
  const base = `${host}/checkoutshopper/sdk/${ADYEN_WEB_VERSION}`;

  await Promise.all([
    loadStylesheet({ href: `${base}/adyen.css` }),
    loadScript({ id: 'adyen-web-sdk', src: `${base}/adyen.js`, async: true }),
  ]);

  const adyenWeb = (window as unknown as { AdyenWeb?: AdyenWeb }).AdyenWeb;
  if (!adyenWeb) throw new Error('Failed to load Adyen Web SDK');
  return adyenWeb;
}

export interface AdyenPaymentMethodEntry {
  type?: string;
  configuration?: Record<string, unknown>;
}

export function findAdyenPaymentMethod(
  paymentMethodsResponse: unknown,
  txVariant: string
): AdyenPaymentMethodEntry | undefined {
  const methods = (
    paymentMethodsResponse as {
      paymentMethods?: AdyenPaymentMethodEntry[];
    } | null
  )?.paymentMethods;
  return methods?.find(m => m.type === txVariant);
}

export function isAdyenCancel(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'CANCEL';
}
