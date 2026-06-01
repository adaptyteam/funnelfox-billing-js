# @funnelfox/billing

A modern TypeScript SDK for subscription payments with Primer Headless Checkout integration.

## Features

- 🚀 **Modern API**: Clean, Promise-based interface with event-driven architecture
- 🔄 **Dynamic Pricing**: Update prices without page reload
- 🛡️ **Type-Safe**: Complete TypeScript definitions and type safety
- 🎯 **Event-Driven**: Handle success, errors, and status changes with ease
- 🔧 **Robust**: Built-in error handling, retries, and validation
- 📦 **Lightweight**: Minimal dependencies, browser-optimized
- 🎨 **Headless Checkout**: Full control over checkout UI with Primer Headless Checkout
- 💳 **Stripe Integration**: Native Stripe Elements card form and Apple Pay / Google Pay wallets

## Installation

### Via CDN

```html
<!-- Include Primer Headless Checkout SDK first -->
<script src="https://sdk.primer.io/web/v2.57.3/Primer.min.js"></script>
<link rel="stylesheet" href="https://sdk.primer.io/web/v2.57.3/Checkout.css" />

<!-- Include Funnelfox Billing SDK -->
<script src="https://unpkg.com/@funnelfox/billing@latest/dist/funnelfox-billing.min.js"></script>
```

### Via NPM

```bash
npm install @funnelfox/billing @primer-io/checkout-web
```

If you are developing locally, install dev tooling for TypeScript builds/tests:

```bash
npm i -D @rollup/plugin-typescript ts-jest @types/jest
```

Then build:

```bash
npm run build
```

## Quick Start

```javascript
import { Billing } from '@funnelfox/billing';

await Billing.createCheckout({
  orgId: 'your-org-id',
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
  },
  container: '#checkout-container',
});
```

## API Reference

### `configure(config)`

Configure global SDK settings.

```javascript
import { configure } from '@funnelfox/billing';

configure({
  orgId: 'your-org-id', // Required
  baseUrl: 'https://custom.api', // Optional, defaults to https://billing.funnelfox.com
  region: 'us-east-1', // Optional, defaults to 'default'
});
```

**Parameters:**

- `config.orgId` (string, required) - Your organization identifier
- `config.baseUrl` (string, optional) - Custom API URL
- `config.region` (string, optional) - Region, defaults to 'default'

---

### `createCheckout(options)`

Creates a new checkout instance.

```javascript
const checkout = await createCheckout({
  // Required
  orgId: 'your-org-id',
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com', // Optional if you collect it in the card form
    countryCode: 'US', // Optional
  },
  container: '#checkout-container',
  clientMetadata: { source: 'web' },
  card: {
    emailAddress: {
      visible: true,
      template: '{{email}}',
    },
  },
  cardSelectors: {
    // Custom card input selectors (optional, defaults to auto-generated)
    cardNumber: '#cardNumberInput',
    expiryDate: '#expiryInput',
    cvv: '#cvvInput',
    cardholderName: '#cardHolderInput',
    emailAddress: '#emailAddressInput',
    button: '#submitButton',
  },
  paypalButtonContainer: '#paypalButton', // Optional
  googlePayButtonContainer: '#googlePayButton', // Optional
  applePayButtonContainer: '#applePayButton', // Optional
  paymentMethodOrder: ['PAYMENT_CARD', 'PAYPAL', 'GOOGLE_PAY', 'APPLE_PAY'], // Optional

  // Callbacks (alternative to events)
  onSuccess: result => {
    /* ... */
  },
  onError: error => {
    /* ... */
  },
  onStatusChange: (state, oldState) => {
    /* ... */
  },
});
```

**Parameters:**

- `options.priceId` (string, required) - Price identifier
- `options.customer` (object, required)
  - `customer.externalId` (string, required) - Your user identifier
  - `customer.email` (string, optional) - Customer email
  - `customer.countryCode` (string, optional) - ISO country code
- `options.container` (string, required) - CSS selector for checkout container
- `options.card.emailAddress.visible` (boolean, optional) - Shows an email field in the card form. Disabled by default.
- `options.card.emailAddress.template` (string, optional) - Wraps the entered email before it is sent with payment, for example `{{email}}`.

**Container Styling Requirements (Default Skin):**

When using the default skin, the container element must have the following CSS properties for proper display of the loading indicator:

