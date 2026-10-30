/**
 * @fileoverview Primer Checkout (@primer-io/primer-js) behind the same interface as the checkout-web v2 wrapper.
 *
 * The session is created in manual approval mode: Primer tokenizes, asks us to approve the payment attempt,
 * then creates the payment and runs 3DS itself.
 */

import { ALLOWED_PAYMENT_METHODS } from './constants';
import { PaymentMethod } from './enums';
import { PrimerError } from './errors';
import { generateId } from './utils/helpers';
import { loadPrimerCheckout } from './utils/primer-checkout-loader';
import {
  ensureTokens,
  renderPrimerCardForm,
} from './primer-checkout-card-form';
import type {
  CheckoutOptions,
  CheckoutRenderOptions,
  PaymentMethodInterface,
} from './types';

export interface PrimerCheckoutHooks {
  /** Runs before Primer opens the payment attempt: the last moment the session amount may change. */
  beforePayment(method: PaymentMethod): Promise<void>;
  approve(paymentAttemptId: string): Promise<void>;
  onSuccess(): void;
  /** `approvalError` is our backend's refusal, if the attempt failed because of it. */
  onFailure(approvalError: unknown): Promise<void> | void;
  onCancel(): void;
}

interface PrimerCheckoutApi {
  refreshSession(): Promise<void>;
  setCardholderName(cardholderName: string): void;
}

interface PaymentStartDetail {
  paymentMethodType: string;
  abortPaymentCreation(): void;
  continuePaymentCreation(data?: { idempotencyKey?: string }): void;
}

interface ApprovalDetail {
  paymentAttemptId: string;
  continueFlow(): Promise<void>;
}

// Primer reports readiness within seconds; a checkout that never gets there is a failed initialization.
const READY_TIMEOUT_MS = 30000;

/**
 * One `<primer-checkout>` per client session: Primer supports a single checkout per page, while the funnel renders
 * every payment method from its own `initMethod` call. Methods render through `<primer-provider>` wherever the
 * page puts them, and the checkout element itself shows nothing. Primer dispatches its lifecycle events on the
 * checkout element, so each shared checkout hears only its own session.
 */
class SharedCheckout {
  readonly id = generateId('ff-primer-checkout-');
  readonly element: HTMLElement;
  readonly ready: Promise<PaymentMethod[]>;
  users = 0;
  private api?: PrimerCheckoutApi;
  private readonly hooksByMethod = new Map<
    PaymentMethod,
    PrimerCheckoutHooks
  >();
  private readonly gatesByMethod = new Map<PaymentMethod, () => boolean>();
  private activeHooks?: PrimerCheckoutHooks;
  private approvalError: unknown;

