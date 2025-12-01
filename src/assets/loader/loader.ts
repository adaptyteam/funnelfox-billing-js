import loaderHtml from './loader.html';
import './loader.css';

export const loaderConfig = {
  html: loaderHtml,
  selectors: {
    loaderContainer: '.ff-sdk-loader-container',
    loader: '.ff-sdk-loader',
  },
};

export const renderLoader = (container: string) => {
  const loaderContainer = document.querySelector(container);
  if (loaderContainer) {
    loaderContainer.innerHTML = loaderConfig.html;
  }
};

export const hideLoader = () => {
  const loaderContainer = document.querySelector(
    loaderConfig.selectors.loaderContainer
  );
  if (loaderContainer) {
    loaderContainer.remove();
  }
};
