/**
 * @jest-environment jsdom
 */

import { DefaultSkin } from '../src/skins/default';
import { PaymentMethod } from '../src/enums';

describe('Default skin', () => {
  function createSkin(rootEl: HTMLElement) {
    const skin = new DefaultSkin({
      container: '#test-container',
      priceId: 'price-123',
      customer: {
        externalId: 'customer-123',
        email: 'test@example.com',
      },
      paymentMethodOrder: [PaymentMethod.PAYMENT_CARD, PaymentMethod.APPLE_PAY],
    }) as DefaultSkin & {
      rootEl: HTMLElement;
      containerEl: HTMLElement;
      isDestroyed: boolean;
      isAccordionInitialized: boolean;
      availableMethods: PaymentMethod[];
      cardInstance: { onMethodRender: jest.Mock };
    };

    skin.rootEl = rootEl;
    skin.isDestroyed = false;
    skin.isAccordionInitialized = false;
    skin.availableMethods = [];
    skin.cardInstance = {
      onMethodRender: jest.fn(),
    };

    return skin;
  }

  function appendDefaultSkinRoot(label: string) {
    const root = document.createElement('div');
    root.className = 'ff-skin-default';
    root.dataset.label = label;
    root.innerHTML = `
      <div class="ff-payment-method-card ff-payment-method-payment-card">
        <label>
          <input type="radio" value="PAYMENT_CARD" class="ff-payment-method-radio" />
        </label>
      </div>
      <div class="ff-payment-method-card ff-payment-method-apple-pay">
        <label>
          <input type="radio" value="APPLE_PAY" class="ff-payment-method-radio" />
        </label>
      </div>
    `;
    document.querySelector('#test-container')?.appendChild(root);
    return root;
  }

  test('destroy removes only its own root when another checkout is mounted', () => {
    const firstRoot = appendDefaultSkinRoot('first');
    const secondRoot = appendDefaultSkinRoot('second');
    const firstSkin = createSkin(firstRoot);
    const secondSkin = createSkin(secondRoot);

    expect(document.querySelectorAll('.ff-skin-default')).toHaveLength(2);

    firstSkin.onDestroy?.();

    expect(document.querySelectorAll('.ff-skin-default')).toHaveLength(1);
    expect(
      document.querySelector('.ff-skin-default')?.getAttribute('data-label')
    ).toBe('second');

    expect(() =>
      firstSkin.onMethodsAvailable?.([PaymentMethod.PAYMENT_CARD])
    ).not.toThrow();
    expect(() =>
      secondSkin.onMethodsAvailable?.([PaymentMethod.PAYMENT_CARD])
    ).not.toThrow();
  });
});
