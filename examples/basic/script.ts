import { Billing, CheckoutInstance, PaymentMethod } from '@funnelfox/billing';

(async function main() {
  let checkout: CheckoutInstance | null = null;
  const externalId = 'user_' + Math.random().toString(36).substring(7, 10);
  const orgId = document.getElementById('orgId') as HTMLInputElement;
  const priceId = document.getElementById('priceId') as HTMLInputElement;
  const createCheckoutButton = document.getElementById(
    'create-checkout'
  ) as HTMLButtonElement;
  const containerParent =
    document.getElementById('checkout-container')?.parentElement;
  if (createCheckoutButton) {
    createCheckoutButton.addEventListener('click', async () => {
      createCheckoutButton.disabled = true;
      createCheckoutButton.textContent = 'Creating...';
      if (checkout) {
        await checkout.destroy();
        const div = document.createElement('div');
        div.id = 'checkout-container';
        containerParent?.appendChild(div);
      }
      checkout = await Billing.createCheckout({
        orgId: orgId.value,
        priceId: priceId.value,
        customer: {
          externalId,
          email: `${externalId}@example.com`,
          countryCode: 'US',
        },
        container: '#checkout-container',
        card: {
          cardholderName: {
            required: true,
          },
        },
      });
      createCheckoutButton.disabled = false;
      createCheckoutButton.textContent = 'Create';
    });
  }

  const createFFIntegrationButton = document.getElementById(
    'create-ff-integration'
  ) as HTMLButtonElement;

  createFFIntegrationButton.addEventListener('click', async () => {
    createFFIntegrationButton.disabled = true;
    createFFIntegrationButton.textContent = 'Creating...';

    // initialize ff integration
    const ffIntegrationCardContainer = document.getElementById(
      'ff-integration-card-container'
    ) as HTMLDivElement;
    const ffIntegrationApplePay = document.getElementById(
      'ff-integration-applepay'
    ) as HTMLDivElement;
    const ffIntegrationGooglePay = document.getElementById(
      'ff-integration-googlepay'
    ) as HTMLDivElement;
    const ffIntegrationPaypal = document.getElementById(
      'ff-integration-paypal'
    ) as HTMLDivElement;

    const options = {
      orgId: orgId.value,
      priceId: priceId.value,
      externalId,
      email: `${externalId}@example.com`,

      onRenderSuccess: () => {
        console.log('FF integration onRenderSuccess rendered');
      },
      onRenderError: () => {
        console.log('FF integration onRenderError rendered');
      },
      onPaymentSuccess: () => {
        console.log('FF integration onPaymentSuccess rendered');
      },
      onPaymentFail: () => {
        console.log('FF integration onPaymentFail rendered');
      },
      onPaymentCancel: () => {
        console.log('FF integration onPaymentCancel rendered');
      },
      onErrorMessageChange: () => {
        console.log('FF integration onErrorMessageChange rendered');
      },
      onLoaderChange: () => {
        console.log('FF integration onLoaderChange rendered');
      },
    };

    const cardHandler = await Billing.initMethod(
      PaymentMethod.PAYMENT_CARD,
      ffIntegrationCardContainer,
      {
        ...options,
        card: {
          cardholderName: {
            required: true,
          },
        },
      }
    );
    const paypalHandler = await Billing.initMethod(
      PaymentMethod.PAYPAL,
      ffIntegrationPaypal,
      {
        ...options,
        paypal: {
          buttonColor: 'gold',
          buttonShape: 'pill',
          buttonLabel: 'pay',
          buttonSize: 'large',
          buttonHeight: 54,
        },
      }
    );
    const cardSubmitButton = document.getElementById(
      'ff-integration-card-submit'
    );
    cardSubmitButton?.addEventListener('click', () => {
      cardHandler?.submit?.();
    });
    createFFIntegrationButton.disabled = false;
    createFFIntegrationButton.textContent = 'Create';
  });
})();
