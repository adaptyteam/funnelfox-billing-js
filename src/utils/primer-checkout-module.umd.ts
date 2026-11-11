/**
 * @fileoverview Where Primer Checkout comes from in the UMD build: there is no bundler on the page, so the build
 * ships primer-js next to the SDK script (`dist/primer-js/`) and imports it from the same host.
 */

import { PRIMER_CHECKOUT_DIR } from '../constants';

// document.currentScript is only set while the script runs for the first time, so it is read at load.
const sdkScriptSrc =
  typeof document !== 'undefined' &&
  document.currentScript instanceof HTMLScriptElement
    ? document.currentScript.src
    : '';

export const PRIMER_CHECKOUT_SOURCE = sdkScriptSrc
  ? new URL(`${PRIMER_CHECKOUT_DIR}/primer-loader.js`, sdkScriptSrc).href
  : '';

export function importPrimerCheckoutModule(): Promise<{
  loadPrimer: () => void;
}> {
  if (!PRIMER_CHECKOUT_SOURCE) {
    return Promise.reject(
      new Error(
        'Cannot locate Primer Checkout: the SDK script URL is unknown. Load the SDK with a <script src> tag.'
      )
    );
  }
  return import(
    /* webpackIgnore: true */ /* @vite-ignore */ PRIMER_CHECKOUT_SOURCE
  );
}