  constructor(clientToken: string, options: CheckoutOptions) {
    ensureTokens();
    this.element = document.createElement('primer-checkout');
    this.element.id = this.id;
    this.element.setAttribute('loader-disabled', '');
    this.element.innerHTML = '<div slot="main"></div>';
    (this.element as HTMLElement & { options: unknown }).options =
      toPrimerOptions(options);

    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new PrimerError('Primer Checkout did not become ready')),
        READY_TIMEOUT_MS
      );
      this.listen('primer:ready', event => {
        this.api = (event as CustomEvent<PrimerCheckoutApi>).detail;
      });
      this.listen('primer:methods-update', event => {
        clearTimeout(timer);
        const types = (
          (event as CustomEvent<{ type: string }[]>).detail || []
        ).map(method => method.type);
        resolve(toAllowedMethods(types));
      });
      this.listen('primer:state-change', event => {
        const error = (event as CustomEvent<{ primerJsError?: unknown }>).detail
          ?.primerJsError;
        if (error) {
          clearTimeout(timer);
          reject(
            new PrimerError('Failed to initialize Primer Checkout', error)
          );
        }
      });
    });
    this.listen('primer:payment-start', event => this.onPaymentStart(event));
    this.listen('primer:payment-approval-required', event => {
      void this.onApprovalRequired(event as CustomEvent<ApprovalDetail>);
    });
    this.listen('primer:payment-success', event => {
      this.settle(event)?.onSuccess();
    });
    this.listen('primer:payment-failure', event => {
      const approvalError = this.approvalError;
      void this.settle(event)?.onFailure(approvalError);
    });
    this.listen('primer:payment-cancel', event => {
      this.settle(event)?.onCancel();
    });

    document.body.appendChild(this.element);
    this.element.setAttribute('client-token', clientToken);
  }

  /** `canStart` stops a payment Primer would start: its own inputs are valid, while the skin's fields are not. */
  register(
    method: PaymentMethod,
    hooks: PrimerCheckoutHooks,
    canStart?: () => boolean
  ) {
    this.hooksByMethod.set(method, hooks);
    if (canStart) {
      this.gatesByMethod.set(method, canStart);
    } else {
      this.gatesByMethod.delete(method);
    }
  }

  /** Only the instance that registered the method may remove it: a re-rendered method registers before the old one is destroyed. */
  unregister(method: PaymentMethod, hooks: PrimerCheckoutHooks) {
    if (this.hooksByMethod.get(method) === hooks) {
      this.hooksByMethod.delete(method);
      this.gatesByMethod.delete(method);
    }
    if (this.activeHooks === hooks) {
      this.activeHooks = undefined;
      this.approvalError = undefined;
    }
  }

  refreshSession() {
    return this.api?.refreshSession();
  }

  setCardholderName(cardholderName: string) {
    this.api?.setCardholderName(cardholderName);
  }

  remove() {
    this.element.remove();
  }

  private listen(type: string, listener: EventListener) {
    this.element.addEventListener(type, listener);
  }

  /** The hooks a payment outcome belongs to; the payment is over, so nothing stays active. */
  private settle(event: Event) {
    const type = (event as CustomEvent<{ paymentMethodType?: string | null }>)
      .detail?.paymentMethodType;
    const hooks =
      (type && this.hooksByMethod.get(type as PaymentMethod)) ||
      this.activeHooks;
    this.activeHooks = undefined;
    this.approvalError = undefined;
    return hooks;
  }

  private onPaymentStart(event: Event) {
    const detail = (event as CustomEvent<PaymentStartDetail>).detail;
    event.preventDefault();
    const hooks = this.hooksByMethod.get(
      detail.paymentMethodType as PaymentMethod
    );
    if (!hooks) {
      // Nobody could approve this payment, so it must not reach the approval step.
      detail.abortPaymentCreation();
      return;
    }
    if (
      this.gatesByMethod.get(detail.paymentMethodType as PaymentMethod)?.() ===
      false
    ) {
      detail.abortPaymentCreation();
      return;
    }
    this.activeHooks = hooks;
    this.approvalError = undefined;
    hooks.beforePayment(detail.paymentMethodType as PaymentMethod).then(
      () => detail.continuePaymentCreation(),
      error => {
        detail.abortPaymentCreation();
        this.activeHooks = undefined;
        void hooks.onFailure(error);
      }
    );
  }

  private async onApprovalRequired(event: CustomEvent<ApprovalDetail>) {
    const { paymentAttemptId, continueFlow } = event.detail;
    try {
      if (!this.activeHooks) {
        throw new PrimerError('No payment method is waiting for this approval');
      }
      await this.activeHooks.approve(paymentAttemptId);
    } catch (error) {
      this.approvalError = error;
    }
    try {
      // Primer keeps the checkout locked until this is called, whatever our backend decided.
      await continueFlow();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Primer Checkout continueFlow failed', error);
    }
  }
}

const checkouts = new Map<string, SharedCheckout>();

function acquireCheckout(clientToken: string, options: CheckoutOptions) {
  let checkout = checkouts.get(clientToken);
  if (!checkout) {
    checkout = new SharedCheckout(clientToken, options);
    checkouts.set(clientToken, checkout);
  }
  checkout.users += 1;
  return checkout;
}

function releaseCheckout(clientToken: string) {
  const checkout = checkouts.get(clientToken);
  if (!checkout) {
    return;
  }
  checkout.users -= 1;
  if (checkout.users <= 0) {
    checkout.remove();
    checkouts.delete(clientToken);
  }
}