```css
#checkout-container {
  position: relative;
  min-height: 200px; /* Adjust based on your layout */
}
```

- `position: relative` - Required because the loading overlay uses `position: absolute` to cover the container
- `min-height` - Required to ensure the loader is visible during initialization. Recommended minimum is `200px`

**Additional Parameters:**

- `options.orgId` (string, optional) - Org ID (if not configured globally)
- `options.clientMetadata` (object, optional) - Custom metadata
- `options.cardSelectors` (object, optional) - Custom card input selectors (defaults to auto-generated)
- `options.paypalButtonContainer` (string, optional) - Container selector for PayPal button
- `options.googlePayButtonContainer` (string, optional) - Container selector for Google Pay button
- `options.applePayButtonContainer` (string, optional) - Container selector for Apple Pay button
- `options.paymentMethodOrder` (array, optional) - Custom order for payment methods. Available values: `'PAYMENT_CARD'`, `'PAYPAL'`, `'GOOGLE_PAY'`, `'APPLE_PAY'`. Defaults to `['PAYMENT_CARD', 'PAYPAL', 'GOOGLE_PAY', 'APPLE_PAY']`
- `options.onInitialized` (function, optional) - Initialized callback
- `options.onSuccess` (function, optional) - Success callback
- `options.onError` (function, optional) - Error callback
- `options.onStatusChange` (function, optional) - State change callback

**Returns:** `Promise<CheckoutInstance>`

---

### `createClientSession(params)`

Create a client session manually (for advanced integrations).

```javascript
import { createClientSession } from '@funnelfox/billing';

const session = await createClientSession({
  priceId: 'price_123',
  externalId: 'user_456',
  email: 'user@example.com', // Optional
  orgId: 'your-org-id', // Optional if configured
});

console.log(session.clientToken); // Use with Primer Headless Checkout
console.log(session.orderId);
```

**Returns:** `Promise<{ clientToken: string, orderId: string, type: string }>`

---

### CheckoutInstance

#### Properties

- `id` (string) - Unique checkout identifier
- `state` (string) - Current state: `initializing`, `ready`, `processing`, `completed`, `error`
- `orderId` (string) - Order identifier (available after initialization)
- `isDestroyed` (boolean) - Whether checkout has been destroyed

#### Events

##### `'success'`

Emitted when payment completes successfully.

```javascript
checkout.on('success', result => {
  console.log('Order ID:', result.orderId);
  console.log('Status:', result.status); // 'succeeded'
  console.log('Transaction:', result.transactionId);
});
```

##### `'error'`

Emitted when payment fails or encounters an error.

```javascript
checkout.on('error', error => {
  console.error('Error:', error.message);
  console.error('Code:', error.code);
  console.error('Request ID:', error.requestId); // For support
});
```

##### `'status-change'`

Emitted when checkout state changes.

```javascript
checkout.on('status-change', (newState, oldState) => {
  console.log(`${oldState} → ${newState}`);
  // States: initializing, ready, processing, action_required, completed, error
});
```

##### `'destroy'`

Emitted when checkout is destroyed.

```javascript
checkout.on('destroy', () => {
  console.log('Checkout cleaned up');
});
```

#### Methods

##### `updatePrice(priceId)`

Updates the checkout to use a different price.

```javascript
await checkout.updatePrice('price_yearly');
```

**Note:** Cannot update price while payment is processing.

##### `getStatus()`

Returns current checkout status.

```javascript
const status = checkout.getStatus();
console.log(status.id); // Checkout ID
console.log(status.state); // Current state
console.log(status.orderId); // Order ID
console.log(status.priceId); // Current price ID
console.log(status.isDestroyed); // Cleanup status
```

##### `destroy()`

Destroys the checkout instance and cleans up resources.

```javascript
await checkout.destroy();
```

##### `isReady()`

Check if checkout is ready for payment.

```javascript
if (checkout.isReady()) {
  console.log('Ready to accept payment');
}
```

##### `isProcessing()`

Check if payment is being processed.

```javascript
if (checkout.isProcessing()) {
  console.log('Payment in progress...');
}
```

---

