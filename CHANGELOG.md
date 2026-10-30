# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-09-29

### Added

- Initial release of @funnelfox/billing SDK
- Modern JavaScript SDK for subscription payments with Primer integration
- Event-driven checkout management with `createCheckout()` API
- Dynamic price updates with `checkout.updatePrice()`
- Comprehensive error handling with custom error classes
- Full JSDoc type coverage and TypeScript definitions
- Automatic retry logic and timeout handling
- Legacy method support for backward compatibility
- Complete documentation and interactive demo

### Features

- **Clean API Design**: Simple initialization and fluent checkout creation
- **Event System**: Success, error, and status-change event handlers
- **State Management**: Internal state tracking without global variables
- **Error Recovery**: Robust error handling with retry mechanisms
- **Browser Support**: Compatible with all modern browsers
- **Build System**: UMD, ES modules, and minified distributions

## [0.2.0] - 2025-11-11

### 🚀 Features

- Added default skin for rendering the default checkout experience

### ⚙️ Refactors / Internal Changes

- Migrated entire codebase from JavaScript to TypeScript for improved type safety and maintainability
- Switched from Primer.io Universal Checkout to Primer Headless Checkout
  - `createCheckout` now uses Primer Headless Checkout internally

### ⚠️ Breaking Changes

- The SDK’s `createCheckout` API has changed due to the move to Headless Checkout
- TypeScript definitions are now included and required for integrations

## [0.2.1] - 2025-11-21

- eslint and build fixes

## [0.3.0] - 2025-11-27

- bug fixes

## [0.3.1] - 2025-11-27

- fix errors displaying for payment methods

## [0.3.2] - 2025-11-28

- fix container rendering

## [0.3.3] - 2025-11-28

- add initialization loader

## [0.4.0] - 2025-12-1

- move checkout initialization to constructor
- add `onInitialized` callback to checkout config

## [0.4.2] - 2025-12-2

- move checkout initialization to constructor
- add `onInitialized` callback to checkout config

## [0.4.3] - 2025-12-4

- fix styles

## [0.4.4] - 2025-12-4

- fix apple pay border-radius

## [0.4.5] - 2025-12-22

- export enum PaymentMethod
- support for customizing the display order of payment methods in the default skin via the paymentMethodOrder configuration option
- fix default skin behavior: open first payment method in accordion

## [0.4.6] - 2025-01-03

- fix default skin: first method should be expanded on init

## [0.5.0-beta.1] - 2025-12-22

- add ability to render payment methods through `initMethod()`
- add `silentPurchase()` method

## [0.5.0-beta.2] - 2025-12-26

- fixed types export `Billing.initMethod`, `PaymentMethod`

## [0.5.0-beta.3] - 2025-01-06

- fixed types export
- increase default checkout initialization time
- hide card fields until renderSuccess
- cache clientSession for `initMethod`

## [0.5.0-beta.4] - 2025-01-08

- remove card elements on Payment Success
- fix cache clientSession for `initMethod`
- disable card fields & payment buttons on payment process

## [0.5.0] - 2025-01-12

- hide loader on default skin when methods available
- automatic dynamically loading Primer via script/CSS injection

## [0.5.1] - 2025-01-12

- fix paypal error by caching primer headless

## [0.5.2] - 2025-01-13

- fix destroying issues
- add option onPaymentStarted to initMethod

## [0.5.3] - 2025-01-13

- default skin clear own container

## [0.5.4] - 2025-01-16

- iniMethod create headless checkouts in order
- clientSession cache fix
- improve examples
- add option onAvaialbleMethods to initMethod

## [0.5.5] - 2025-01-19

- fix cardholder name input
- make initMethod callbacks optional

## [0.5.6] - 2025-01-21

- fix default skin apple pay and google pay labels color
- add X-SDK-Version header to requests

## [0.5.7] - 2025-01-27

- add stripe radar session
- render image on error for analytics
- add ability to pass metadata on updateClientSession
- display error badge if createCheckout fails

## [0.5.8] - 2025-01-29

- default styles for wallet buttons created with initMethod

## [0.5.9] - 2025-02-03

- add paymentFlow default option for paypal

## [0.6.0] - 2025-02-10

- add getAvailablePaymentMethods
- fix render image on error for initMethod

## [0.6.1] - 2025-02-23

- fix of lose of prefer vault option after getAvailableMethods

## [0.6.2] - 2025-02-23