/** Safari and iOS. checkout-web v2 offered Apple Pay only there; Primer Checkout also offers it elsewhere via a QR code. */
function hasNativeApplePay() {
  const session = (
    window as unknown as { ApplePaySession?: { canMakePayments(): boolean } }
  ).ApplePaySession;
  try {
    return Boolean(session?.canMakePayments());
  } catch {
    return false;
  }
}

function toAllowedMethods(types: string[]): PaymentMethod[] {
  // Apple Pay outside Safari would also hide Google Pay (below) for every Chrome shopper; it stays off, as in v2.
  const methods = ALLOWED_PAYMENT_METHODS.filter(
    method =>
      types.includes(method) &&
      (method !== PaymentMethod.APPLE_PAY || hasNativeApplePay())
  );
  // Same rule as the legacy wrapper: where Apple Pay is available, Google Pay is not offered.
  if (methods.includes(PaymentMethod.APPLE_PAY)) {
    return methods.filter(method => method !== PaymentMethod.GOOGLE_PAY);
  }
  return methods;
}

// The legacy wrapper forced these on the rendered buttons with CSS (FFB-169, FFB-242); Primer Checkout draws
// its buttons in shadow DOM, so they go through its options and the wallet tokens in primer-checkout-card-form.
const WALLET_BUTTON_HEIGHT = 54;
const WALLET_BUTTON_RADIUS = 28;

function collectsApplePayEmail(options: CheckoutOptions) {
  const contactFields: string[] = [
    ...(options.applePay?.billingOptions?.requiredBillingContactFields || []),
    ...(options.applePay?.shippingOptions?.requiredShippingContactFields || []),
  ];
  return contactFields.includes('emailAddress');
}

function toPrimerOptions(options: CheckoutOptions) {
  return {
    submitButton: { useBuiltInButton: false },
    // Our skin renders its own cardholder input and validates it; Primer only receives the value.
    card: { cardholderName: { visible: false, required: false } },
    applePay: {
      buttonOptions: {
        type: options.applePay?.buttonType,
        buttonStyle: options.applePay?.buttonStyle,
      },
      // Primer Checkout collects the email as a shipping contact field only.
      ...(collectsApplePayEmail(options)
        ? { shippingOptions: { requiredShippingContactFields: ['email'] } }
        : {}),
    },
    googlePay: {
      buttonType: options.googlePay?.buttonType,
      buttonColor: options.googlePay?.buttonColor,
      buttonSizeMode: options.googlePay?.buttonSizeMode,
      buttonRadius: WALLET_BUTTON_RADIUS,
    },
    paypal: {
      style: {
        color: options.paypal?.buttonColor,
        shape: options.paypal?.buttonShape,
        label: options.paypal?.buttonLabel,
        height: options.paypal?.buttonHeight ?? WALLET_BUTTON_HEIGHT,
        borderRadius: WALLET_BUTTON_RADIUS,
      },
      paymentFlow: options.paypal?.paymentFlow,
      // The card is paid through our own card form; Primer would add PayPal's card button under the PayPal one.
      disableFunding: ['card'],
    },
  };
}

class PrimerCheckoutWrapper {
  isInitialized = false;
  private clientToken: string | null = null;
  private checkout: SharedCheckout | null = null;
  private availableMethods: PaymentMethod[] = [];
  private methodInterfaces: PaymentMethodInterface[] = [];

  constructor(private readonly hooks: PrimerCheckoutHooks) {}

  async initializeHeadlessCheckout(
    clientToken: string,
    options: CheckoutOptions
  ) {
    try {
      await loadPrimerCheckout();
    } catch (error) {
      throw new PrimerError('Failed to load Primer Checkout', error);
    }
    if (!this.checkout) {
      this.clientToken = clientToken;
      this.checkout = acquireCheckout(clientToken, options);
    }
    try {
      this.availableMethods = await this.checkout.ready;
      if (this.availableMethods.length === 0) {
        throw new PrimerError('No allowed payment methods found');
      }
    } catch (error) {
      // A broken checkout must not be handed to the next attempt with the same session.
      releaseCheckout(clientToken);
      this.checkout = null;
      this.clientToken = null;
      throw error;
    }
    options.onAvailablePaymentMethodsLoad?.(this.availableMethods);
  }

