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