## Complete Example

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Funnelfox Checkout</title>
    <script src="https://sdk.primer.io/web/v2.57.3/Primer.min.js"></script>
    <link
      rel="stylesheet"
      href="https://sdk.primer.io/web/v2.57.3/Checkout.css"
    />
    <script src="https://unpkg.com/@funnelfox/billing@latest/dist/funnelfox-billing.min.js"></script>
  </head>
  <body>
    <div id="price-selector">
      <button onclick="selectPrice('price_monthly')">Monthly - $9.99</button>
      <button onclick="selectPrice('price_yearly')">Yearly - $99.99</button>
    </div>

    <div id="checkout-container"></div>

    <script>
      let currentCheckout = null;

      // Configure SDK once
      Billing.configure({
        orgId: 'your-org-id',
      });

      async function selectPrice(priceId) {
        try {
          if (currentCheckout && currentCheckout.isReady()) {
            // Update existing checkout
            await currentCheckout.updatePrice(priceId);
          } else {
            // Destroy old checkout if exists
            if (currentCheckout) {
              await currentCheckout.destroy();
            }

            // Create new checkout
            currentCheckout = await Billing.createCheckout({
              priceId: priceId,
              customer: {
                externalId: generateUserId(),
                email: getUserEmail(),
              },
              container: '#checkout-container',
            });

            // Handle success
            currentCheckout.on('success', result => {
              alert('Payment successful!');
              window.location.href = '/success?order=' + result.orderId;
            });

            // Handle errors
            currentCheckout.on('error', error => {
              alert('Payment failed: ' + error.message);
            });

            // Track state changes
            currentCheckout.on('status-change', state => {
              console.log('Checkout state:', state);
            });
          }
        } catch (error) {
          console.error('Checkout error:', error);
          alert('Failed to initialize checkout');
        }
      }

      function generateUserId() {
        return 'user_' + Math.random().toString(36).substr(2, 9);
      }

      function getUserEmail() {
        return 'user@example.com'; // Get from your auth system
      }
    </script>
  </body>
</html>
```

## Error Handling

The SDK provides specific error classes for different scenarios:

```javascript
import {
  ValidationError,
  APIError,
  PrimerError,
  CheckoutError,
  NetworkError,
} from '@funnelfox/billing';

try {
  const checkout = await createCheckout(config);
} catch (error) {
  if (error instanceof ValidationError) {
    // Invalid input
    console.log('Field:', error.field);
    console.log('Value:', error.value);
    console.log('Message:', error.message);
  } else if (error instanceof APIError) {
    // API error
    console.log('Status:', error.statusCode);
    console.log('Error Code:', error.errorCode); // e.g., 'double_purchase'
    console.log('Error Type:', error.errorType); // e.g., 'api_exception'
    console.log('Request ID:', error.requestId); // For support
    console.log('Message:', error.message);
  } else if (error instanceof PrimerError) {
    // Primer SDK error
    console.log('Primer error:', error.message);
    console.log('Original:', error.primerError);
  } else if (error instanceof CheckoutError) {
    // Checkout lifecycle error
    console.log('Phase:', error.phase);
    console.log('Message:', error.message);
  } else if (error instanceof NetworkError) {
    // Network/connectivity error
    console.log('Network error:', error.message);
    console.log('Original:', error.originalError);
  }
}
```

### Common Error Codes

- `double_purchase` - User already has an active subscription
- `invalid_price` - Price ID not found
- `invalid_customer` - Customer data validation failed
- `payment_failed` - Payment processing failed

## TypeScript Support

The SDK includes comprehensive TypeScript definitions:

```typescript
import {
  configure,
  createCheckout,
  CheckoutInstance,
  PaymentResult,
  CheckoutConfig,
  PaymentMethod,
} from '@funnelfox/billing';

// Configure
configure({
  orgId: 'your-org-id',
});

// Create checkout with type safety
const checkout: CheckoutInstance = await createCheckout({
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
    countryCode: 'US',
  },
  container: '#checkout',
  clientMetadata: {
    source: 'web',
    campaign: 'summer-sale',
  },
  paymentMethodOrder: [
    PaymentMethod.PAYPAL,
    PaymentMethod.PAYMENT_CARD,
    PaymentMethod.GOOGLE_PAY,
    PaymentMethod.APPLE_PAY,
  ],
});

