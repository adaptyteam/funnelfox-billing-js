import { getStripe } from './stripe-loader';
import type {
  Stripe,
  PaymentRequest,
  CanMakePaymentResult,
} from '@stripe/stripe-js';
import type APIClient from '../api-client';
import type {
  StripeClientSessionResponse,
  StripeWalletOptions,
} from '../types';

const prewarmed = new WeakMap<
  StripeClientSessionResponse['data'],
  { paymentRequest: PaymentRequest; canMakePayment: CanMakePaymentResult }
>();

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
    // Detected-country tax. The wallet sheet amount is fixed at open (not recomputed from the address
    // picked in the sheet), so this line is the final charged tax, shown plainly as "Tax".
    displayItems:
      tax > 0
        ? [
            { label: 'Subtotal', amount: base },
            { label: 'Tax', amount: tax },
          ]
        : undefined,
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
  prewarmed.set(session.data, { paymentRequest, canMakePayment: result });
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
    | 'onTaxChange'
  > & {
    apiClient: APIClient;
    invalidateSession?: () => void;
  }
): Promise<void> {
  const { stripe_public_key, order_id } = session.data;
  const taxEnabled = session.data.tax_enabled ?? false;

  const stripe = await getStripe(stripe_public_key);
  if (!stripe) throw new Error('Failed to load Stripe');

  const cached = prewarmed.get(session.data);
  prewarmed.delete(session.data);

  let paymentRequest: PaymentRequest;
  if (cached) {
    paymentRequest = cached.paymentRequest;
    const replacement = buildPaymentRequest(stripe, session.data);
    void replacement.canMakePayment().catch(() => {});
    prewarmed.set(session.data, {
      paymentRequest: replacement,
      canMakePayment: cached.canMakePayment,
    });
    const label = params.totalLabel?.trim();
    if (label) {
      const total = session.data.amount_total ?? session.data.amount;
      paymentRequest.update({ total: { label, amount: total } });
    }
  } else {
    paymentRequest = buildPaymentRequest(
      stripe,
      session.data,
      params.totalLabel
    );
    const canPay = await paymentRequest.canMakePayment();
    if (!canPay) throw new Error('No wallet payment method available');
  }

  if (taxEnabled && session.data.amount_total != null) {
    params.onTaxChange?.({
      amountTotal: session.data.amount_total,
      taxAmount: session.data.tax_amount ?? 0,
      currency: session.data.currency,
    });
  }

  return new Promise<void>((resolve, reject) => {
    paymentRequest.on('paymentmethod', async event => {
      let completed = false;
      const completeOnce = (status: 'success' | 'fail') => {
        if (completed) return;
        completed = true;
        try {
          event.complete(status);
        } catch {
          return;
        }
      };
      params.onLoaderChange?.(true);
      try {
        // Tax on: charge stays the detected-country estimate (the amount the sheet authorized, via
        // tax_calculation_id); commit the finalized tax from the card's real billing address, which
        // Stripe only exposes on the payment method after authorization. Tax off: send only the
        // caller-provided country, exactly as before the tax flow existed.
        const billingAddress = taxEnabled
          ? event.paymentMethod.billing_details.address
          : undefined;
        const raw = await params.apiClient.createPayment({
          orderId: order_id,
          paymentMethodToken: event.paymentMethod.id,
          email: params.email,
          countryCode: taxEnabled
            ? billingAddress?.country ||
              session.data.detected_country_code ||
              params.countryCode
            : params.countryCode,
          postalCode: taxEnabled
            ? billingAddress?.postal_code || undefined
            : undefined,
          taxCalculationId: taxEnabled
            ? session.data.tax_calculation_id
            : undefined,
          clientMetadata: params.clientMetadata,
        });
        const result = params.apiClient.processPaymentResponse(raw);

        if (result.type === 'action_required') {
          const { error } = await stripe.handleNextAction({
            clientSecret: result.clientToken,
          });
          if (error) {
            throw error;
          }
        }

        completeOnce('success');
        params.invalidateSession?.();
        params.onPaymentSuccess?.(event.paymentMethod, order_id);
        resolve();
      } catch (err) {
        completeOnce('fail');
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
