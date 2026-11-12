const CURRENCY_CODE = /^[A-Za-z]{3}$/;
const COUNTRY_CODE = /^[A-Za-z]{2}$/;

// Billing checks the code length before trimming it, so " EUR" or "EURO" fails the whole session
// with a 422. An unknown currency is never an error there: left out, the price point's own one is
// charged. A malformed code is dropped here for the same outcome instead of a checkout that never opens.
function normalizeCode(
  value: string | undefined,
  pattern: RegExp,
  option: string
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const code = typeof value === 'string' ? value.trim() : '';
  if (!pattern.test(code)) {
    console.warn(
      `[funnelfox-billing] ${option} "${String(value)}" is not a valid code, so it is not sent`
    );
    return undefined;
  }
  return code.toUpperCase();
}

export function normalizeDisplayCurrency(
  value: string | undefined
): string | undefined {
  return normalizeCode(value, CURRENCY_CODE, 'displayCurrency');
}

export function normalizeDisplayCountry(
  value: string | undefined
): string | undefined {
  return normalizeCode(value, COUNTRY_CODE, 'displayCountry');
}