// Type-safe event handlers
checkout.on('success', (result: PaymentResult) => {
  console.log('Order:', result.orderId);
  console.log('Status:', result.status);
  console.log('Transaction:', result.transactionId);
});
```

## Advanced Usage

### Using Callbacks Instead of Events

```javascript
const checkout = await createCheckout({
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
  },
  container: '#checkout',

  // Callback style (alternative to .on() events)
  onSuccess: result => {
    console.log('Success!', result.orderId);
  },
  onError: error => {
    console.error('Error!', error.message);
  },
  onStatusChange: (newState, oldState) => {
    console.log(`${oldState} → ${newState}`);
  },
});
```

### Custom Card Input Selectors

By default, the SDK automatically generates card input elements. You can provide custom selectors if you want to use your own HTML structure:

```javascript
const checkout = await createCheckout({
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
  },
  container: '#checkout',

  // Custom card input selectors
  cardSelectors: {
    cardNumber: '#my-card-number',
    expiryDate: '#my-expiry',
    cvv: '#my-cvv',
    cardholderName: '#my-cardholder',
    emailAddress: '#my-email',
    button: '#my-submit-button',
  },

  // Custom payment method button containers
  paypalButtonContainer: '#my-paypal-button',
  googlePayButtonContainer: '#my-google-pay-button',
  applePayButtonContainer: '#my-apple-pay-button',
});
```

### Custom Payment Method Order

You can customize the order in which payment methods are displayed to your customers:

```javascript
const checkout = await createCheckout({
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
  },
  container: '#checkout',

  // Customize payment method order
  paymentMethodOrder: ['PAYPAL', 'GOOGLE_PAY', 'APPLE_PAY', 'PAYMENT_CARD'],
});
```

**Available payment methods:**

- `'PAYMENT_CARD'` - Credit/debit card payment
- `'PAYPAL'` - PayPal payment
- `'GOOGLE_PAY'` - Google Pay payment
- `'APPLE_PAY'` - Apple Pay payment

By default, payment methods are shown in the order: Card, PayPal, Google Pay, Apple Pay. You can reorder them to match your business priorities or regional preferences.

### Using `initMethod` for Single Payment Methods

For scenarios where you want to render a single payment method with full control over placement and callbacks:

```javascript
import { Billing, PaymentMethod } from '@funnelfox/billing';

const container = document.getElementById('payment-container');

const paymentMethod = await Billing.initMethod(
  PaymentMethod.PAYMENT_CARD, // or PAYPAL, GOOGLE_PAY, APPLE_PAY
  container,
  {
    // Required
    orgId: 'your-org-id',
    priceId: 'price_123',
    externalId: 'user_456',
    email: 'user@example.com',

    // Optional - API configuration
    baseUrl: 'https://custom.api', // Optional, defaults to https://billing.funnelfox.com
    meta: { source: 'web' }, // Optional metadata

    // Optional - Primer configuration (for customizing payment method behavior)
    style: {
      /* Primer style options */
    },
    card: {
      /* Primer card options */
    },
    applePay: {
      /* Primer Apple Pay options */
    },
    paypal: {
      /* Primer PayPal options */
    },
    googlePay: {
      /* Primer Google Pay options */
    },

    // Callbacks
    onRenderSuccess: () => {
      console.log('Payment method rendered successfully');
    },
    onRenderError: method => {
      console.error('Failed to render:', method);
    },
    onLoaderChange: isLoading => {
      console.log('Loading state:', isLoading);
    },
    onPaymentStarted: method => {
      console.log('Payment started with:', method);
    },
    onPaymentSuccess: () => {
      console.log('Payment completed successfully!');
    },
    onPaymentFail: error => {
      console.error('Payment failed:', error.message);
    },
    onPaymentCancel: () => {
      console.log('Payment was cancelled');
    },
    onErrorMessageChange: message => {
      console.log('Error message:', message);
    },
    onMethodsAvailable: methods => {
      console.log('Available methods:', methods);
    },
  }
);

// Control the payment method
paymentMethod.setDisabled(true); // Disable the payment method
paymentMethod.setDisabled(false); // Enable it

// For card payments, you can trigger submit programmatically
if (paymentMethod.submit) {
  await paymentMethod.submit();
}

