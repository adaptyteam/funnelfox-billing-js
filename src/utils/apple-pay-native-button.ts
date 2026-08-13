/**
 * @fileoverview Support for Apple's official <apple-pay-button> custom element.
 *
 * Primer's checkout-web v2 renders the Apple Pay button through the CSS
 * approach (-webkit-appearance: -apple-pay-button), and WebKit only accepts
 * the 7 legacy values for -apple-pay-button-type. Newer types such as
 * 'continue' are silently dropped and fall back to 'plain' (verified in
 * Safari 26 on macOS and iOS — see PRD-1426).
 *
 * Apple's official custom element supports the full set of button types, so
 * for "native-only" types we overlay it on top of the (visually hidden)
 * Primer button and forward clicks, keeping Primer's payment flow untouched.
 */

import { loadScript } from './script-loader';

const APPLE_PAY_SDK_URL =
  'https://applepay.cdn-apple.com/jsapi/v1/apple-pay-sdk.js';

/** How long to wait for the <apple-pay-button> element definition before
 * giving up and falling back to Primer's own button. */
const ELEMENT_DEFINITION_TIMEOUT_MS = 4000;

/**
 * Button types WebKit can render through Primer's CSS approach.
 * Everything outside this list requires the native <apple-pay-button> element.
 */
export const CSS_RENDERABLE_APPLE_PAY_TYPES: readonly string[] = [
  'plain',
  'buy',
  'set-up',
  'donate',
  'check-out',
  'book',
  'subscribe',
];

/**
 * Returns true when the requested Apple Pay buttonType can only be rendered
 * with Apple's native <apple-pay-button> element.
 */
export function isNativeOnlyApplePayButtonType(type?: string): boolean {
  return !!type && !CSS_RENDERABLE_APPLE_PAY_TYPES.includes(type);
}

/**
 * Loads Apple's apple-pay-sdk.js (defines the <apple-pay-button> custom
 * element). Resolves to true when the element is available.
 */
export async function loadApplePayButtonElement(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.customElements) {
    return false;
  }
  if (window.customElements.get('apple-pay-button')) {
    return true;
  }
  try {
    await loadScript({
      src: APPLE_PAY_SDK_URL,
      crossOrigin: 'anonymous',
      appendTo: 'head',
    });
    // Never hang on a script that loaded but did not define the element —
    // fall back to Primer's own button instead.
    const defined = window.customElements
      .whenDefined('apple-pay-button')
      .then(() => true);
    const timeout = new Promise<boolean>(resolve => {
      setTimeout(() => resolve(false), ELEMENT_DEFINITION_TIMEOUT_MS);
    });
    return await Promise.race([defined, timeout]);
  } catch {
    return false;
  }
}

/**
 * Renders Apple's native <apple-pay-button> stretched over `wrapper` and
 * forwards clicks to the Primer-rendered <button> inside it. The synchronous
 * forwarded click preserves the user activation required by ApplePaySession.
 *
 * Returns the overlay element, or null when the Apple Pay SDK could not be
 * loaded (callers should keep Primer's own button visible as a fallback).
 */
export async function overlayNativeApplePayButton(
  wrapper: HTMLElement,
  options: { buttonType: string; buttonStyle?: string }
): Promise<HTMLElement | null> {
  const available = await loadApplePayButtonElement();
  if (!available) {
    return null;
  }

  // The overlay is only safe when Primer's own clickable button is present —
  // otherwise there is nothing to forward the click to.
  if (!wrapper.querySelector('button')) {
    return null;
  }

  const native = document.createElement('apple-pay-button');
  native.setAttribute('type', options.buttonType);
  native.setAttribute('buttonstyle', options.buttonStyle || 'black');
  native.setAttribute(
    'locale',
    (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
  );
  native.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    '--apple-pay-button-width:100%',
    '--apple-pay-button-height:100%',
    '--apple-pay-button-border-radius:28px',
    'display:block',
    'cursor:pointer',
    'z-index:1',
  ].join(';');

  wrapper.style.position = 'relative';
  native.addEventListener('click', () => {
    const primerButton = wrapper.querySelector('button');
    primerButton?.click();
  });
  wrapper.appendChild(native);
  return native;
}
