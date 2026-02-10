import {
  Billing,
  CheckoutInstance,
  EVENTS,
  InitMethodOptions,
  PaymentMethod,
  PaymentMethodInterface,
  getAvailablePaymentMethods,
} from '@funnelfox/billing';

// ========================================
// Logger Utility
// ========================================

type LogType = 'info' | 'success' | 'error' | 'warn';

function createLogger(containerId: string) {
  const container = document.getElementById(containerId);

  function log(type: LogType, message: string) {
    if (!container) return;

    // Remove placeholder if exists
    const placeholder = container.querySelector('.log-placeholder');
    if (placeholder) {
      placeholder.remove();
    }

    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    entry.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-type ${type}">${type}</span>
      <span class="log-message">${message}</span>
    `;

    container.insertBefore(entry, container.firstChild);
  }

  function clear() {
    if (!container) return;
    container.innerHTML =
      '<div class="log-placeholder">Events will appear here...</div>';
  }

  return { log, clear };
}

// ========================================
// Simple Router
// ========================================

class Router {
  private routes: Record<string, () => void> = {};

  constructor() {
    window.addEventListener('hashchange', () => this.handleRoute());
    window.addEventListener('load', () => this.handleRoute());
  }

  addRoute(path: string, handler: () => void) {
    this.routes[path] = handler;
    return this;
  }

  private handleRoute() {
    const hash = window.location.hash || '#/checkout';
    const path = hash.replace('#', '') || '/checkout';

    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
      const linkPath = link.getAttribute('href')?.replace('#', '');
      link.classList.toggle('active', linkPath === path);
    });

    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
      page.classList.add('hidden');
    });

    // Show target page
    const pageId =
      'page-' + path.replace('/', '').replace(/\//g, '-') || 'checkout';
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
      targetPage.classList.remove('hidden');
    }

    // Execute handler
    const handler = this.routes[path];
    if (handler) {
      handler();
    }
  }

  navigate(path: string) {
    window.location.hash = `#${path}`;
  }
}

// ========================================
// Checkout Page (createCheckout example)
// ========================================

class CheckoutPage {
  private checkout: CheckoutInstance | null = null;
  private logger = createLogger('checkout-logs');
  private externalId = 'user_' + Math.random().toString(36).substring(7, 10);

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners() {
    const createBtn = document.getElementById(
      'create-checkout'
    ) as HTMLButtonElement;

    createBtn?.addEventListener('click', () => this.createCheckout());
  }

  private async createCheckout() {
    const orgId = (
      document.getElementById('checkout-orgId') as HTMLInputElement
    )?.value;
    const priceId = (
      document.getElementById('checkout-priceId') as HTMLInputElement
    )?.value;
    const createBtn = document.getElementById(
      'create-checkout'
    ) as HTMLButtonElement;
    const container = document.getElementById('checkout-container');
    const containerParent = container?.parentElement;

    if (!orgId || !priceId) {
      this.logger.log('error', 'Please provide both orgId and priceId');
      return;
    }

    this.logger.log(
      'info',
      `Creating checkout with orgId: ${orgId}, priceId: ${priceId}`
    );

    // Disable button while creating
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';
    }

    try {
      // Destroy existing checkout if any
      if (this.checkout) {
        await this.checkout.destroy();
        this.logger.log('info', 'Previous checkout destroyed');
      }

      this.checkout = await Billing.createCheckout({
        orgId,
        priceId,
        customer: {
          externalId: this.externalId,
          email: `${this.externalId}@example.com`,
          countryCode: 'US',
        },
        container: '#checkout-container',
        card: {
          cardholderName: {
            required: false,
          },
        },
        apiConfig: {
          baseUrl: 'https://billing-dev.funnelfox.dev',
        },
        clientMetadata: {
          fieldA: 'valueA',
          fieldB: 'valueB',
        },
      });

      this.logger.log('success', 'Checkout created successfully!');

      // Setup event listeners
      this.checkout.on(EVENTS.START_PURCHASE, () => {
        this.logger.log('info', 'START_PURCHASE event triggered');
      });

      this.checkout.on('success', result => {
        this.logger.log(
          'success',
          `Payment succeeded! Order ID: ${result.orderId}`
        );
      });

      this.checkout.on('error', error => {
        this.logger.log('error', `Payment error: ${error.message}`);
      });

      this.checkout.on('status-change', (newState, oldState) => {
        this.logger.log(
          'info',
          `Status changed: ${oldState || 'initial'} → ${newState}`
        );
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error occurred';
      this.logger.log('error', `Failed to create checkout: ${message}`);
    } finally {
      if (createBtn) {
        createBtn.disabled = false;
        createBtn.textContent = 'Create Checkout';
      }
    }
  }
}

// ========================================
// Init Method Page (initMethod examples)
// ========================================

interface PaymentSet {
  id: string;
  priceId: string;
  orgId: string;
  element: HTMLElement;
  card: PaymentMethodInterface | null;
  applePay: PaymentMethodInterface | null;
  googlePay: PaymentMethodInterface | null;
  paypal: PaymentMethodInterface | null;
}

class InitMethodPage {
  private logger = createLogger('init-logs');
  private externalId = 'user_' + Math.random().toString(36).substring(7, 10);
  private paymentSets: Map<string, PaymentSet> = new Map();
  private setCounter = 0;
  private hasLoadedAvailableMethods = false;

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners() {
    document
      .getElementById('add-payment-set')
      ?.addEventListener('click', () => this.addPaymentSet());
  }

