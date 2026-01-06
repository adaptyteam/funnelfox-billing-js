import type {
  CardInputSelectors,
  CheckoutOptions,
  CheckoutState,
  PrimerWrapperInterface,
  PaymentButtonElements,
  CheckoutConfig,
  PaymentMethod,
  CardInputElements,
  CardInputElementsWithButton,
} from '../types';

export interface Skin {
  init(): Promise<void>;

  /**
   * Render or initialize the card form section within the container.
   * Implementations may be a no-op if the form is part of the base template.
   */
  renderCardForm(): void;

  getCheckoutOptions(): {
    cardElements?: CardInputElements | CardInputElementsWithButton;
    paymentButtonElements?: PaymentButtonElements;
    card?: CheckoutOptions['card'];
    applePay?: CheckoutOptions['applePay'];
    paypal?: CheckoutOptions['paypal'];
    googlePay?: CheckoutOptions['googlePay'];
  };

  /**
   * Get the DOM nodes corresponding to the card input selectors, for wiring
   * validation, error containers etc.
   */
  getCardInputElements(): CardInputElements;

  onLoaderChange?(isLoading: boolean): void;

  onError?(error: Error, paymentMethod?: PaymentMethod): void;

  onMethodRender?(paymentMethod: PaymentMethod): void;

  onStatusChange?(state: CheckoutState, oldState: CheckoutState): void;

  onSuccess?(): void;

  onDestroy?(): void;

  onInputError?(event: { name: keyof CardInputSelectors; error: string }): void;

  onStartPurchase?(paymentMethod: PaymentMethod): void;

  onPurchaseFailure?(error: Error): void;

  onPurchaseCompleted?(): void;

  onMethodsAvailable?(methods: PaymentMethod[]): void;
}

export type SkinFactory = (
  primerWrapper: PrimerWrapperInterface,
  checkoutConfig: CheckoutConfig
) => Promise<Skin>;
