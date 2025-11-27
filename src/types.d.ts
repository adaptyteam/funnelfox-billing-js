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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MetadataType = Record<string, any>;
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
  clientMetadata?: MetadataType;
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
  onSubmitError: (error: Error) => void;
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
  metadata?: MetadataType;
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
  on(eventName: CheckoutEventName, handler: (...args: unknown[]) => void): this;

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
  metadata?: MetadataType;
}

export interface ResumeTokenData {
  resumeToken: string;
  metadata?: MetadataType;
}

export interface PrimerHandler {
  handleSuccess(): void;
  handleFailure(message: string): void;
  continueWithNewClientToken(token: string): void;
}

// Error types
export interface FunnefoxSDKError extends Error {
  code: string;
  details: unknown;
}

export interface ValidationError extends FunnefoxSDKError {
  field: string;
  value: unknown;
}

export interface APIError extends FunnefoxSDKError {
  statusCode: number | null;
  errorCode: string | null;
  errorType: string | null;
  requestId: string | null;
  response: unknown;
}

export interface PrimerError extends FunnefoxSDKError {
  primerError: unknown;
}

export interface CheckoutError extends FunnefoxSDKError {
  phase: string | null;
}

//eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ConfigurationError extends FunnefoxSDKError {}

export interface NetworkError extends FunnefoxSDKError {
  originalError: unknown;
}

// Function signatures
export declare function configure(config: SDKConfig): void;

export declare function createCheckout(
  options: CreateCheckoutOptions
): Promise<CheckoutInstance>;

export interface CreateClientSessionOptions {
  region?: string;
  priceId: string;
  externalId: string;
  email: string;
  orgId?: string;
  apiConfig?: APIConfig;
  clientMetadata?: MetadataType;
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

export interface CreateClientSessionRequest {
  region: string;
  integration_type: string;
  pp_ident: string;
  external_id: string;
  email_address: string;
  country_code?: string;
  client_metadata?: MetadataType;
}

export interface CreateClientSessionResponse {
  status: 'success' | 'error';
  data: {
    client_token: string;
    order_id: string;
  };
  error?: {
    code: string;
    msg: string;
    type: string;
  }[];
  req_id: string;
}

export interface CreatePaymentRequest {
  order_id: string;
  payment_method_token: string;
}

export interface CreatePaymentResponse {
  status: 'success' | 'error';
  data: {
    action_required_token: string;
    checkout_status: 'processing' | 'succeeded' | 'failed' | 'cancelled';
    failed_message_for_user: string;
    order_id: string;
  };
  error?: {
    code: string;
    msg: string;
    type: string;
  }[];
}

export interface PaymentProcessResult {
  type: string;
  orderId: string;
  clientToken?: string;
  status?: string;
}

export interface PaymentMethodInterface {
  setDisabled: (disabled: boolean) => void;
}

export interface PrimerWrapperInterface {
  isInitialized: boolean;
  isPrimerAvailable(): boolean;
  ensurePrimerAvailable(): void;
  renderCardCheckout({
    cardSelectors,
    onSubmit,
    onInputChange,
  }: {
    cardSelectors: CardInputSelectors;
    onSubmit: (isSubmitting: boolean) => void;
    onInputChange: (
      inputName: keyof CardInputSelectors,
      error: string | null
    ) => void;
  }): Promise<PaymentMethodInterface>;
  renderButton(
    allowedPaymentMethod: 'GOOGLE_PAY' | 'APPLE_PAY' | 'PAYPAL',
    options: {
      container: string;
    }
  ): Promise<void>;
  renderCheckout(clientToken: string, options: CheckoutOptions): Promise<void>;
  destroy(): Promise<void>;
  createHandlers(handlers: {
    onSuccess?: () => void;
    onError?: (e: Error) => void;
    onActionRequired?: (token: string) => void;
  }): PrimerHandler;
  getCurrentCheckout(): (() => void)[];
  isActive(): boolean;
  validateContainer(selector: string): Element;
  disableButtons(disabled: boolean): void;
}
