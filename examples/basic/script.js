import { Billing } from '../../dist/funnelfox-billing.esm.js';

// Option 1: Configure once (for apps with multiple checkouts)
// Billing.configure({ orgId: 'sndbx_697e4e7150b8e5' });

// Option 2: Pass orgId directly (simpler for single checkout)
const checkout = await Billing.createCheckout({
  orgId: 'sndbx_697e4e7150b8e5',
  priceId: 'price_01JZACPA4QAVM2X52A9W8MHJFT',
  customer: {
    externalId: 'user_1234',
    email: 'user@example.com',
    countryCode: 'US',
  },

  container: '#checkout-container',

  onSuccess: result => {
    const msg = document.getElementById('success-message');
    msg.textContent = `Payment successful! Order: ${result.orderId}`;
    msg.style.display = 'block';
  },

  onError: error => {
    const msg = document.getElementById('error-message');
    msg.textContent = `Payment failed: ${error.message}`;
    msg.style.display = 'block';
  },
});

checkout.updatePrice('price_2');
