/**
 * @fileoverview Apple Pay buttonType pass-through tests
 *
 * Primer's TypeScript union for applePay.buttonType lags behind their
 * documented runtime support (https://primer.io/docs/sdk/primer-checkout-web/apple-pay#button-type),
 * so the SDK widens the type with ApplePayButtonType. These tests verify the
 * widened values compile and are handed to Primer.createHeadless unchanged.
 */

// Load the SDK entrypoint first: errors.ts <-> index.ts have a circular
// dependency, and entering the graph via headless-manager directly leaves
// HeadlessManager undefined mid-initialization.
import '../src/index';
import { HeadlessManager } from '../src/utils/headless-manager';
import type { ApplePayButtonType, BillingApplePayOptions } from '../src/types';

describe('Apple Pay buttonType pass-through', () => {
  beforeEach(() => {
    (window as any).Primer = {
      createHeadless: jest.fn().mockResolvedValue({
        start: jest.fn().mockResolvedValue(undefined),
      }),
    };
  });

  it("passes buttonType 'continue' to Primer.createHeadless unchanged", async () => {
    const manager = new HeadlessManager();
    const applePay: BillingApplePayOptions = {
      buttonStyle: 'black',
      buttonType: 'continue',
    };

    await manager.getOrCreate('test-client-token', {
      applePay,
      onAvailablePaymentMethodsLoad: () => {},
    });

    expect((window as any).Primer.createHeadless).toHaveBeenCalledWith(
      'test-client-token',
      expect.objectContaining({
        applePay: expect.objectContaining({ buttonType: 'continue' }),
      })
    );
  });

  it('still accepts the original Primer buttonType values', async () => {
    const manager = new HeadlessManager();
    const primerValues: ApplePayButtonType[] = [
      'plain',
      'buy',
      'set-up',
      'donate',
      'check-out',
      'book',
      'subscribe',
      'continue',
    ];

    for (const buttonType of primerValues) {
      const applePay: BillingApplePayOptions = { buttonType };
      await manager.getOrCreate(`token-${buttonType}`, {
        applePay,
        onAvailablePaymentMethodsLoad: () => {},
      });
    }

    expect((window as any).Primer.createHeadless).toHaveBeenCalledTimes(
      primerValues.length
    );
  });
});

describe('native-only Apple Pay button types', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    isNativeOnlyApplePayButtonType,
    CSS_RENDERABLE_APPLE_PAY_TYPES,
  } = require('../src/utils/apple-pay-native-button');

  it('treats the 7 legacy values as CSS-renderable', () => {
    for (const t of CSS_RENDERABLE_APPLE_PAY_TYPES) {
      expect(isNativeOnlyApplePayButtonType(t)).toBe(false);
    }
  });

  it('routes newer values to the native element overlay', () => {
    for (const t of ['continue', 'order', 'pay', 'tip', 'add-money']) {
      expect(isNativeOnlyApplePayButtonType(t)).toBe(true);
    }
  });

  it('does nothing when buttonType is not set', () => {
    expect(isNativeOnlyApplePayButtonType(undefined)).toBe(false);
    expect(isNativeOnlyApplePayButtonType('')).toBe(false);
  });
});
