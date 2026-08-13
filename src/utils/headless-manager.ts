/**
 * @fileoverview Headless checkout cache manager
 */

import type {
  PrimerHeadlessCheckout,
  HeadlessUniversalCheckoutOptions,
} from '@primer-io/checkout-web';
import type { BillingApplePayOptions } from '../types';
import { merge } from './helpers';
import { PrimerError } from '../errors';
import { PaymentMethod } from '../enums';

/**
 * Primer headless options with our widened Apple Pay typing
 * (see ApplePayButtonType in types.d.ts). The value is handed to
 * Primer as-is — the cast below is type-level only.
 */
type HeadlessOptions = Omit<
  Partial<HeadlessUniversalCheckoutOptions>,
  'applePay'
> & {
  applePay?: BillingApplePayOptions;
};

/**
 * Manages caching and sequential creation of Primer headless checkout instances.
 * Ensures that multiple checkouts with the same configuration reuse the same instance,
 * and that creations happen sequentially to avoid race conditions.
 */
export class HeadlessManager {
  private cache = new Map<string, Promise<PrimerHeadlessCheckout>>();
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Generates a cache key from clientToken and serializable options
   */
  private generateKey(
    clientToken: string,
    options: HeadlessOptions,
    method?: PaymentMethod
  ): string {
    const serializableOptions = {
      paymentHandling: options.paymentHandling,
      apiVersion: options.apiVersion,
      style: options.style,
      card: options.card,
      applePay: options.applePay,
      paypal: options.paypal,
      googlePay: options.googlePay,
    };
    return `${clientToken}:${method || 'default'}:${JSON.stringify(serializableOptions)}`;
  }

  /**
   * Gets a cached headless instance or creates a new one.
   * Ensures sequential creation order to avoid race conditions.
   */
  getOrCreate(
    clientToken: string,
    options: HeadlessOptions,
    method?: PaymentMethod
  ): Promise<PrimerHeadlessCheckout> {
    const key = this.generateKey(clientToken, options, method);

    // Return cached promise if exists
    const cached = this.cache.get(key);
    if (cached) return cached;

    // Create new headless in sequential order
    const previousQueue = this.queue;
    const promise = (async () => {
      await previousQueue; // Wait for previous creation

      const primerOptions = merge<HeadlessUniversalCheckoutOptions>(
        {
          paymentHandling: 'MANUAL',
          apiVersion: '2.4',
        },
        options as Partial<HeadlessUniversalCheckoutOptions>
      );

      try {
        const headlessResult = await window.Primer.createHeadless(
          clientToken,
          primerOptions
        );
        const headless = await headlessResult;
        await headless.start();
        return headless;
      } catch (error: unknown) {
        // Remove from cache on failure
        this.cache.delete(key);
        throw new PrimerError(
          'Failed to create Primer headless checkout',
          error
        );
      }
    })();

    this.cache.set(key, promise);
    this.queue = promise.catch(() => {}); // Update queue, ignore errors
    return promise;
  }

  /**
   * Removes a headless instance from the cache
   */
  remove(headlessPromise: Promise<PrimerHeadlessCheckout>): void {
    for (const [key, value] of this.cache.entries()) {
      if (value === headlessPromise) {
        this.cache.delete(key);
        break;
      }
    }
  }

  /**
   * Clears all cached instances
   */
  clear(): void {
    this.cache.clear();
  }
}
