import { Billing } from '@funnelfox/billing';

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
    });
    createCheckoutButton.disabled = false;
    createCheckoutButton.textContent = 'Create';
  });
})();
