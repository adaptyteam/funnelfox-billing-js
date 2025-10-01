/**
 * Jest test setup
 */

// Mock fetch globally
global.fetch = jest.fn();

// Mock Primer SDK
global.Primer = {
  showUniversalCheckout: jest.fn().mockResolvedValue({
    container: '#test-container',
    destroy: jest.fn()
  })
};

// Mock DOM methods
Object.defineProperty(window, 'location', {
  value: {
    href: 'http://localhost'
  }
});

// Setup DOM cleanup
afterEach(() => {
  // Clear all mocks
  jest.clearAllMocks();
  
  // Clear DOM
  document.body.innerHTML = '';
});

// Add test container
beforeEach(() => {
  const container = document.createElement('div');
  container.id = 'test-container';
  document.body.appendChild(container);
});