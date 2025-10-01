/**
 * @fileoverview Helper utilities for Funnefox SDK
 */

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds
 * @param {function} func - Function to debounce
 * @param {number} wait - Milliseconds to delay
 * @returns {function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Creates a deep copy of an object
 * @param {*} obj - Object to clone
 * @returns {*} Deep copy of the object
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj);
  }

  if (obj instanceof Array) {
    return obj.map(deepClone);
  }

  if (typeof obj === 'object') {
    const cloned = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = deepClone(obj[key]);
      }
    }
    return cloned;
  }

  return obj;
}

/**
 * Merges multiple objects into a new object
 * @param {...Object} objects - Objects to merge
 * @returns {Object} Merged object
 */
export function merge(...objects) {
  const result = {};

  for (const obj of objects) {
    if (obj && typeof obj === 'object') {
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          if (
            typeof obj[key] === 'object' &&
            !Array.isArray(obj[key]) &&
            obj[key] !== null
          ) {
            result[key] = merge(result[key] || {}, obj[key]);
          } else {
            result[key] = obj[key];
          }
        }
      }
    }
  }

  return result;
}

/**
 * Generates a unique identifier
 * @param {string} [prefix=''] - Optional prefix for the ID
 * @returns {string} Unique identifier
 */
export function generateId(prefix = '') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `${prefix}${timestamp}_${random}`;
}

/**
 * Safely parses JSON with error handling
 * @param {string} jsonString - JSON string to parse
 * @param {*} [defaultValue=null] - Default value if parsing fails
 * @returns {*} Parsed JSON or default value
 */
export function safeJsonParse(jsonString, defaultValue = null) {
  try {
    return JSON.parse(jsonString);
  } catch {
    return defaultValue;
  }
}

/**
 * Safely stringifies an object to JSON
 * @param {*} obj - Object to stringify
 * @param {string} [defaultValue='{}'] - Default value if stringify fails
 * @returns {string} JSON string or default value
 */
export function safeJsonStringify(obj, defaultValue = '{}') {
  try {
    return JSON.stringify(obj);
  } catch {
    return defaultValue;
  }
}

/**
 * Checks if code is running in browser environment
 * @returns {boolean} True if running in browser
 */
export function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Waits for a specified amount of time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Promise that resolves after the specified time
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retries a function with exponential backoff
 * @param {function} fn - Function to retry
 * @param {number} [maxAttempts=3] - Maximum number of attempts
 * @param {number} [baseDelay=1000] - Base delay in milliseconds
 * @returns {Promise} Promise that resolves with the function result
 */
export async function retry(fn, maxAttempts = 3, baseDelay = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Creates a promise that rejects after a timeout
 * @param {Promise} promise - Promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [message='Operation timed out'] - Timeout error message
 * @returns {Promise} Promise that rejects if timeout is reached
 */
export function withTimeout(
  promise,
  timeoutMs,
  message = 'Operation timed out'
) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}
