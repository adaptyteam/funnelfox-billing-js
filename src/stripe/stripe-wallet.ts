import { getStripe } from './stripe-loader';
import type { Stripe, PaymentRequestShippingOption } from '@stripe/stripe-js';
import type APIClient from '../api-client';
import type {
  StripeClientSessionResponse,
  StripeWalletOptions,
} from '../types';

// Why a shipping address for tax: a wallet sheet (Apple/Google Pay) fixes its amount when it opens and
// exposes NO billing-address change event, so tax can't be recomputed from the billing address. The
// only address event that fires *before* authorization is `shippingaddresschange` — and it requires
// requesting a shipping address. So to charge the finalized (address-accurate) tax we request shipping,
// recompute tax on that event, and update the sheet total. There is no physical shipping; the single
// $0 option below makes that explicit (the OS-level "Shipping Address" label itself is not renamable
// via the Payment Request API).
const TAX_SHIPPING_OPTION: PaymentRequestShippingOption = {
  id: 'tax-only',
  label: 'No shipping',
  detail: 'Digital purchase — address is used only to calculate tax',
  amount: 0,
};

function buildPaymentRequest(
  stripe: Stripe,
  data: Pick<
    StripeClientSessionResponse['data'],
    | 'amount'
    | 'currency'
    | 'country'
    | 'apple_pay_recurring_payment_request'
    | 'amount_total'
    | 'tax_amount'
  >,
  totalLabel?: string,
  requestShipping = false
) {
  const raw = data.apple_pay_recurring_payment_request;
  if (raw) {
    const parseDates = (b: typeof raw.regularBilling) => {
      if (b.recurringPaymentStartDate)
        Object.assign(b, {
          recurringPaymentStartDate: new Date(b.recurringPaymentStartDate),
        });
      if (b.recurringPaymentEndDate)
        Object.assign(b, {
          recurringPaymentEndDate: new Date(b.recurringPaymentEndDate),
        });
    };
    parseDates(raw.regularBilling);
    if (raw.trialBilling) parseDates(raw.trialBilling);
  }
  const applePay = raw
    ? ({ recurringPaymentRequest: raw } as Parameters<
        Stripe['paymentRequest']
      >[0]['applePay'])
    : undefined;

  const base = data.amount;
  const tax = data.tax_amount ?? 0;
  const total = data.amount_total ?? base;
  return stripe.paymentRequest({
    country: data.country,
    currency: data.currency,
    total: {
      label: totalLabel?.trim() || 'Total',
      amount: total,
    },
    displayItems:
      tax > 0
        ? [
            { label: 'Subtotal', amount: base },
            { label: 'Tax', amount: tax },
          ]
        : undefined,
    requestPayerName: false,
    requestPayerEmail: false,
    requestShipping,
    shippingOptions: requestShipping ? [TAX_SHIPPING_OPTION] : undefined,
    applePay,
  });
}

export async function getAvailableWallet(
  session: StripeClientSessionResponse
): Promise<'APPLE_PAY' | 'GOOGLE_PAY' | null> {
  const { stripe_public_key } = session.data;

  const stripe = await getStripe(stripe_public_key);
  if (!stripe) throw new Error('Failed to load Stripe');

  const paymentRequest = buildPaymentRequest(stripe, session.data);
  const result = await paymentRequest.canMakePayment();
  if (!result) return null;
  if (result.applePay) return 'APPLE_PAY';
  if (result.googlePay) return 'GOOGLE_PAY';
  return null;
}

export async function purchaseWallet(
  session: StripeClientSessionResponse,
  params: Pick<
    StripeWalletOptions,
    | 'totalLabel'
    | 'onPaymentSuccess'
    | 'onPaymentFail'
    | 'onPaymentCancel'
    | 'onLoaderChange'
    | 'email'
    | 'countryCode'
    | 'clientMetadata'
  > & {
    apiClient: APIClient;
  }
): Promise<void> {
  const { stripe_public_key, order_id } = session.data;
  const taxEnabled = session.data.tax_enabled ?? false;
  const totalLabelResolved = params.totalLabel?.trim() || 'Total';

  const stripe = await getStripe(stripe_public_key);
  if (!stripe) throw new Error('Failed to load Stripe');

  const paymentRequest = buildPaymentRequest(
    stripe,
    session.data,
    params.totalLabel,
    taxEnabled
  );

  const canPay = await paymentRequest.canMakePayment();
  if (!canPay) throw new Error('No wallet payment method available');

  // Tax to charge: starts as the detected-country estimate, then becomes the address-accurate
  // calculation from `shippingaddresschange` once the buyer's wallet address is known.
  let taxCalculationId = session.data.tax_calculation_id;
  let taxCountryCode = session.data.detected_country_code || params.countryCode;
  let taxPostalCode: string | undefined;
  let taxSubdivision: string | undefined;

  if (taxEnabled) {
    paymentRequest.on('shippingaddresschange', async event => {
      try {
        const addr = event.shippingAddress;
        const tax = await params.apiClient.recalculateTax({
          orderId: order_id,
          clientToken: session.data.client_token,
          countryCode: addr.country as string,
          postalCode: addr.postalCode || undefined,
          subdivision: addr.region || undefined,
        });
        taxCalculationId = tax.tax_calculation_id;
        taxCountryCode = addr.country || taxCountryCode;
        taxPostalCode = addr.postalCode || undefined;
        taxSubdivision = addr.region || undefined;
        // Always pass concrete display items: passing `undefined` makes the wallet keep the previous
        // (stale) tax line, so when tax drops to 0 the old estimate would linger.
        event.updateWith({
          status: 'success',
          total: { label: totalLabelResolved, amount: tax.amount_total },
          displayItems: [
            { label: 'Subtotal', amount: tax.amount_total - tax.tax_amount },
            ...(tax.tax_amount > 0
              ? [{ label: 'Tax', amount: tax.tax_amount }]
              : []),
          ],
          shippingOptions: [TAX_SHIPPING_OPTION],
        });
      } catch {
        // Keep the current total if recalculation fails, but don't block the address.
        event.updateWith({
          status: 'success',
          shippingOptions: [TAX_SHIPPING_OPTION],
        });
      }
    });
  }

  return new Promise<void>((resolve, reject) => {
    paymentRequest.on('paymentmethod', async event => {
      params.onLoaderChange?.(true);
      try {
        const raw = await params.apiClient.createPayment({
          orderId: order_id,
          paymentMethodToken: event.paymentMethod.id,
          email: params.email,
          countryCode: taxCountryCode,
          postalCode: taxEnabled ? taxPostalCode : undefined,
          subdivision: taxEnabled ? taxSubdivision : undefined,
          taxCalculationId,
          clientMetadata: params.clientMetadata,
        });
        const result = params.apiClient.processPaymentResponse(raw);

        if (result.type === 'action_required') {
          const { error } = await stripe.handleNextAction({
            clientSecret: result.clientToken,
          });
          if (error) {
            event.complete('fail');
            throw error;
          }
        }

        event.complete('success');
        params.onPaymentSuccess?.(event.paymentMethod, order_id);
        resolve();
      } catch (err) {
        event.complete('fail');
        params.onPaymentFail?.(err as Error);
        reject(err);
      } finally {
        params.onLoaderChange?.(false);
      }
    });

    paymentRequest.on('cancel', () => {
      params.onPaymentCancel?.();
      resolve();
    });

    paymentRequest.show();
  });
}
