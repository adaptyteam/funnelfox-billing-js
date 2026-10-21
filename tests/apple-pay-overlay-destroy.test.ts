import '../src/index';
import PrimerWrapper from '../src/primer-wrapper';
import { PaymentMethod } from '../src/enums';

function headlessWithPrimerButton() {
  return {
    createPaymentMethodManager: jest.fn().mockResolvedValue({
      createButton: () => ({
        render: async (container: HTMLElement) => {
          container.appendChild(document.createElement('button'));
        },
        clean: jest.fn(),
        setDisabled: jest.fn(),
      }),
    }),
  };
}

describe('native Apple Pay overlay', () => {
  beforeAll(() => {
    if (!customElements.get('apple-pay-button')) {
      customElements.define('apple-pay-button', class extends HTMLElement {});
    }
  });

  beforeEach(() => {
    (window as any).Primer = { createHeadless: jest.fn() };
  });

  it('is removed when the checkout is destroyed, not only the Primer button', async () => {
    const wrapper = new PrimerWrapper();
    const internals = wrapper as any;
    internals.applePayOptions = {
      buttonType: 'continue',
      buttonStyle: 'black',
    };
    internals.currentHeadless = Promise.resolve(headlessWithPrimerButton());
    const host = document.createElement('div');
    document.body.appendChild(host);

    await wrapper.renderButton(PaymentMethod.APPLE_PAY, {
      htmlNode: host,
      onMethodRender: () => {},
      onMethodRenderError: () => {},
    });
    expect(host.querySelector('apple-pay-button')).not.toBeNull();

    await wrapper.destroy();

    expect(host.querySelector('apple-pay-button')).toBeNull();
  });
});
