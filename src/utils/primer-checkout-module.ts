/**
 * @fileoverview Where Primer Checkout comes from in the ESM and CommonJS builds: the integrator's bundler resolves
 * `@primer-io/primer-js` from node_modules and serves it as a lazy chunk from the integrator's own host.
 * The UMD build swaps this file for `primer-checkout-module.umd.ts` (see rollup.config.js).
 */

export const PRIMER_CHECKOUT_SOURCE = '@primer-io/primer-js';

export function importPrimerCheckoutModule() {
  return import('@primer-io/primer-js');
}
