/**
 * @fileoverview Generic script and stylesheet loader utility to reduce bundle size
 */

export interface ScriptOptions {
  id?: string;
  src: string;
  async?: boolean;
  type?: string;
  attributes?: Record<string, string>;
  integrity?: string;
  crossOrigin?: 'anonymous' | 'use-credentials';
  appendTo?: 'head' | 'body';
}

export interface StylesheetOptions {
  href: string;
  integrity?: string;
  crossOrigin?: 'anonymous' | 'use-credentials';
}

/**
 * Dynamically loads an external script into the document.
 * Checks if script already exists before loading to prevent duplicates.
 *
 * @param options - Script configuration options
 * @returns Promise that resolves when script is loaded or rejects on error
 */
export function loadScript(options: ScriptOptions): Promise<HTMLScriptElement> {
  const {
    id,
    src,
    async = true,
    type = 'text/javascript',
    attributes = {},
    integrity,
    crossOrigin,
    appendTo = 'body',
  } = options;

  return new Promise((resolve, reject) => {
    // Check if script already exists (by ID or src)
    let existingScript: HTMLScriptElement | null = null;
    if (id) {
      existingScript = document.getElementById(id) as HTMLScriptElement;
    }
    if (!existingScript) {
      existingScript = document.querySelector(
        `script[src="${src}"]`
      ) as HTMLScriptElement;
    }
    if (existingScript) {
      // A concurrent caller may have appended the tag but not yet finished loading it (e.g. the
      // card form and the wallet probe both request Adyen Web at once). Resolving now would let the
      // caller read the not-yet-defined global; wait for the in-flight load instead.
      if (existingScript.dataset.loaded === 'true') {
        resolve(existingScript);
      } else {
        existingScript.addEventListener('load', () => resolve(existingScript));
        existingScript.addEventListener('error', () =>
          reject(new Error(`Failed to load script: ${src}`))
        );
      }
      return;
    }

    const script = document.createElement('script');
    if (id) {
      script.id = id;
    }
    script.type = type;
    script.src = src;

    if (async) {
      script.async = true;
    }

    if (integrity) {
      script.integrity = integrity;
    }

    if (crossOrigin) {
      script.crossOrigin = crossOrigin;
    }

    // Set additional attributes
    Object.entries(attributes).forEach(([key, value]) => {
      script.setAttribute(key, value);
    });

    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve(script);
    };
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));

    const target = appendTo === 'head' ? document.head : document.body;
    target.appendChild(script);
  });
}

/**
 * Dynamically loads an external stylesheet into the document head.
 * Checks if stylesheet already exists before loading to prevent duplicates.
 *
 * @param options - Stylesheet configuration options
 * @returns Promise that resolves when stylesheet is loaded or rejects on error
 */
export function loadStylesheet(
  options: StylesheetOptions
): Promise<HTMLLinkElement> {
  const { href, integrity, crossOrigin } = options;

  return new Promise((resolve, reject) => {
    // Check if stylesheet already exists
    const existingLink = document.querySelector(
      `link[href="${href}"]`
    ) as HTMLLinkElement;
    if (existingLink) {
      // Wait for an in-flight load from a concurrent caller rather than resolving prematurely.
      if (existingLink.dataset.loaded === 'true') {
        resolve(existingLink);
      } else {
        existingLink.addEventListener('load', () => resolve(existingLink));
        existingLink.addEventListener('error', () =>
          reject(new Error(`Failed to load stylesheet: ${href}`))
        );
      }
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;

    if (integrity) {
      link.integrity = integrity;
    }

    if (crossOrigin) {
      link.crossOrigin = crossOrigin;
    }

    link.onload = () => {
      link.dataset.loaded = 'true';
      resolve(link);
    };
    link.onerror = () =>
      reject(new Error(`Failed to load stylesheet: ${href}`));

    document.head.appendChild(link);
  });
}
