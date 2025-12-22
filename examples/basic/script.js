import { Billing, PaymentMethod } from '@funnelfox/billing';

(async function main() {
  let checkout = null;
  const externalId = 'user_' + Math.random().toString(36).substring(7, 10);
  const orgId = document.getElementById('orgId');
  const priceId = document.getElementById('priceId');
  const createCheckoutButton = document.getElementById('create-checkout');
  const containerParent =
    document.getElementById('checkout-container')?.parentElement;

  createCheckoutButton.addEventListener('click', async () => {
    createCheckoutButton.disabled = true;
    createCheckoutButton.textContent = 'Creating...';
    if (checkout) {
      await checkout.destroy();
      const div = document.createElement('div');
      div.id = 'checkout-container';
      containerParent.appendChild(div);
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
      paymentMethodOrder: [
        PaymentMethod.PAYMENT_CARD,
        PaymentMethod.PAYPAL,
        PaymentMethod.GOOGLE_PAY,
        PaymentMethod.APPLE_PAY,
      ],
    });
    createCheckoutButton.disabled = false;
    createCheckoutButton.textContent = 'Create';
  });

  const createFFIntegrationButton = document.getElementById(
    'create-ff-integration'
  );

  createFFIntegrationButton.addEventListener('click', async () => {
    createFFIntegrationButton.disabled = true;
    createFFIntegrationButton.textContent = 'Creating...';

    // initialize ff integration
    const ffIntegrationCardContainer = document.getElementById(
      'ff-integration-card-container'
    );
    const ffIntegrationApplePay = document.getElementById(
      'ff-integration-applepay'
    );
    const ffIntegrationGooglePay = document.getElementById(
      'ff-integration-googlepay'
    );
    const ffIntegrationPaypal = document.getElementById(
      'ff-integration-paypal'
    );

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
      onRenderError: err => {
        console.log('FF integration onRenderError rendered', err);
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
    }; /* 
    const cardHandler = await Billing.initMethod(
      PaymentMethod.PAYMENT_CARD,
      ffIntegrationCardContainer,
      options
    ); */
    const paypalHandler = await Billing.initMethod(
      PaymentMethod.PAYPAL,
      ffIntegrationPaypal,
      {
        paypal: {
          buttonColor: 'gold',
          buttonShape: 'pill',
          buttonLabel: 'pay',
          buttonSize: 'large',
          buttonHeight: 54,
        },
        ...options,
      }
    );
    const cardSubmitButton = document.getElementById(
      'ff-integration-card-submit'
    );
    cardSubmitButton.addEventListener('click', () => {
      cardHandler.submit();
    });
    createFFIntegrationButton.disabled = false;
    createFFIntegrationButton.textContent = 'Create';
  });
})();
