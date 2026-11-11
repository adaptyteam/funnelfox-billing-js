/**
 * @jest-environment jsdom
 */

function loadUmdSource(currentScript: HTMLScriptElement | null) {
  Object.defineProperty(document, 'currentScript', {
    value: currentScript,
    configurable: true,
  });
  let source: typeof import('../src/utils/primer-checkout-module.umd');
  jest.isolateModules(() => {
    source = require('../src/utils/primer-checkout-module.umd');
  });
  return source!;
}

test('the UMD build loads Primer Checkout from next to the SDK script', () => {
  const script = document.createElement('script');
  script.src =
    'https://static.example.test/billing/0.14.0/funnelfox-billing.min.js';

  const { PRIMER_CHECKOUT_SOURCE } = loadUmdSource(script);

  expect(PRIMER_CHECKOUT_SOURCE).toBe(
    'https://static.example.test/billing/0.14.0/primer-js/primer-loader.js'
  );
});

test('the UMD build refuses to guess the location when the SDK script URL is unknown', async () => {
  const { PRIMER_CHECKOUT_SOURCE, importPrimerCheckoutModule } =
    loadUmdSource(null);

  expect(PRIMER_CHECKOUT_SOURCE).toBe('');
  await expect(importPrimerCheckoutModule()).rejects.toThrow(
    'Cannot locate Primer Checkout'
  );
});
