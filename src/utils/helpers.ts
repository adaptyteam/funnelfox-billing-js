/**
 * @fileoverview Helper utilities for Funnefox SDK
 */

export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
) {
  let timeout: any;
  return function executedFunction(this: any, ...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func.apply(this, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as any;
  if (obj instanceof Array) return (obj as any).map(deepClone);
  if (typeof obj === 'object') {
    const cloned: any = {};
    for (const key in obj as any) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = deepClone((obj as any)[key]);
      }
    }
    return cloned;
  }
  return obj as any;
}

export function merge<T extends object>(...objects: Array<Partial<T>>): T {
  const result: any = {};
  for (const obj of objects) {
    if (obj && typeof obj === 'object') {
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          if (
            typeof obj[key] === 'object' &&
            !Array.isArray(obj[key]) &&
            obj[key] !== null
          ) {
            result[key] = merge(result[key] || {}, obj[key] as any);
          } else {
            result[key] = obj[key];
          }
        }
      }
    }
  }
  return result as T;
}

export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `${prefix}${timestamp}_${random}`;
}

export function safeJsonParse<T = any>(
  jsonString: string,
  defaultValue: T | null = null
): T | null {
  try {
    return JSON.parse(jsonString) as T;
  } catch {
    return defaultValue;
  }
}

export function safeJsonStringify(
  obj: any,
  defaultValue: string = '{}'
): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return defaultValue;
  }
}

export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw lastError;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  throw lastError;
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string = 'Operation timed out'
): Promise<T> {
  const timeoutPromise = new Promise<T>((_, reject) => {
    setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]) as Promise<T>;
}
