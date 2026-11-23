/**
 * @jest-environment jsdom
 */

// Primer 2.57.3 formatted IDR/RSD wallet totals with 0 decimals (FFB-996); 2.58.0+ uses 2.
jest.mock('../src/utils/script-loader', () => ({
  loadStylesheet: jest.fn(() => Promise.resolve()),
  loadScript: jest.fn(() => {
    (window as unknown as { Primer: unknown }).Primer = {
      createHeadless: jest.fn(),
    };
    return Promise.resolve();
  }),
}));

type Loader = typeof import('../src/utils/primer-loader');
type ScriptLoader = typeof import('../src/utils/script-loader');

let loadPrimerSDK: Loader['loadPrimerSDK'];
let loadScript: jest.Mock;
let loadStylesheet: jest.Mock;

beforeEach(() => {
  delete (window as unknown as { Primer?: unknown }).Primer;
  jest.resetModules();
  jest.isolateModules(() => {
    ({ loadPrimerSDK } = jest.requireActual<Loader>(
      '../src/utils/primer-loader'
    ));
    const scripts = jest.requireMock<ScriptLoader>(
      '../src/utils/script-loader'
    );
    loadScript = scripts.loadScript as unknown as jest.Mock;
    loadStylesheet = scripts.loadStylesheet as unknown as jest.Mock;
  });
  loadScript.mockClear();
  loadStylesheet.mockClear();
});

test('loads the pinned Primer 2.59.10 with its SRI hash', async () => {
  await loadPrimerSDK();
  expect(loadScript).toHaveBeenCalledWith(
    expect.objectContaining({
      src: 'https://sdk.primer.io/web/v2.59.10/Primer.min.js',
      integrity:
        'sha384-ljZeT03W/Ja1PxE4t71YTBNazrfN4CpSb0LJUdPA/E28Xclgz/WsuM2O6TKwVJxz',
      crossOrigin: 'anonymous',
    })
  );
  expect(loadStylesheet).toHaveBeenCalledWith(
    expect.objectContaining({
      href: 'https://sdk.primer.io/web/v2.59.10/Checkout.css',
    })
  );
});

test('an explicit version is loaded as given, without an integrity hash', async () => {
  await loadPrimerSDK('2.60.0');
  expect(loadScript).toHaveBeenCalledWith(
    expect.objectContaining({
      src: 'https://sdk.primer.io/web/v2.60.0/Primer.min.js',
      integrity: undefined,
    })
  );
});

test('README and the basic example reference the same Primer version the loader pins', () => {
  // A page that loads Primer itself skips the loader, so a stale tag in the docs keeps the old SDK.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('path') as typeof import('path');
  const root = join(__dirname, '..');
  for (const file of ['README.md', 'examples/basic/index.html']) {
    const text = readFileSync(join(root, file), 'utf8');
    const versions = [
      ...text.matchAll(/sdk\.primer\.io\/web\/v([\d.]+)\//g),
    ].map(m => m[1]);
    expect({ file, versions: [...new Set(versions)] }).toEqual({
      file,
      versions: ['2.59.10'],
    });
  }
});
