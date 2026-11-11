/**
 * @fileoverview Runtime loader for Primer Checkout (@primer-io/primer-js)
 */

import { importPrimerCheckoutModule } from './primer-checkout-module';

let loadingPromise: Promise<void> | null = null;

/**
 * Importing the module registers Primer's custom elements; a second copy on the page throws on the duplicate
 * `customElements.define`, so the module is imported once per page.
 */
export function loadPrimerCheckout(): Promise<void> {
  if (!loadingPromise) {
    loadingPromise = importPrimerCheckoutModule()
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