- prevent primer payment request after checkout destroy
- change google pay icon in default skin
- add Primer types

## [0.6.3] - 2025-02-23

- add apple pay email props by deature flag
- fix PURCHASE_CANCELLED event

## [0.6.4] - 2025-04-10

- add email option to card checkout
- add card fields visibility config from createSession
- fix Apple Pay billing settings merging

## [0.6.7] - 2025-04-20

- fix submitting and validating email field

## [0.7.0] - 2026-04-20

- Added country selector and postal code support for card checkout with backend-driven visibility overrides.

## [0.7.1] - 2026-04-28

- Added Airwallex Risk Library fingerprint

## [0.8.0] - 2026-05-15

- Added щptional SDK unhandled error telemetry, enabled via `sdk_telemetry_enabled` from `createClientSession`
- Fixed `updatePrice` now refreshes the Primer client session correctly
- Payment method buttons are disabled while the client session is refreshing

## [0.8.1] - 2026-06-08

- Update docs

## [0.9.0] - 2026-07-17

- Added Stripe direct integration: `Billing.stripe.createCardForm`, `Billing.stripe.purchaseWallet` (Apple Pay / Google Pay), `Billing.stripe.getAvailableWallet`, `Billing.stripe.getAvailablePaymentMethods`
- Added dynamic tax support for Primer and Stripe flows: session tax estimate on mount, live recalculation on country/postal change, `onTaxChange`/`onTaxError` callbacks, tax summary in the card skin (shown only when tax is added on top and non-zero)
- Added `apple_pay_recurring_payment_request` and `is_link_enabled` session options support for Stripe wallets
- Stripe 3DS is now completed with `handleNextAction` (fixes free-trial SetupIntent flows)
- Session creation extracted into a shared cached service; failed session responses are no longer cached forever, and paid orders are evicted after purchase so a repeat purchase creates a fresh order
- Fixed the Apple Pay sheet not opening in Safari: `getAvailableWallet` now prewarms the payment sheet so `purchaseWallet` can open it directly in the click handler
- Fixed `purchaseWallet` hanging forever when a 3DS challenge failed
- Fixed tax recalculation races and stale tax calculations being attached to payments for a different address

## [0.9.1] - 2026-07-28

- Tax lines are no longer rendered by the SDK; the host re-renders its own prices from `onTaxChange`
- Stripe card form honors the org's country selector and postal code visibility regardless of tax

## [0.9.2] - 2026-10-08

- `Billing.initMethod` now accepts `onTaxChange` / `onTaxError` / `onTaxPending`, reporting the session tax estimate on mount and every country/postal recalculation
- `Billing.stripe.purchaseWallet` now accepts `onTaxChange`, reporting the tax the wallet sheet authorizes
- `TaxInfo` now carries `taxBehavior` (`'inclusive' | 'exclusive'`, `undefined` when unknown) from the session/recalculation `tax_behavior`, so hosts can pick the right disclaimer without comparing amounts themselves; `taxAmount` is now the tax to show the buyer and reports `tax_inclusive_amount` for inclusive pricing
- Primer card fields report validation errors like Stripe Elements instead of only after the first submit: an incomplete value is shown once the buyer leaves the field and hidden again while they retype it, an impossible card number is shown while typing, and empty fields wait for submit
- Card form error text is styled like Stripe Elements: `#df1b41`, 15px, 8px below the field

## [0.10.0] - 2026-10-16

- Payment failures carry the billing decline code: errors passed to `onPaymentFail` (and `APIError` for a failed checkout) now have `declineCode` and `declineCodeSource` (`'primer' | 'stripe' | 'adyen'`), so funnels can tell "insufficient funds" apart from a generic failure. Stripe 3DS (`handleNextAction`) card declines are mapped client-side with the same uppercase codes the backend uses

## [0.10.1] - 2026-10-16

