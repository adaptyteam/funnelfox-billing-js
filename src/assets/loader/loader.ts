import loaderHtml from './loader.html';
import './loader.css';

export const loaderConfig = {
  html: loaderHtml,
  selectors: {
    loaderContainer: '.ff-sdk-loader-container',
    loader: '.ff-sdk-loader',
  },
};

export const renderLoader = (
  container: string,
  { keepContent = false }: { keepContent?: boolean } = {}
) => {
  const loaderContainer = document.querySelector(container);
  if (!loaderContainer) {
    return;
  }
  if (keepContent) {
    loaderContainer.insertAdjacentHTML('afterbegin', loaderConfig.html);
  } else {
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
