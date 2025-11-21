/**
 * TypeScript definitions for @funnelfox/billing
 * These types are importable by users and used internally via JSDoc
 */

import type {
  HeadlessUniversalCheckoutOptions,
  OnResumeSuccess,
  OnTokenizeSuccess,
} from '@primer-io/checkout-web';

import type { PaymentMethod } from './enums';

export interface SDKConfig {
  orgId: string;
  baseUrl?: string;
  region?: string;
  sandbox?: boolean;
}

export interface APIConfig {
  baseUrl?: string;
  region?: string;
}

export interface Customer {
  email: string;
  externalId: string;
  countryCode?: string;
}

export interface PrimerCheckoutConfig
  extends Pick<
    Partial<HeadlessUniversalCheckoutOptions>,
    'paypal' | 'applePay' | 'googlePay' | 'style'
  > {
  cardSelectors?: CardInputSelectors;
  paymentButtonSelectors?: PaymentButtonSelectors;
}
export interface CheckoutConfig extends PrimerCheckoutConfig {
  customer: Customer;
  priceId: string;
  container: string;
  clientMetadata?: Record<string, any>;
}

export interface PaymentButtonSelectors {
  paypal: string;
  googlePay: string;
  applePay: string;
}

export interface CheckoutOptions
  extends Partial<HeadlessUniversalCheckoutOptions> {
  container: string;
  cardSelectors: CardInputSelectors;
  paymentButtonSelectors: PaymentButtonSelectors;
  onTokenizeSuccess: OnTokenizeSuccess;
  onResumeSuccess: OnResumeSuccess;
  onSubmit: (isSubmitting: boolean) => void;
  onInputChange: (
    inputName: keyof CardInputSelectors,
    error: string | null
  ) => void;
  onMethodRender: (method: PaymentMethod) => void;
}

export interface CheckoutConfigWithCallbacks extends CheckoutConfig {
  onSuccess?: (result: PaymentResult) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (newState: CheckoutState, oldState?: CheckoutState) => void;
  onDestroy?: () => void;
}

export interface CreateCheckoutOptions extends CheckoutConfigWithCallbacks {
  orgId?: string;
  apiConfig?: APIConfig;
}

export interface PaymentResult {
  orderId: string;
  status: 'succeeded' | 'failed' | 'cancelled' | 'processing';
  transactionId?: string;
  failureReason?: string;
  metadata?: Record<string, any>;
}

export type CheckoutState =
  | 'initializing'
  | 'ready'
  | 'processing'
  | 'action_required'
  | 'updating'
  | 'completed'
  | 'error'
  | 'destroyed';

export type CheckoutEventName =
  | 'success'
  | 'error'
  | 'status-change'
  | 'destroy';

export interface CheckoutStatus {
  id: string;
  state: CheckoutState;
  orderId: string | null;
  priceId: string;
  isDestroyed: boolean;
}

export interface CheckoutInstance {
  readonly id: string;
  readonly state: CheckoutState;
  readonly orderId: string | null;
  readonly isDestroyed: boolean;

  updatePrice(newPriceId: string): Promise<void>;
  getStatus(): CheckoutStatus;
  destroy(): Promise<void>;
  getContainer(): Element | null;
  isInState(state: CheckoutState): boolean;
  isReady(): boolean;
  isProcessing(): boolean;

  on(eventName: 'success', handler: (result: PaymentResult) => void): this;
  on(eventName: 'error', handler: (error: Error) => void): this;
  on(
    eventName: 'status-change',
    handler: (newState: CheckoutState, oldState?: CheckoutState) => void
  ): this;
  on(eventName: 'destroy', handler: () => void): this;
  on(eventName: CheckoutEventName, handler: (...args: any[]) => void): this;

  off(eventName: CheckoutEventName, handler?: Function): this;
  once(eventName: CheckoutEventName, handler: Function): this;
}

// API Response types
export interface ClientSessionResponse {
  status: 'success' | 'error';
  data: {
    client_token: string;
    order_id: string;
    action_required_token?: string;
    checkout_status?: 'succeeded' | 'failed' | 'cancelled' | 'processing';
    failed_message_for_user?: string;
  };
}

export interface PaymentMethodTokenData {
  token: string;
  metadata?: Record<string, any>;
}

export interface ResumeTokenData {
  resumeToken: string;
  metadata?: Record<string, any>;
}

export interface PrimerHandler {
  handleSuccess(): void;
  handleFailure(message: string): void;
  continueWithNewClientToken(token: string): void;
}

// Error types
export interface FunnefoxSDKError extends Error {
  code: string;
  details: any;
}

export interface ValidationError extends FunnefoxSDKError {
  field: string;
  value: any;
}

export interface APIError extends FunnefoxSDKError {
  statusCode: number | null;
  errorCode: string | null;
  errorType: string | null;
  requestId: string | null;
  response: any;
}

export interface PrimerError extends FunnefoxSDKError {
  primerError: any;
}

export interface CheckoutError extends FunnefoxSDKError {
  phase: string | null;
}

//eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ConfigurationError extends FunnefoxSDKError {}

export interface NetworkError extends FunnefoxSDKError {
  originalError: any;
}

// Function signatures
export declare function configure(config: SDKConfig): void;

export declare function createCheckout(
  options: CreateCheckoutOptions
): Promise<CheckoutInstance>;

export interface CreateClientSessionOptions {
  priceId: string;
  externalId: string;
  email: string;
  orgId?: string;
  apiConfig?: APIConfig;
  clientMetadata?: Record<string, any>;
  countryCode?: string;
}

export interface ClientSessionData {
  clientToken: string;
  orderId: string;
  type: string;
}

export declare function createClientSession(
  params: CreateClientSessionOptions
): Promise<ClientSessionData>;

// Billing namespace
export declare const Billing: {
  configure: typeof configure;
  createCheckout: typeof createCheckout;
  createClientSession: typeof createClientSession;
};

// Constants
export declare const SDK_VERSION: string;
export declare const CHECKOUT_STATES: Record<string, CheckoutState>;
export declare const EVENTS: Record<string, CheckoutEventName>;
export declare const ERROR_CODES: Record<string, string>;

export interface CardInputSelectors {
  cardNumber: string;
  expiryDate: string;
  cvv: string;
  cardholderName: string;
  button: string;
}
