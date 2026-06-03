import { getStripe } from './stripe-loader';
import type { Stripe } from '@stripe/stripe-js';
import type APIClient from '../api-client';
import type {
  StripeClientSessionResponse,
  StripeWalletOptions,
} from '../types';

function buildPaymentRequest(
  stripe: Stripe,
  data: Pick<
    StripeClientSessionResponse['data'],
    'amount' | 'currency' | 'country' | 'apple_pay_recurring_payment_request'
  >,
  totalLabel?: string
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

  return stripe.paymentRequest({
    country: data.country,
    currency: data.currency,
    total: {
      label: totalLabel?.trim() || 'Total',
      amount: data.amount,
    },
    requestPayerName: false,
    requestPayerEmail: false,
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

  const stripe = await getStripe(stripe_public_key);
  if (!stripe) throw new Error('Failed to load Stripe');

  const paymentRequest = buildPaymentRequest(
    stripe,
    session.data,
    params.totalLabel
  );

  const canPay = await paymentRequest.canMakePayment();
  if (!canPay) throw new Error('No wallet payment method available');

  return new Promise<void>((resolve, reject) => {
    paymentRequest.on('paymentmethod', async event => {
      params.onLoaderChange?.(true);
      try {
        const raw = await params.apiClient.createPayment({
          orderId: order_id,
          paymentMethodToken: event.paymentMethod.id,
          email: params.email,
          countryCode: params.countryCode,
          clientMetadata: params.clientMetadata,
        });
        const result = params.apiClient.processPaymentResponse(raw);

        if (result.type === 'action_required') {
          const { error } = await stripe.confirmPayment({
            clientSecret: result.clientToken,
            redirect: 'if_required',
            confirmParams: { return_url: window.location.href },
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