  async initMethod(
    method: PaymentMethod,
    htmlNode: HTMLElement,
    options: CheckoutRenderOptions
  ): Promise<PaymentMethodInterface> {
    const checkout = this.checkout;
    if (!checkout) {
      throw new PrimerError('Primer Checkout not initialized');
    }
    if (!this.availableMethods.includes(method)) {
      options.onMethodRenderError?.(method);
      throw new PrimerError(
        `Payment method ${method} is not available in this checkout`
      );
    }
    checkout.register(method, this.hooks);

    const provider = document.createElement('primer-provider');
    provider.setAttribute('checkout-id', checkout.id);
    let methodInterface: PaymentMethodInterface;
    const removeMethod = () => {
      checkout.unregister(method, this.hooks);
      provider.remove();
      this.methodInterfaces = this.methodInterfaces.filter(
        item => item !== methodInterface
      );
    };

    if (method === PaymentMethod.PAYMENT_CARD && options.cardElements) {
      const cardForm = renderPrimerCardForm(
        provider,
        htmlNode,
        options.cardElements,
        options,
        cardholderName => checkout.setCardholderName(cardholderName)
      );
      checkout.register(method, this.hooks, cardForm.ownFieldsValid);
      methodInterface = {
        setDisabled: cardForm.setDisabled,
        submit: cardForm.submit,
        destroy: () => {
          cardForm.destroy();
          removeMethod();
        },
      };
    } else {
      const component = document.createElement(
        method === PaymentMethod.PAYMENT_CARD
          ? 'primer-card-form'
          : 'primer-payment-method'
      );
      if (method !== PaymentMethod.PAYMENT_CARD) {
        component.setAttribute('type', method);
        ensureTokens();
        provider.classList.add('ff-primer-wallet');
      }
      provider.appendChild(component);
      htmlNode.appendChild(provider);
      methodInterface = {
        setDisabled: (disabled: boolean) => {
          component.toggleAttribute('disabled', disabled);
        },
        submit: async () => {
          if (method === PaymentMethod.PAYMENT_CARD) {
            component.dispatchEvent(
              new CustomEvent('primer:card-submit', {
                bubbles: true,
                composed: true,
              })
            );
          }
        },
        destroy: removeMethod,
      };
    }
    options.onMethodRender?.(method);
    this.methodInterfaces.push(methodInterface);
    return methodInterface;
  }

  async renderCheckout(
    clientToken: string,
    checkoutOptions: CheckoutOptions,
    renderOptions: CheckoutRenderOptions
  ) {
    await this.initializeHeadlessCheckout(clientToken, checkoutOptions);
    renderOptions.onMethodsAvailable?.(this.availableMethods);
    const buttonNodes: Partial<Record<PaymentMethod, HTMLElement>> = {
      [PaymentMethod.PAYPAL]: renderOptions.paymentButtonElements?.paypal,
      [PaymentMethod.GOOGLE_PAY]:
        renderOptions.paymentButtonElements?.googlePay,
      [PaymentMethod.APPLE_PAY]: renderOptions.paymentButtonElements?.applePay,
    };
    await Promise.all(
      this.availableMethods.map(method => {
        const node =
          method === PaymentMethod.PAYMENT_CARD
            ? renderOptions.container
            : buttonNodes[method];
        return node ? this.initMethod(method, node, renderOptions) : undefined;
      })
    );
    this.isInitialized = true;
  }

  disableButtons(disabled: boolean) {
    for (const methodInterface of this.methodInterfaces) {
      methodInterface.setDisabled(disabled);
    }
  }

  refreshClientSession() {
    return this.checkout?.refreshSession();
  }

  async destroy() {
    for (const methodInterface of [...this.methodInterfaces]) {
      methodInterface.destroy?.();
    }
    if (this.clientToken) {
      releaseCheckout(this.clientToken);
    }
    this.checkout = null;
    this.clientToken = null;
    this.isInitialized = false;
  }
}

export default PrimerCheckoutWrapper;
