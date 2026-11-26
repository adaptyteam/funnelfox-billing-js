/**
 * @fileoverview Runtime loader for Primer Checkout (@primer-io/primer-js)
 */

import { PRIMER_CHECKOUT_MODULE_URL } from '../constants';

interface PrimerCheckoutModule {
  loadPrimer: () => void;
}

let loadingPromise: Promise<void> | null = null;

/**
 * Importing the module registers Primer's custom elements; a second copy on the page throws on the duplicate
 * `customElements.define`, so the module is imported once per page.
 */
export function loadPrimerCheckout(): Promise<void> {
  if (!loadingPromise) {
    loadingPromise = (
      import(
        /* webpackIgnore: true */ /* @vite-ignore */ PRIMER_CHECKOUT_MODULE_URL
      ) as Promise<PrimerCheckoutModule>
    )
      .then(module => {
        module.loadPrimer();
      })
      .catch(error => {
        loadingPromise = null;
        throw error;
      });
  }
  return loadingPromise;
}

export function resetPrimerCheckoutLoader(): void {
  loadingPromise = null;
}
