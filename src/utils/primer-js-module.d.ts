// The package's own typings reference `lit` and `@paypal/paypal-js` without depending on them, and their global
// HTMLElementTagNameMap entries then turn `document.createElement('primer-*')` into non-elements. Only `loadPrimer`
// is used here, so tsconfig `paths` points the import at this file instead.
export declare function loadPrimer(): void;
