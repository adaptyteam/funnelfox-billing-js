import errorHtml from './error.html';
import './error.css';

export const errorConfig = {
  html: errorHtml,
  selectors: {
    errorContainerWrapper: '.ff-sdk-error-container',
    errorRequestId: '.ff-sdk-error-request-id',
  },
};

export const renderError = (container: string, reqId?: string) => {
  const errorContainer = document.querySelector(container);
  if (errorContainer) {
    errorContainer.innerHTML = errorConfig.html;
    if (reqId) {
      const errorRequestId = errorContainer.querySelector(
        errorConfig.selectors.errorRequestId
      );
      if (errorRequestId) {
        errorRequestId.textContent = `Request ID: ${reqId}`;
      }
    }
  }
};

export const hideError = () => {
  const errorContainer = document.querySelector(
    errorConfig.selectors.errorContainerWrapper
  );
  if (errorContainer) {
    errorContainer.remove();
  }
};