// Clean up when done
await paymentMethod.destroy();
```

**Parameters:**

- `method` (PaymentMethod, required) - Payment method to initialize: `PAYMENT_CARD`, `PAYPAL`, `GOOGLE_PAY`, or `APPLE_PAY`
- `element` (HTMLElement, required) - DOM element where the payment method will be rendered
- `options` (InitMethodOptions, required):
  - `orgId` (string, required) - Your organization identifier
  - `priceId` (string, required) - Price identifier
  - `externalId` (string, required) - Your user identifier
  - `email` (string, optional) - Customer email
  - `baseUrl` (string, optional) - Custom API URL
  - `meta` (object, optional) - Custom metadata
  - `style`, `card`, `applePay`, `paypal`, `googlePay` (optional) - Primer SDK configuration options
  - Callbacks (all optional): `onRenderSuccess`, `onRenderError`, `onLoaderChange`, `onPaymentStarted`, `onPaymentSuccess`, `onPaymentFail`, `onPaymentCancel`, `onErrorMessageChange`, `onMethodsAvailable`

**Returns:** `Promise<PaymentMethodInterface>` with methods:

- `setDisabled(disabled: boolean)` - Enable/disable the payment method
- `submit()` - Trigger form submission (available for card payments)
- `destroy()` - Clean up and remove the payment method

---

### Manual Session Creation

For advanced integrations where you want to control the Primer Headless Checkout directly:

```javascript
import { createClientSession } from '@funnelfox/billing';
import { Primer } from '@primer-io/checkout-web';

// Step 1: Create session
const session = await createClientSession({
  priceId: 'price_123',
  externalId: 'user_456',
  email: 'user@example.com',
  orgId: 'your-org-id',
});

// Step 2: Use with Primer Headless Checkout directly
const headlessCheckout = await Primer.createHeadless(session.clientToken, {
  paymentHandling: 'MANUAL',
  apiVersion: '2.4',
  onTokenizeSuccess: async (paymentMethodTokenData, handler) => {
    // Your custom payment logic...
    // Call your payment API with paymentMethodTokenData.token
    handler.handleSuccess();
  },
});

await headlessCheckout.start();
```

## Stripe Integration

The `Billing.stripe` namespace provides a Stripe-native checkout experience — no Primer dependency required. It supports card payments via Stripe Elements and native wallet payments (Apple Pay / Google Pay) via the Payment Request API.

> **Note:** `@primer-io/checkout-web` is **not** required for Stripe integration. Only `@funnelfox/billing` and a Stripe-enabled price in your Funnelfox account are needed.

---

### `Billing.stripe.createCardForm(element, params)`

Mounts a Stripe Elements payment form into a DOM element. Returns a `{ submit() }` handle — you control when payment is triggered (e.g. on your own button click).

```javascript
const element = document.getElementById('card-form');

const cardForm = await Billing.stripe.createCardForm(element, {
  // Required
  priceId: 'price_123',
  externalId: 'user_456',

  // Optional
  orgId: 'your-org-id',
  email: 'user@example.com',
  countryCode: 'US',
  showWallets: false, // show Apple Pay / Google Pay inside the form
  appearance: {
    // Stripe Elements appearance API
    theme: 'stripe',
  },

  // Callbacks
  onRenderSuccess: () => {
    document.getElementById('pay-button').disabled = false;
  },
  onLoaderChange: loading => {
    document.getElementById('pay-button').disabled = loading;
  },
  onPaymentSuccess: (paymentMethod, orderId) => {
    window.location.href = '/success?order=' + orderId;
  },
  onPaymentFail: error => {
    console.error('Payment failed:', error.message);
  },
});

// Wire up your own submit button
document.getElementById('pay-button').addEventListener('click', async () => {
  await cardForm.submit();
});
```

**Key parameters:**

| Parameter        | Type     | Description                                                                       |
| ---------------- | -------- | --------------------------------------------------------------------------------- |
| `priceId`        | string   | Price identifier                                                                  |
| `externalId`     | string   | Your user identifier                                                              |
| `email`          | string?  | Customer email                                                                    |
| `orgId`          | string?  | Org ID (if not globally configured)                                               |
| `showWallets`    | boolean? | Show Apple Pay / Google Pay inside the Stripe form                                |
| `appearance`     | object?  | [Stripe Elements Appearance API](https://stripe.com/docs/elements/appearance-api) |
| `clientMetadata` | object?  | Custom metadata attached to the order                                             |

**Returns:** `Promise<{ submit: () => Promise<void> }>`

---

### `Billing.stripe.getAvailableWallet(params)`

Checks whether Apple Pay or Google Pay is available on the current device and browser. Use this to conditionally show a wallet button before attempting payment.

```javascript
const wallet = await Billing.stripe.getAvailableWallet({
  priceId: 'price_123',
  externalId: 'user_456',
});

