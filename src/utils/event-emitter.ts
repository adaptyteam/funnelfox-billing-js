/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @fileoverview Lightweight event emitter for Funnefox SDK
 */

// Default event map type - can be extended by users
type DefaultEventMap = Record<string, any[] | any>;

// Event handler function type
type EventHandler<
  TEventMap extends DefaultEventMap,
  K extends keyof TEventMap,
> = TEventMap[K] extends any[]
  ? (...args: TEventMap[K]) => void
  : TEventMap[K] extends void
    ? () => void
    : (...args: [TEventMap[K]]) => void;

class EventEmitter<TEventMap extends DefaultEventMap = DefaultEventMap> {
  private _events: Map<string, Function[]>;

  constructor() {
    this._events = new Map();
  }

  on<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap, K>
  ): this {
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }
    if (!this._events.has(eventName as string)) {
      this._events.set(eventName as string, []);
    }
    this._events.get(eventName as string)!.push(handler);
    return this;
  }

  once<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap, K>
  ): this {
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }
    const onceWrapper = (...args: Parameters<EventHandler<TEventMap, K>>) => {
      this.off(eventName, onceWrapper as EventHandler<TEventMap, K>);
      handler.apply(this, args);
    };
    return this.on(eventName, onceWrapper as EventHandler<TEventMap, K>);
  }

  off<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap, K> | null = null
  ): this {
    if (!this._events.has(eventName as string)) {
      return this;
    }
    if (handler === null) {
      this._events.delete(eventName as string);
      return this;
    }
    const handlers = this._events.get(eventName as string)!;
    const index = handlers.indexOf(handler as any);
    if (index !== -1) {
      handlers.splice(index, 1);
      if (handlers.length === 0) {
        this._events.delete(eventName as string);
      }
    }
    return this;
  }

  emit<K extends keyof TEventMap>(
    eventName: K,
    ...args: Parameters<EventHandler<TEventMap, K>>
  ): boolean {
    if (!this._events.has(eventName as string)) {
      return false;
    }
    const handlers = this._events.get(eventName as string)!.slice();
    for (const handler of handlers) {
      try {
        handler.apply(this, args);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          `Error in event handler for "${String(eventName)}":`,
          error
        );
      }
    }
    return true;
  }

  listenerCount<K extends keyof TEventMap>(eventName: K): number {
    return this._events.has(eventName as string)
      ? this._events.get(eventName as string)!.length
      : 0;
  }

  eventNames(): (keyof TEventMap)[] {
    return Array.from(this._events.keys()) as (keyof TEventMap)[];
  }

  removeAllListeners(): this {
    this._events.clear();
    return this;
  }

  listeners<K extends keyof TEventMap>(
    eventName: K
  ): EventHandler<TEventMap, K>[] {
    return this._events.has(eventName as string)
      ? (this._events.get(eventName as string)!.slice() as EventHandler<
          TEventMap,
          K
        >[])
      : [];
  }
}

export default EventEmitter;
export type { DefaultEventMap, EventHandler };
