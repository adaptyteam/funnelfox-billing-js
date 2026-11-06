# Primer Checkout

Primer ships new features (Apple Pay outside Safari, a separate result for a shopper cancel, better handling of poor
connections) only in its new web SDK, Primer Checkout (`@primer-io/primer-js`). The SDK runs a checkout on either
Primer SDK. The FunnelFox billing backend decides which one per org, so integrations keep their code.

## How a session picks the Primer SDK

`create_client_session` returns `primer_sdk`:

| `primer_sdk`       | Primer SDK in the browser          | Who creates the payment                                |
| ------------------ | ---------------------------------- | ------------------------------------------------------ |
| `legacy` (default) | checkout-web v2, Headless Checkout | our backend, from the payment method token             |
| `checkout`         | Primer Checkout                    | Primer, after our backend approves the payment attempt |

The value is an org setting that the FunnelFox team switches. Nothing to configure in the integration.

## What changes for an integration

Nothing, if you use `createCheckout` with the default skin or `Billing.initMethod`. Same calls, same callbacks and
events, same card skin and wallet buttons.

Under the hood, on a `checkout` session:

- **Loading.** Primer Checkout is imported at runtime from
  `https://cdn.jsdelivr.net/npm/@primer-io/primer-js@<version>/+esm`, so it is not in the SDK bundle. The
  checkout-web v2 script is not loaded, except for one-click 3DS (see below).
  `getAvailablePaymentMethods` reads the method list from Primer Checkout too.
- **One checkout per session.** Primer Checkout supports one `<primer-checkout>` per page. The SDK appends one
  hidden `<primer-checkout>` to `document.body` per client session, and every payment method renders inside a
  `<primer-provider>` in the container you passed. Several `initMethod` calls for the same session share it.
- **Payment.** The SDK sends Primer's approval request to `/v1/checkout/approve_payment`; Primer then creates the
  payment and runs 3DS itself. On success the SDK syncs the order through `/v1/checkout/order_status` before it
  reports success, so the purchase already exists when your callback runs.
- **Failures.** Primer Checkout gives the browser only a generic failure. The SDK reads the decline from
  `/v1/checkout/order_status`, so `onPaymentFail` errors keep `declineCode` and `declineCodeSource`.
- **Cancel.** A closed wallet sheet is reported as a cancel (`onPaymentCancel`, `purchase-cancelled`), as before.

## Visible differences

The card skin keeps its markup, labels and its own fields (cardholder name, email, country, postal code). Card number,
expiry date and CVV are Primer Checkout inputs styled through Primer's CSS tokens:

- the field error text under number, expiry and CVV is rendered by Primer (same color and size as the skin's);
- the field border turns red on an error;
- the card number field shows the card network icon. It is also where Primer offers the network choice for
  co-badged cards;
- the CVV is always required.

Apple Pay is offered only where the browser supports it natively (Safari, iOS), as with checkout-web v2, and there
it replaces Google Pay, as before. Primer Checkout could also offer Apple Pay in other browsers through a QR code to an
iPhone; that would hide Google Pay for every Chrome shopper, so it stays off.

Wallet buttons keep their 54 px height and 28 px radius. PayPal shows only the PayPal button: PayPal's card button
is turned off because cards go through the card form.

## Content Security Policy

On top of what checkout-web v2 needs (`sdk.primer.io`, Primer API, wallet providers), allow:

- `script-src https://cdn.jsdelivr.net` for the Primer Checkout module.

Primer Checkout also loads Apple's Apple Pay scripts from `https://applepay.cdn-apple.com`. They are needed only for
Apple Pay outside Safari, which the SDK does not offer, so blocking them only adds console errors.

## Browser support

Primer Checkout needs ES2020 browsers: Chrome and Edge 80+, Firefox 79+, Safari and iOS 14+.

## One-click 3DS

`silentPurchase({ handle3DS: true })` keeps running the 3DS challenge on checkout-web v2 for all orgs, including
orgs on Primer Checkout. Primer Checkout has no way to run 3DS for a payment our backend created. The v2 script is
loaded only when a challenge is needed. The decision and its evidence are in FFB-768.

## Known limitations

- Apple Pay button height and corner radius cannot be set on Primer Checkout. The height follows the same token as
  the other wallets; it is not verified on a device yet.
- `createCheckout` with custom `cardSelectors` inside `container` does not work on either Primer SDK: the
  initialization loader replaces the container's content before the selectors are resolved.
