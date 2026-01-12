/**
 * @fileoverview Dynamic loader for Primer SDK
 * Loads Primer script and CSS from CDN independently of bundler
 */

const PRIMER_CDN_BASE = 'https://sdk.primer.io/web';
const DEFAULT_VERSION = '2.57.3';

// Integrity hashes for specific versions (for SRI security)
const INTEGRITY_HASHES: Record<string, { js: string; css?: string }> = {
  '2.57.3': {
    js: 'sha384-xq2SWkYvTlKOMpuXQUXq1QI3eZN7JiqQ3Sc72U9wY1IE30MW3HkwQWg/1n6BTMz4',
  },
};

let loadingPromise: Promise<void> | null = null;
let isLoaded = false;

/**
 * Injects a script tag into the document head
 */
function injectScript(
  src: string,
  integrity?: string
): Promise<HTMLScriptElement> {
  return new Promise((resolve, reject) => {
    // Check if script already exists
    const existingScript = document.querySelector(
      `script[src="${src}"]`
    ) as HTMLScriptElement;
    if (existingScript) {
      resolve(existingScript);
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';

    if (integrity) {
      script.integrity = integrity;
    }

    script.onload = () => resolve(script);
    script.onerror = () =>
      reject(new Error(`Failed to load Primer SDK script from ${src}`));

    document.head.appendChild(script);
  });
}

/**
 * Injects a CSS link tag into the document head
 */
function injectCSS(href: string, integrity?: string): Promise<HTMLLinkElement> {
  return new Promise((resolve, reject) => {
    // Check if stylesheet already exists
    const existingLink = document.querySelector(
      `link[href="${href}"]`
    ) as HTMLLinkElement;
    if (existingLink) {
      resolve(existingLink);
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.crossOrigin = 'anonymous';

    if (integrity) {
      link.integrity = integrity;
    }

    link.onload = () => resolve(link);
    link.onerror = () =>
      reject(new Error(`Failed to load Primer SDK CSS from ${href}`));

    document.head.appendChild(link);
  });
}

/**
 * Waits for window.Primer to be available
 */
function waitForPrimer(timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      if (
        typeof window !== 'undefined' &&
        window.Primer &&
        typeof window.Primer.createHeadless === 'function'
      ) {
        resolve();
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(
          new Error('Timeout waiting for Primer SDK to initialize on window')
        );
        return;
      }

      setTimeout(check, 50);
    };

    check();
  });
}

/**
 * Loads the Primer SDK script and CSS from CDN
 * @param version - The version of Primer SDK to load (default: 2.57.3)
 * @returns Promise that resolves when SDK is loaded and ready
 */
export async function loadPrimerSDK(version?: string): Promise<void> {
  // Already loaded
  if (isLoaded) {
    return;
  }

  // Already loading - return existing promise
  if (loadingPromise) {
    return loadingPromise;
  }

  // Check if Primer is already available (user may have loaded it manually)
  if (
    typeof window !== 'undefined' &&
    window.Primer &&
    typeof window.Primer.createHeadless === 'function'
  ) {
    isLoaded = true;
    return;
  }

  const ver = version || DEFAULT_VERSION;
  const jsUrl = `${PRIMER_CDN_BASE}/v${ver}/Primer.min.js`;
  const cssUrl = `${PRIMER_CDN_BASE}/v${ver}/Checkout.css`;

  const hashes = INTEGRITY_HASHES[ver];

  loadingPromise = (async () => {
    try {
      // Load CSS and JS in parallel
      await Promise.all([
        injectCSS(cssUrl, hashes?.css),
        injectScript(jsUrl, hashes?.js),
      ]);

      // Wait for Primer to be available on window
      await waitForPrimer();

      isLoaded = true;
    } catch (error) {
      loadingPromise = null;
      throw error;
    }
  })();

  return loadingPromise;
}

/**
 * Checks if Primer SDK is currently loaded
 */
export function isPrimerLoaded(): boolean {
  return isLoaded;
}

/**
 * Resets the loader state (useful for testing)
 */
export function resetPrimerLoader(): void {
  loadingPromise = null;
  isLoaded = false;
}