if (wallet === 'APPLE_PAY') {
  document.getElementById('apple-pay-btn').style.display = 'block';
} else if (wallet === 'GOOGLE_PAY') {
  document.getElementById('google-pay-btn').style.display = 'block';
} else {
  // No wallet available — show card form only
}
```

**Returns:** `Promise<'APPLE_PAY' | 'GOOGLE_PAY' | null>`

---

### `Billing.stripe.purchaseWallet(params)`

Triggers the native Apple Pay or Google Pay payment sheet. Call this on button click after confirming a wallet is available via `getAvailableWallet`.

```javascript
document.getElementById('wallet-btn').addEventListener('click', async () => {
  await Billing.stripe.purchaseWallet({
    priceId: 'price_123',
    externalId: 'user_456',
    totalLabel: 'Premium Plan', // Label shown in the payment sheet

    onPaymentSuccess: (paymentMethod, orderId) => {
      window.location.href = '/success?order=' + orderId;
    },
    onPaymentFail: error => {
      console.error('Wallet payment failed:', error.message);
    },
    onPaymentCancel: () => {
      console.log('User cancelled');
    },
    onLoaderChange: loading => {
      document.getElementById('wallet-btn').disabled = loading;
    },
  });
});
```

**Key parameters:**

| Parameter        | Type    | Description                                         |
| ---------------- | ------- | --------------------------------------------------- |
| `priceId`        | string  | Price identifier                                    |
| `externalId`     | string  | Your user identifier                                |
| `totalLabel`     | string? | Label shown next to the amount in the payment sheet |
| `email`          | string? | Customer email                                      |
| `clientMetadata` | object? | Custom metadata attached to the order               |

---

### `Billing.stripe.getAvailablePaymentMethods(params)`

Returns all Stripe payment methods available for the current device. Always includes `PAYMENT_CARD`; also includes a wallet method if one is detected.

```javascript
const methods = await Billing.stripe.getAvailablePaymentMethods({
  priceId: 'price_123',
  externalId: 'user_456',
});

// methods: ['PAYMENT_CARD', 'APPLE_PAY'] or ['PAYMENT_CARD'] etc.
console.log('Available:', methods);
```

**Returns:** `Promise<PaymentMethod[]>` — always contains `PAYMENT_CARD`, optionally `APPLE_PAY` or `GOOGLE_PAY`

---

### Combined Example: Wallet Detection + Card Form Fallback

The recommended pattern — show a wallet button when available, always show the card form as fallback:

```javascript
import { Billing } from '@funnelfox/billing';

Billing.configure({ orgId: 'your-org-id' });

const params = {
  priceId: 'price_123',
  externalId: 'user_456',
  email: 'user@example.com',
};

async function initCheckout() {
  // 1. Check for wallet availability
  const wallet = await Billing.stripe.getAvailableWallet(params);

  if (wallet) {
    const walletBtn = document.getElementById('wallet-btn');
    walletBtn.textContent =
      wallet === 'APPLE_PAY' ? 'Pay with Apple Pay' : 'Pay with Google Pay';
    walletBtn.style.display = 'block';

    walletBtn.addEventListener('click', () => {
      Billing.stripe.purchaseWallet({
        ...params,
        totalLabel: 'Premium Plan',
        onPaymentSuccess: (_, orderId) => {
          window.location.href = '/success?order=' + orderId;
        },
        onPaymentFail: err => alert(err.message),
        onPaymentCancel: () => console.log('Cancelled'),
      });
    });
  }

  // 2. Always mount card form as fallback
  const cardForm = await Billing.stripe.createCardForm(
    document.getElementById('card-form'),
    {
      ...params,
      onPaymentSuccess: (_, orderId) => {
        window.location.href = '/success?order=' + orderId;
      },
      onPaymentFail: err => alert(err.message),
      onLoaderChange: loading => {
        document.getElementById('pay-btn').disabled = loading;
      },
    }
  );

  document.getElementById('pay-btn').addEventListener('click', () => {
    cardForm.submit();
  });
}

initCheckout();
```

---

## Browser Support

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Examples

See the [examples directory](./examples/) for more complete examples:

- [Basic Checkout](./examples/basic/) - Simple checkout integration

## License

MIT © Funnelfox
