/**
 * @fileoverview Normalization of payment failure errors
 */

import { APIError } from '../errors';
import type { PaymentFailure } from '../types';

const STRIPE_CARD_ERROR = 'card_error';

function declineCodeFromStripeError(error: object): string | null {
  const { type, code } = error as { type?: unknown; code?: unknown };
  if (type !== STRIPE_CARD_ERROR || typeof code !== 'string' || !code) {
    return null;
  }
  return code.toUpperCase();
}

export function toPaymentFailure(error: unknown): PaymentFailure {
  const failure: PaymentFailure = new Error(
    (error as Error)?.message || 'Payment processing failed'
  );
  if (error instanceof APIError) {
    if (error.declineCode) {
      failure.declineCode = error.declineCode;
    }
    if (error.declineCodeSource) {
      failure.declineCodeSource = error.declineCodeSource;
    }
  } else if (error instanceof Error) {
    const declineCode = declineCodeFromStripeError(error);
    if (declineCode) {
      failure.declineCode = declineCode;
      failure.declineCodeSource = 'stripe';
    }
  }
  return failure;
}
