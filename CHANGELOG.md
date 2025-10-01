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
