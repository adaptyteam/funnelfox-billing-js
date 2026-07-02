/**
 * @fileoverview Adyen Web SDK (Drop-in/Components) CDN loader.
 *
 * Adyen Web is loaded from the checkoutshopper CDN (not npm), so we declare the minimal shapes we
 * use rather than depend on @adyen/adyen-web types.
 */

import { loadScript, loadStylesheet } from '../utils/script-loader';

const ADYEN_WEB_VERSION = '5.66.0';

export interface AdyenBillingAddress {
  country?: string;
  postalCode?: string;
  stateOrProvince?: string;
}

export interface AdyenState {
  data: { billingAddress?: AdyenBillingAddress } & Record<string, unknown>;
  isValid?: boolean;
}

export interface AdyenComponent {
  mount(target: HTMLElement | string): AdyenComponent;
  submit(): void;
  handleAction(action: unknown): void;
}

export interface AdyenCheckoutConfig {
  environment: string;
  clientKey: string;
  paymentMethodsResponse?: unknown;
  amount?: { value: number; currency: string };
  locale?: string;
  onSubmit?: (state: AdyenState, component: AdyenComponent) => void;
  onAdditionalDetails?: (state: AdyenState, component: AdyenComponent) => void;
  onError?: (error: unknown) => void;
}

export interface AdyenCheckoutInstance {
  create(type: string, config?: Record<string, unknown>): AdyenComponent;
}

type AdyenCheckoutFactory = (
  config: AdyenCheckoutConfig
) => Promise<AdyenCheckoutInstance>;

/**
 * Loads Adyen Web (adyen.js + adyen.css) from the CDN and returns the AdyenCheckout factory.
 * Host is livemode-aware; the loaders dedupe so repeated calls are cheap.
 */
export async function getAdyenCheckout(
  isLivemode: boolean
): Promise<AdyenCheckoutFactory> {
  const host = isLivemode
    ? 'https://checkoutshopper-live.adyen.com'
    : 'https://checkoutshopper-test.adyen.com';
  const base = `${host}/checkoutshopper/sdk/${ADYEN_WEB_VERSION}`;

  await Promise.all([
    loadStylesheet({ href: `${base}/adyen.css` }),
    loadScript({ id: 'adyen-web-sdk', src: `${base}/adyen.js`, async: true }),
  ]);

  const factory = (
    window as unknown as { AdyenCheckout?: AdyenCheckoutFactory }
  ).AdyenCheckout;
  if (!factory) throw new Error('Failed to load Adyen Web SDK');
  return factory;
}
