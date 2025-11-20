/**
 * @fileoverview Lightweight event emitter for Funnefox SDK
 */

class EventEmitter {
  private _events: Map<string, Function[]>;

  constructor() {
    this._events = new Map();
  }

  on(eventName: string, handler: Function): this {
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }
    if (!this._events.has(eventName)) {
      this._events.set(eventName, []);
    }
    this._events.get(eventName)!.push(handler);
    return this;
  }

  once(eventName: string, handler: Function): this {
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }
    const onceWrapper = (...args: any[]) => {
      this.off(eventName, onceWrapper);
      (handler as any).apply(this, args);
    };
    return this.on(eventName, onceWrapper);
  }

  off(eventName: string, handler: Function | null = null): this {
    if (!this._events.has(eventName)) {
      return this;
    }
    if (handler === null) {
      this._events.delete(eventName);
      return this;
    }
    const handlers = this._events.get(eventName)!;
    const index = handlers.indexOf(handler as any);
    if (index !== -1) {
      handlers.splice(index, 1);
      if (handlers.length === 0) {
        this._events.delete(eventName);
      }
    }
    return this;
  }

  emit(eventName: string, ...args: any[]): boolean {
    if (!this._events.has(eventName)) {
      return false;
    }
    const handlers = this._events.get(eventName)!.slice();
    for (const handler of handlers) {
      try {
        (handler as any).apply(this, args);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(`Error in event handler for "${eventName}":`, error);
      }
    }
    return true;
  }

  listenerCount(eventName: string): number {
    return this._events.has(eventName)
      ? this._events.get(eventName)!.length
      : 0;
  }

  eventNames(): string[] {
    return Array.from(this._events.keys());
  }

  removeAllListeners(): this {
    this._events.clear();
    return this;
  }

  listeners(eventName: string): Function[] {
    return this._events.has(eventName)
      ? this._events.get(eventName)!.slice()
      : [];
  }
}

export default EventEmitter;
