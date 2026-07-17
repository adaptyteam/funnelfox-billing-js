import { loadStripe } from '@stripe/stripe-js';
import type { Stripe } from '@stripe/stripe-js';

const cache = new Map<string, Promise<Stripe | null>>();

export function getStripe(publicKey: string): Promise<Stripe | null> {
  if (!cache.has(publicKey)) {
    cache.set(publicKey, loadStripe(publicKey));
  }
  return cache.get(publicKey)!;
}