- `TaxInfo` now carries `taxRate` (the provider's percentage, e.g. `21` or `8.875`) and `taxBreakdown` (per-jurisdiction `amount`, `percentage`, `inclusive`, `taxType`, `country`, `subdivision`, `taxabilityReason`) from the session/recalculation `tax_breakdown`, so hosts can show the exact rate instead of deriving it from rounded minor units (21% NL VAT no longer shows as 20.94%). Both are omitted when the backend sends no breakdown

## [0.11.0] - 2026-10-21

- Added support for all Apple Pay button types (`applePay.buttonType`), including `'continue'`, via the SDK's own `ApplePayButtonType` union. The legacy 7 values render through Primer as before; newer values cannot be rendered by WebKit through Primer v2's CSS approach, so the SDK overlays Apple's official `<apple-pay-button>` element over the hidden Primer button and forwards clicks; the payment flow stays fully Primer-driven. Falls back to Primer's own button if Apple's SDK script fails to load. (PRD-1426)

## [0.12.0] - 2026-10-23

- The Apple Pay button now defaults to `'continue'` ("Continue with Apple Pay") instead of Primer's `plain`, in both the default skin and custom skins. Pass `applePay.buttonType` to keep another type, e.g. `'plain'` for the previous look
- `applePay` options passed to `createCheckout` now take priority over the default skin's, so `buttonStyle` and `buttonType` are no longer replaced by the skin defaults

## [0.13.0] - 2026-10-28

- `silentPurchase()` gains an opt-in detailed mode: pass `handle3DS: true` and it runs the Primer 3DS challenge when the bank asks for one (the one-click response carries an `action_required_token`), calls `resume_payment`, and resolves with a `OneClickResult` (`outcome`, `orderId`, `threeDSChallenged`, decline fields, `error`, `failedRequest`) instead of a boolean. Outcomes: `succeeded`, `declined`, `3ds_failed`, `3ds_abandoned`, `error`, `processing`, `already_purchased`. In this mode the promise rejects only with `ValidationError` on empty `orgId`/`baseUrl`/`priceId`/`externalId`
- Detailed mode hooks: `onThreeDSStart({ orderId })` fires once before the challenge, `onThreeDSEnd({ result })` fires exactly once afterwards with `passed`, `failed`, `abandoned` or `error`. `threeDSTimeoutMs` (default 10 minutes) gives up on an unanswered challenge (`3ds_abandoned`); if it runs out before the challenge is shown, the result is `error` (with `failedRequest: 'create_client_session'` when that request was still pending)
- In detailed mode `one_click` and `resume_payment` are sent exactly once: no retries and no client timeout. Keep the purchase button disabled until the promise resolves; a second call for the same customer while one is running resolves `error` without a request
- New optional CIT options `initiationType`, `citCardNetworks` and `citGooglePayPanOnly`, sent as `initiation_type`, `cit_card_networks` and `cit_google_pay_pan_only` only when set, in both modes
- Legacy `silentPurchase()` (no `handle3DS`) is unchanged: same request body, same `true`/`false` results, same retries and errors, and it never runs 3DS. With `initiationType: 'cit'` it logs a warning, because CIT can trigger a 3DS challenge that only detailed mode handles
- To show the challenge, detailed mode opens one extra checkout session for the customer and price point (`create_client_session`). Each challenged one-click therefore creates one additional order in `session_created` status, which counts as a checkout session in session-based conversion metrics. Purchases without a challenge are not affected

## [0.13.1] - 2026-10-29

- Card form: the Expiration date and Security code columns share grid rows and are always the same width, so their inputs stay on one line when one label wraps on a narrow checkout, and an error under one input no longer shrinks the other column. Before, the columns were sized by their content, and a wrapped "Expiration date" label or a CVV error pushed the expiry input down. (FFB-586)

## [Unreleased]

- Checkout runs on Primer Checkout (`@primer-io/primer-js`) when the client session says `primer_sdk: 'checkout'`; other sessions keep checkout-web v2. Same `createCheckout` / `Billing.initMethod` calls, callbacks and events. Details: [docs/primer-checkout.md](./docs/primer-checkout.md)
  - Primer Checkout is imported at runtime from jsDelivr, so the SDK bundle does not grow
  - One hidden `<primer-checkout>` per client session; payment methods render through `<primer-provider>` in their containers
  - The payment attempt is approved through `/v1/checkout/approve_payment`; Primer creates the payment and runs 3DS. Success syncs the order through `/v1/checkout/order_status` first, failures read the decline from it (`declineCode`, `declineCodeSource`)
  - The card skin keeps its markup and own fields; number, expiry and CVV are Primer Checkout inputs styled by CSS tokens. Wallet buttons keep 54 px height and 28 px radius; PayPal's card button is turned off
- `createCheckout` no longer loads checkout-web v2 before the session: each Primer SDK is loaded once the session tells which one is used
- One-click 3DS (`silentPurchase({ handle3DS: true })`) keeps running on checkout-web v2 for every org (FFB-768)
