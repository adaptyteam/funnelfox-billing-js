import template from './template.html';
import './styles.css';

export default (container: string) => {
  const containerEl = document.querySelector(container);
  containerEl.innerHTML = template;
  document.body.appendChild(containerEl);

  // Initialize accordion behavior
  const paymentMethodCards = containerEl.querySelectorAll(
    '.ff-payment-method-card'
  );
  const radioButtons = containerEl.querySelectorAll<HTMLInputElement>(
    '.ff-payment-method-radio'
  );

  // Function to handle accordion behavior
  const handleAccordion = (checkedRadio: HTMLInputElement | null) => {
    paymentMethodCards.forEach(card => {
      const radio = card.querySelector<HTMLInputElement>(
        '.ff-payment-method-radio'
      );
      const content = card.querySelector<HTMLElement>(
        '.ff-payment-method-content'
      );

      if (radio === checkedRadio && radio?.checked) {
        // Open the selected card
        card.classList.add('expanded');
      } else {
        // Close other cards
        card.classList.remove('expanded');
      }
    });
  };

  // Set initial state based on checked radio
  const checkedRadio = Array.from(radioButtons).find(radio => radio.checked);
  // Use setTimeout to ensure DOM is fully rendered before measuring
  setTimeout(() => {
    handleAccordion(checkedRadio || null);
  }, 0);

  // Add event listeners to radio buttons
  radioButtons.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        handleAccordion(radio);
      }
    });
  });

  return new Promise(resolve => {
    setTimeout(() => {
      resolve(true);
    }, 0);
  });
};
