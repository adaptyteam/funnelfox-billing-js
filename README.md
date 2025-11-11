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
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
    countryCode: 'US', // Optional
  },
  container: '#checkout-container',

  // Optional
  orgId: 'your-org-id', // If not configured globally
  clientMetadata: { source: 'web' },
  cardSelectors: {
    // Custom card input selectors (optional, defaults to auto-generated)
    cardNumber: '#cardNumberInput',
    expiryDate: '#expiryInput',
    cvv: '#cvvInput',
    cardholderName: '#cardHolderInput',
    button: '#submitButton',
  },
  paypalButtonContainer: '#paypalButton', // Optional
  googlePayButtonContainer: '#googlePayButton', // Optional
  applePayButtonContainer: '#applePayButton', // Optional

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
  - `customer.email` (string, required) - Customer email
  - `customer.countryCode` (string, optional) - ISO country code
- `options.container` (string, required) - CSS selector for checkout container
- `options.orgId` (string, optional) - Org ID (if not configured globally)
- `options.clientMetadata` (object, optional) - Custom metadata
- `options.cardSelectors` (object, optional) - Custom card input selectors (defaults to auto-generated)
- `options.paypalButtonContainer` (string, optional) - Container selector for PayPal button
- `options.googlePayButtonContainer` (string, optional) - Container selector for Google Pay button
- `options.applePayButtonContainer` (string, optional) - Container selector for Apple Pay button
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
  email: 'user@example.com',
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
    button: '#my-submit-button',
  },
  
  // Custom payment method button containers
  paypalButtonContainer: '#my-paypal-button',
  googlePayButtonContainer: '#my-google-pay-button',
  applePayButtonContainer: '#my-apple-pay-button',
});
```

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
