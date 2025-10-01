/**
 * @fileoverview Lightweight event emitter for Funnefox SDK
 */

/**
 * Simple event emitter for checkout instances
 */
class EventEmitter {
  constructor() {
    this._events = new Map();
  }

  /**
   * Add an event listener
   * @param {string} eventName - Name of the event
   * @param {function} handler - Event handler function
   * @returns {EventEmitter} Returns this for chaining
   */
  on(eventName, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }

    if (!this._events.has(eventName)) {
      this._events.set(eventName, []);
    }

    this._events.get(eventName).push(handler);
    return this;
  }

  /**
   * Add a one-time event listener
   * @param {string} eventName - Name of the event
   * @param {function} handler - Event handler function
   * @returns {EventEmitter} Returns this for chaining
   */
  once(eventName, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }

    const onceWrapper = (...args) => {
      this.off(eventName, onceWrapper);
      handler.apply(this, args);
    };

    return this.on(eventName, onceWrapper);
  }

  /**
   * Remove an event listener
   * @param {string} eventName - Name of the event
   * @param {function} [handler] - Specific handler to remove. If not provided, removes all handlers for the event
   * @returns {EventEmitter} Returns this for chaining
   */
  off(eventName, handler = null) {
    if (!this._events.has(eventName)) {
      return this;
    }

    if (handler === null) {
      this._events.delete(eventName);
      return this;
    }

    const handlers = this._events.get(eventName);
    const index = handlers.indexOf(handler);

    if (index !== -1) {
      handlers.splice(index, 1);

      if (handlers.length === 0) {
        this._events.delete(eventName);
      }
    }

    return this;
  }

  /**
   * Emit an event to all registered handlers
   * @param {string} eventName - Name of the event to emit
   * @param {...*} args - Arguments to pass to event handlers
   * @returns {boolean} Returns true if event had listeners, false otherwise
   */
  emit(eventName, ...args) {
    if (!this._events.has(eventName)) {
      return false;
    }

    const handlers = this._events.get(eventName).slice();

    for (const handler of handlers) {
      try {
        handler.apply(this, args);
      } catch (error) {
        // Don't let handler errors break the emission chain
        console.warn(`Error in event handler for "${eventName}":`, error);
      }
    }

    return true;
  }

  /**
   * Get the number of listeners for an event
   * @param {string} eventName - Name of the event
   * @returns {number} Number of listeners
   */
  listenerCount(eventName) {
    return this._events.has(eventName) ? this._events.get(eventName).length : 0;
  }

  /**
   * Get all event names that have listeners
   * @returns {string[]} Array of event names
   */
  eventNames() {
    return Array.from(this._events.keys());
  }

  /**
   * Remove all listeners for all events
   * @returns {EventEmitter} Returns this for chaining
   */
  removeAllListeners() {
    this._events.clear();
    return this;
  }

  /**
   * Get all listeners for an event
   * @param {string} eventName - Name of the event
   * @returns {function[]} Array of handler functions
   */
  listeners(eventName) {
    return this._events.has(eventName)
      ? this._events.get(eventName).slice()
      : [];
  }
}

export default EventEmitter;
