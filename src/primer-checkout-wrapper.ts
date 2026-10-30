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

/**
 * One `<primer-checkout>` per client session: Primer supports a single checkout per page, while the funnel renders
 * every payment method from its own `initMethod` call. Methods render through `<primer-provider>` wherever the
 * page puts them, and the checkout element itself shows nothing.
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
  private activeHooks?: PrimerCheckoutHooks;
  private approvalError: unknown;
  private readonly listeners: [string, EventListener][] = [];

  constructor(clientToken: string, options: CheckoutOptions) {
    this.element = document.createElement('primer-checkout');
    this.element.id = this.id;
    this.element.setAttribute('loader-disabled', '');
    this.element.innerHTML = '<div slot="main"></div>';
    (this.element as HTMLElement & { options: unknown }).options =
      toPrimerOptions(options);

    this.ready = new Promise((resolve, reject) => {
      // Primer components dispatch from wherever they render, so the events reach the document, not the checkout.
      this.listen('primer:ready', event => {
        this.api = (event as CustomEvent<PrimerCheckoutApi>).detail;
      });
      this.listen('primer:methods-update', event => {
        const types = (
          (event as CustomEvent<{ type: string }[]>).detail || []
        ).map(method => method.type);
        resolve(toAllowedMethods(types));
      });
      this.listen('primer:state-change', event => {
        const error = (event as CustomEvent<{ primerJsError?: unknown }>).detail
          ?.primerJsError;
        if (error) {
          reject(
            new PrimerError('Failed to initialize Primer Checkout', error)
          );
        }
      });
    });
    this.listen('primer:payment-start', event => this.onPaymentStart(event));
    this.listen('primer:payment-approval-required', event =>
      this.onApprovalRequired(event as CustomEvent<ApprovalDetail>)
    );
    this.listen('primer:payment-success', () => this.activeHooks?.onSuccess());
    this.listen('primer:payment-failure', () => {
      const approvalError = this.approvalError;
      this.approvalError = undefined;
      void this.activeHooks?.onFailure(approvalError);
    });
    this.listen('primer:payment-cancel', event => {
      const type = (event as CustomEvent<{ paymentMethodType?: string }>).detail
        ?.paymentMethodType;
      this.hooksFor(type)?.onCancel();
    });

    document.body.appendChild(this.element);
    this.element.setAttribute('client-token', clientToken);
  }

  register(method: PaymentMethod, hooks: PrimerCheckoutHooks) {
    this.hooksByMethod.set(method, hooks);
  }

  unregister(method: PaymentMethod) {
    this.hooksByMethod.delete(method);
  }

  refreshSession() {
    return this.api?.refreshSession();
  }

  setCardholderName(cardholderName: string) {
    this.api?.setCardholderName(cardholderName);
  }

  remove() {
    for (const [type, listener] of this.listeners) {
      document.removeEventListener(type, listener);
    }
    this.element.remove();
  }

  private listen(type: string, listener: EventListener) {
    document.addEventListener(type, listener);
    this.listeners.push([type, listener]);
  }

  private hooksFor(type: string | undefined | null) {
    return (
      (type && this.hooksByMethod.get(type as PaymentMethod)) ||
      this.activeHooks
    );
  }

  private onPaymentStart(event: Event) {
    const detail = (event as CustomEvent<PaymentStartDetail>).detail;
    const hooks = this.hooksFor(detail.paymentMethodType);
    if (!hooks) {
      return;
    }
    this.activeHooks = hooks;
    this.approvalError = undefined;
    event.preventDefault();
    hooks.beforePayment(detail.paymentMethodType as PaymentMethod).then(
      () => detail.continuePaymentCreation(),
      error => {
        detail.abortPaymentCreation();
        void hooks.onFailure(error);
      }
    );
  }

  private async onApprovalRequired(event: CustomEvent<ApprovalDetail>) {
    const { paymentAttemptId, continueFlow } = event.detail;
    try {
      await this.activeHooks?.approve(paymentAttemptId);
    } catch (error) {
      this.approvalError = error;
    } finally {
      // Primer keeps the checkout locked until this is called, whatever our backend decided.
      await continueFlow();
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

function toAllowedMethods(types: string[]): PaymentMethod[] {
  const methods = ALLOWED_PAYMENT_METHODS.filter(method =>
    types.includes(method)
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
    this.availableMethods = await this.checkout.ready;
    if (this.availableMethods.length === 0) {
      throw new PrimerError('No allowed payment methods found');
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
    checkout.register(method, this.hooks);

    const provider = document.createElement('primer-provider');
    provider.setAttribute('checkout-id', checkout.id);
    let methodInterface: PaymentMethodInterface;
    const removeMethod = () => {
      checkout.unregister(method);
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