  async onPageOpen() {
    // Only fetch available methods once per session
    if (this.hasLoadedAvailableMethods) return;

    const orgIdInput = document.getElementById(
      'init-orgId'
    ) as HTMLInputElement;
    const orgId = orgIdInput?.value || 'ffsandbox';

    this.logger.log('info', 'Fetching available payment methods...');

    try {
      const availableMethods = await getAvailablePaymentMethods({
        orgId,
        baseUrl: 'https://billing-dev.funnelfox.dev',
        countryCode: 'US',
      });
      this.hasLoadedAvailableMethods = true;
      this.logger.log(
        'success',
        `Available payment methods: ${JSON.stringify(availableMethods)}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.log('error', `Failed to fetch available methods: ${message}`);
    }
  }

  private updateEmptyState() {
    const emptyState = document.getElementById('empty-state');
    if (emptyState) {
      emptyState.classList.toggle('hidden', this.paymentSets.size > 0);
    }
  }

  private generateSetId(): string {
    return `set-${++this.setCounter}`;
  }

  private getBaseOptions(priceId: string, orgId: string): InitMethodOptions {
    return {
      orgId,
      priceId,
      externalId: this.externalId,
      email: `${this.externalId}@example.com`,
      baseUrl: 'https://billing-dev.funnelfox.dev',
      onPaymentStarted: (method: PaymentMethod) => {
        this.logger.log('info', `[${priceId}] Payment started with ${method}`);
      },
      onRenderSuccess: () => {
        this.logger.log('success', `[${priceId}] Method rendered`);
      },
      onRenderError: (method: PaymentMethod) => {
        this.logger.log('error', `[${priceId}] Failed to render ${method}`);
      },
      onPaymentSuccess: () => {
        this.logger.log('success', `[${priceId}] Payment completed!`);
      },
      onPaymentFail: (err: Error) => {
        this.logger.log('error', `[${priceId}] Payment failed: ${err.message}`);
      },
      onPaymentCancel: () => {
        this.logger.log('warn', `[${priceId}] Payment cancelled`);
      },
      onErrorMessageChange: (msg: string) => {
        this.logger.log('error', `[${priceId}] Error: ${msg}`);
      },
      onLoaderChange: (state: boolean) => {
        this.logger.log(
          'info',
          `[${priceId}] Loader ${state ? 'shown' : 'hidden'}`
        );
      },
      onMethodsAvailable: (methods: PaymentMethod[]) => {
        this.logger.log(
          'info',
          `[${priceId}] Methods available: ${methods.join(', ')}`
        );
      },
    };
  }

  private createSetHTML(setId: string, priceId: string): string {
    return `
      <div class="payment-set" id="${setId}">
        <div class="payment-set-header">
          <div class="payment-set-info">
            <span class="payment-set-badge">${priceId}</span>
          </div>
          <button class="btn btn-sm btn-outline" data-action="destroy-set" data-set-id="${setId}">
            Remove Set
          </button>
        </div>
        <div class="payment-set-body">
          <div class="payment-set-row">
            <div class="payment-set-column">
              <div class="payment-set-column-header">
                <span class="payment-set-column-title">Card</span>
                <button class="btn-icon-sm" data-action="destroy-card" data-set-id="${setId}" title="Destroy Card" disabled>×</button>
              </div>
              <div class="card-container" data-card="${setId}"></div>
              <button class="btn btn-primary btn-full card-submit-btn" data-action="submit-card" data-set-id="${setId}">
                Submit Payment
              </button>
            </div>
            <div class="payment-set-column">
              <div class="payment-set-column-header">
                <span class="payment-set-column-title">Payment Buttons</span>
              </div>
              <div class="payment-buttons-vertical">
                <div class="payment-button-item">
                  <div class="payment-header">
                    <span class="payment-label">Apple Pay</span>
                    <button class="btn-icon-sm" data-action="destroy-apple" data-set-id="${setId}" title="Destroy" disabled>×</button>
                  </div>
                  <div class="payment-btn-container" data-apple="${setId}"></div>
                </div>
                <div class="payment-button-item">
                  <div class="payment-header">
                    <span class="payment-label">Google Pay</span>
                    <button class="btn-icon-sm" data-action="destroy-google" data-set-id="${setId}" title="Destroy" disabled>×</button>
                  </div>
                  <div class="payment-btn-container" data-google="${setId}"></div>
                </div>
                <div class="payment-button-item">
                  <div class="payment-header">
                    <span class="payment-label">PayPal</span>
                    <button class="btn-icon-sm" data-action="destroy-paypal" data-set-id="${setId}" title="Destroy" disabled>×</button>
                  </div>
                  <div class="payment-btn-container" data-paypal="${setId}"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private async addPaymentSet() {
    const orgIdInput = document.getElementById(
      'init-orgId'
    ) as HTMLInputElement;
    const priceIdInput = document.getElementById(
      'init-priceId'
    ) as HTMLInputElement;
    const addBtn = document.getElementById(
      'add-payment-set'
    ) as HTMLButtonElement;

    const orgId = orgIdInput?.value || 'ffsandbox';
    const priceId = priceIdInput?.value || 'example_paid_intro_eur';

    if (!priceId) {
      this.logger.log('error', 'Please provide a priceId');
      return;
    }

    const setId = this.generateSetId();
    this.logger.log('info', `Creating payment set for ${priceId}...`);

    if (addBtn) {
      addBtn.disabled = true;
      addBtn.textContent = 'Creating...';
    }

    try {
      // Create and insert HTML
      const container = document.getElementById('payment-sets-container');
      if (!container) return;

      container.insertAdjacentHTML(
        'beforeend',
        this.createSetHTML(setId, priceId)
      );

      const setElement = document.getElementById(setId);
      if (!setElement) return;

      // Create the payment set object
      const paymentSet: PaymentSet = {
        id: setId,
        priceId,
        orgId,
        element: setElement,
        card: null,
        applePay: null,
        googlePay: null,
        paypal: null,
      };

      this.paymentSets.set(setId, paymentSet);
      this.updateEmptyState();

      // Setup event listeners for this set
      this.setupSetEventListeners(setId);

      // Initialize all methods
      await this.initializeSetMethods(paymentSet);

      this.logger.log('success', `Payment set created for ${priceId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.log('error', `Failed to create set: ${message}`);
    } finally {
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.textContent = 'Add Set';
      }
    }
  }

  private setupSetEventListeners(setId: string) {
    const setElement = document.getElementById(setId);
    if (!setElement) return;

    setElement.addEventListener('click', async e => {
      const target = e.target as HTMLElement;
      const action = target.dataset.action;
      const targetSetId = target.dataset.setId;

      if (!action || targetSetId !== setId) return;

      switch (action) {
        case 'destroy-set':
          await this.destroySet(setId);
          break;
        case 'destroy-card':
          await this.destroyCard(setId);
          break;
        case 'submit-card':
          await this.submitCard(setId);
          break;
        case 'destroy-apple':
          await this.destroyApplePay(setId);
          break;
        case 'destroy-google':
          await this.destroyGooglePay(setId);
          break;
        case 'destroy-paypal':
          await this.destroyPaypal(setId);
          break;
      }
    });
  }

  private async initializeSetMethods(set: PaymentSet) {
    const options = this.getBaseOptions(set.priceId, set.orgId);

    // Get containers
    const cardContainer = set.element.querySelector(
      `[data-card="${set.id}"]`
    ) as HTMLElement;
    const appleContainer = set.element.querySelector(
      `[data-apple="${set.id}"]`
    ) as HTMLElement;
    const googleContainer = set.element.querySelector(
      `[data-google="${set.id}"]`
    ) as HTMLElement;
    const paypalContainer = set.element.querySelector(
      `[data-paypal="${set.id}"]`
    ) as HTMLElement;

    // Initialize all in parallel
    const [cardResult, appleResult, googleResult, paypalResult] =
      await Promise.all([
        Billing.initMethod(PaymentMethod.PAYMENT_CARD, cardContainer, {
          ...options,
          card: { cardholderName: { required: true } },
        }).catch(err => {
          this.logger.log(
            'warn',
            `[${set.priceId}] Card error: ${err.message}`
          );
          return null;
        }),

        Billing.initMethod(PaymentMethod.APPLE_PAY, appleContainer, {
          ...options,
        }).catch(err => {
          this.logger.log('warn', `[${set.priceId}] Apple Pay not available`);
          return null;
        }),

        Billing.initMethod(PaymentMethod.GOOGLE_PAY, googleContainer, {
          ...options,
        }).catch(err => {
          this.logger.log('warn', `[${set.priceId}] Google Pay not available`);
          return null;
        }),

        Billing.initMethod(PaymentMethod.PAYPAL, paypalContainer, {
          ...options,
        }).catch(err => {
          this.logger.log(
            'warn',
            `[${set.priceId}] PayPal error: ${err.message}`
          );
          return null;
        }),
      ]);

    set.card = cardResult;
    set.applePay = appleResult;
    set.googlePay = googleResult;
    set.paypal = paypalResult;

    this.updateSetButtonStates(set);
  }

  private updateSetButtonStates(set: PaymentSet) {
    const cardBtn = set.element.querySelector(
      `[data-action="destroy-card"][data-set-id="${set.id}"]`
    ) as HTMLButtonElement;
    const appleBtn = set.element.querySelector(
      `[data-action="destroy-apple"][data-set-id="${set.id}"]`
    ) as HTMLButtonElement;
    const googleBtn = set.element.querySelector(
      `[data-action="destroy-google"][data-set-id="${set.id}"]`
    ) as HTMLButtonElement;
    const paypalBtn = set.element.querySelector(
      `[data-action="destroy-paypal"][data-set-id="${set.id}"]`
    ) as HTMLButtonElement;

    if (cardBtn) cardBtn.disabled = !set.card;
    if (appleBtn) appleBtn.disabled = !set.applePay;
    if (googleBtn) googleBtn.disabled = !set.googlePay;
    if (paypalBtn) paypalBtn.disabled = !set.paypal;
  }

  private async destroySet(setId: string) {
    const set = this.paymentSets.get(setId);
    if (!set) return;

    this.logger.log('info', `Destroying set ${set.priceId}...`);

    // Destroy all methods
    try {
      await Promise.all([
        set.card?.destroy?.(),
        set.applePay?.destroy?.(),
        set.googlePay?.destroy?.(),
        set.paypal?.destroy?.(),
      ]);
    } catch (err) {
      // Ignore errors
    }

    // Remove from DOM
    set.element.remove();
    this.paymentSets.delete(setId);
    this.updateEmptyState();

    this.logger.log('success', `Set ${set.priceId} destroyed`);
  }

  private async destroyCard(setId: string) {
    const set = this.paymentSets.get(setId);
    if (!set?.card) return;

    try {
      await set.card.destroy?.();
    } catch (err) {
      // Ignore
    }

    set.card = null;
    const container = set.element.querySelector(`[data-card="${setId}"]`);
    if (container) container.innerHTML = '';

    this.updateSetButtonStates(set);
    this.logger.log('info', `[${set.priceId}] Card destroyed`);
  }

  private async submitCard(setId: string) {
    const set = this.paymentSets.get(setId);
    if (!set?.card) {
      this.logger.log('error', `[${set?.priceId || setId}] No card to submit`);
      return;
    }

    this.logger.log('info', `[${set.priceId}] Submitting card payment...`);

    try {
      await set.card.submit?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.log('error', `[${set.priceId}] Submit failed: ${message}`);
    }
  }

  private async destroyApplePay(setId: string) {
    const set = this.paymentSets.get(setId);
    if (!set?.applePay) return;

    try {
      await set.applePay.destroy?.();
    } catch (err) {
      // Ignore
    }

    set.applePay = null;
    const container = set.element.querySelector(`[data-apple="${setId}"]`);
    if (container) container.innerHTML = '';

    this.updateSetButtonStates(set);
    this.logger.log('info', `[${set.priceId}] Apple Pay destroyed`);
  }

  private async destroyGooglePay(setId: string) {
    const set = this.paymentSets.get(setId);
    if (!set?.googlePay) return;

    try {
      await set.googlePay.destroy?.();
    } catch (err) {
      // Ignore
    }

    set.googlePay = null;
    const container = set.element.querySelector(`[data-google="${setId}"]`);
    if (container) container.innerHTML = '';

    this.updateSetButtonStates(set);
    this.logger.log('info', `[${set.priceId}] Google Pay destroyed`);
  }

  private async destroyPaypal(setId: string) {
    const set = this.paymentSets.get(setId);
    if (!set?.paypal) return;

    try {
      await set.paypal.destroy?.();
    } catch (err) {
      // Ignore
    }

    set.paypal = null;
    const container = set.element.querySelector(`[data-paypal="${setId}"]`);
    if (container) container.innerHTML = '';

    this.updateSetButtonStates(set);
    this.logger.log('info', `[${set.priceId}] PayPal destroyed`);
  }
}

// ========================================
// Initialize Application
// ========================================

(function main() {
  // Initialize pages
  const checkoutPage = new CheckoutPage();
  const initMethodPage = new InitMethodPage();

  // Setup router
  const router = new Router();
  router
    .addRoute('/checkout', () => {
      // Checkout page activated
    })
    .addRoute('/init-method', () => {
      // Init method page activated - fetch available payment methods
      initMethodPage.onPageOpen();
    });

  // Log initialization
  console.log('[Funnelfox Billing] Example SPA initialized');
})();
