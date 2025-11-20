# Funnelfox Billing SDK Examples

This directory contains working examples of the Funnelfox Billing SDK integration.

## 📁 Examples

### `basic/` ⭐ **Start Here**

A clean, minimal example showing how to accept payments:
- Simple SDK configuration
- Checkout with success/error handling
- Separate HTML, CSS, and JavaScript files
- ~30 lines of core logic

**Files:**
- `index.html` - HTML structure with Primer and SDK includes
- `script.js` - Checkout initialization and event handling
- `styles.css` - Basic styling

**Best for:** Getting started quickly, copying into your project

---

## 🚀 Running the Examples

### Option 1: Build and View Locally

Using the published tarball in the repo (basic example):

```bash
# From repo root
npm i --prefix examples/basic
npm run build --prefix examples/basic

# Open the built example
open examples/basic/dist/index.html
```

Or run a local server:

```bash
# From repo root
npm run serve --prefix examples/basic
# Then open http://localhost:8000
```

---

### Option 1 (alternative): Build SDK from source (no bundling)

1. Build the SDK:
   ```bash
   npm run build
   ```

2. Open the example in your browser:
   ```bash
   open examples/basic/index.html
   ```

### Option 2: Use a Local Server

For better development experience:

```bash
# Using Python
python3 -m http.server 8000

# Using Node.js
npx http-server

# Using PHP
php -S localhost:8000
```

Then navigate to: http://localhost:8000/examples/basic/

---

## 📝 Configuration

All examples use placeholder configuration. Update these values:

```javascript
import { configure } from '@funnelfox/billing';

configure({
  orgId: 'your-org-id',                   // Your organization ID
  baseUrl: 'https://billing.funnelfox.com', // Optional: Custom API URL
  region: 'default',                       // Optional: Your region
});
```

---

## 🔑 Required: Primer SDK

All examples require the Primer SDK to be loaded:

```html
<script src="https://sdk.primer.io/web/v2.54.0/Primer.min.js"></script>
<link rel="stylesheet" href="https://sdk.primer.io/web/v2.0.0/Checkout.css" />
```

This is a **peer dependency** and must be included before the Funnelfox SDK.

---

## 💡 Key Concepts

### Basic Checkout

```javascript
import { configure, createCheckout } from '@funnelfox/billing';

// Configure once
configure({
  orgId: 'your-org-id',
});

// Create checkout
const checkout = await createCheckout({
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
  },
  container: '#checkout-container',
});

// Handle success
checkout.on('success', (result) => {
  console.log('Payment successful!', result.orderId);
  window.location.href = '/success';
});

// Handle errors
checkout.on('error', (error) => {
  console.error('Payment failed:', error.message);
});
```

### Callback Pattern (Alternative)

```javascript
const checkout = await createCheckout({
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
  },
  container: '#checkout-container',

  // Use callbacks instead of events
  onSuccess: (result) => {
    console.log('Payment successful:', result.orderId);
  },

  onError: (error) => {
    console.error('Payment failed:', error.message);
  },

  onStatusChange: (newState, oldState) => {
    console.log(`Status: ${oldState} → ${newState}`);
  },
});
```

### Inline Configuration

```javascript
// Pass orgId directly (no configure needed)
const checkout = await createCheckout({
  orgId: 'your-org-id',
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
  },
  container: '#checkout-container',
});
```

### Namespace Style

```javascript
import { Billing } from '@funnelfox/billing';

// Configure
Billing.configure({
  orgId: 'your-org-id',
});

// Create checkout
const checkout = await Billing.createCheckout({
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
  },
  container: '#checkout-container',
});
```

---

## 🎯 Checkout Lifecycle States

The SDK tracks checkout through these states:

| State | Description |
|-------|-------------|
| `initializing` | Creating client session |
| `ready` | Waiting for payment input |
| `processing` | Processing payment |
| `action_required` | Additional auth needed (3DS) |
| `completed` | Payment successful |
| `error` | Error occurred |

Listen to state changes:
```javascript
checkout.on('status-change', (newState, oldState) => {
  console.log(`${oldState} → ${newState}`);
});
```

---

## 🔧 Custom Primer Options

Pass custom Primer SDK options using `universalCheckoutOptions`:

```javascript
const checkout = await createCheckout({
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
    countryCode: 'US',  // Optional
  },
  container: '#checkout-container',

  // Pass options to Primer SDK
  universalCheckoutOptions: {
    paypal: {
      buttonColor: 'gold',
      paymentFlow: 'PREFER_VAULT',
    },
    style: {
      input: {
        fontSize: '16px',
      },
    },
  },
});
```

See [Primer docs](https://primer.io/docs) for all available options.

---

## 🔄 Dynamic Price Updates

Update the checkout to use a different price without page reload:

```javascript
// Initial checkout
const checkout = await createCheckout({
  priceId: 'price_monthly',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
  },
  container: '#checkout-container',
});

// Later, switch to yearly plan
await checkout.updatePrice('price_yearly');
```

**Note:** Cannot update price while payment is processing.

---

## ❓ Troubleshooting

### "Primer SDK not found"
Make sure Primer script is loaded before Funnelfox SDK:
```html
<!-- Load Primer FIRST -->
<script src="https://sdk.primer.io/web/v2.54.0/Primer.min.js"></script>
<link rel="stylesheet" href="https://sdk.primer.io/web/v2.0.0/Checkout.css" />

<!-- Then Funnelfox -->
<script src="https://unpkg.com/@funnelfox/billing@latest/dist/funnelfox-billing.min.js"></script>
```

### "Container not found"
Ensure your container element exists in the DOM:
```html
<div id="checkout-container"></div>
<script>
  // Wait for DOM
  window.addEventListener('load', async () => {
    const checkout = await Billing.createCheckout({
      container: '#checkout-container'  // Must exist!
    });
  });
</script>
```

### "orgId is required"
Either configure globally or pass inline:
```javascript
// Option 1: Configure globally
Billing.configure({ orgId: 'your-org-id' });
const checkout = await Billing.createCheckout({ /* ... */ });

// Option 2: Pass inline
const checkout = await Billing.createCheckout({
  orgId: 'your-org-id',
  /* ... */
});
```

### TypeScript Support
For TypeScript projects, types are included automatically:
```typescript
import {
  configure,
  createCheckout,
  CheckoutInstance,
  PaymentResult,
} from '@funnelfox/billing';

const checkout: CheckoutInstance = await createCheckout({
  priceId: 'price_123',
  customer: {
    externalId: 'user_456',
    email: 'user@example.com',
  },
  container: '#checkout-container',
});
```

---

## 📚 Additional Resources

- [SDK Documentation](../README.md)
- [TypeScript Definitions](../types.d.ts)
- [Primer SDK Docs](https://primer.io/docs)

---

**Need help?** Open an issue on [GitHub](https://github.com/adaptyteam/funnelfox-billing-js/issues)
