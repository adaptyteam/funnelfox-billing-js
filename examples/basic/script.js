import { Billing } from '@funnelfox/billing';

(async function main() {
  let checkout = null;
  const externalId = 'user_' + Math.random().toString(36).substring(7, 10);
  const orgId = document.getElementById('orgId');
  const priceId = document.getElementById('priceId');
  const createCheckoutButton = document.getElementById('create-checkout');
  fetch(`https://billing.funnelfox.com/${orgId.value}/v1/price_points`, {
    method: 'POST',
  })
    .then(response => response.json())
    .then(data => {
      console.log(data);
    });
  createCheckoutButton.addEventListener('click', async () => {
    createCheckoutButton.disabled = true;
    createCheckoutButton.textContent = 'Creating...';
    if (checkout) {
      await checkout.destroy();
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
