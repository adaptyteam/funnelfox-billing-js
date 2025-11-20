import { Billing } from '@funnelfox/billing';

(async function main() {
  const externalId = 'user_' + Math.random().toString(36).substring(7, 10);
  await Billing.createCheckout({
    orgId: 'sndbx_697e4e7150b8e5',
    priceId: 'price_01JZACPA4QAVM2X52A9W8MHJFT',
    customer: {
      externalId,
      email: `${externalId}@example.com`,
      countryCode: 'US',
    },

    container: '#checkout-container',
  });
})();
