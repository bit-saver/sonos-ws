import { EventEmitter } from 'node:events';

/**
 * Type-safe wrapper around the Node.js {@link EventEmitter}.
 *
 * The generic parameter `T` should be an interface mapping event names
 * to their listener signatures. This ensures that `on`, `once`, `off`,
 * and `emit` calls are type-checked at compile time.
 *
 * @typeParam T - An interface whose keys are event names and values are listener function signatures.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEventEmitter<T> {
  private readonly emitter = new EventEmitter();

  /**
   * Register a listener for the given event. The listener is called every time the event fires.
   *
   * @param event - The event name to listen for.
   * @param listener - The callback to invoke when the event is emitted.
   * @returns This instance, for chaining.
   */
  on<K extends string & keyof T>(
    event: K,
    listener: T[K] extends (...args: infer A) => void ? (...args: A) => void : never,
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.emitter.on(event, listener as any);
    return this;
  }

  /**
   * Register a one-time listener for the given event. The listener is removed after it fires once.
   *
   * @param event - The event name to listen for.
   * @param listener - The callback to invoke once when the event is emitted.
   * @returns This instance, for chaining.
   */
  once<K extends string & keyof T>(
    event: K,
    listener: T[K] extends (...args: infer A) => void ? (...args: A) => void : never,
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.emitter.once(event, listener as any);
    return this;
  }

  /**
   * Remove a previously registered listener for the given event.
   *
   * @param event - The event name the listener was registered for.
   * @param listener - The callback to remove.
   * @returns This instance, for chaining.
   */
  off<K extends string & keyof T>(
    event: K,
    listener: T[K] extends (...args: infer A) => void ? (...args: A) => void : never,
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.emitter.off(event, listener as any);
    return this;
  }

  /**
   * Remove all listeners, optionally for a specific event only.
   *
   * @param event - If provided, only listeners for this event are removed. Otherwise, all listeners for all events are removed.
   * @returns This instance, for chaining.
   */
  removeAllListeners<K extends string & keyof T>(event?: K): this {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
    return this;
  }

  /**
   * Emit an event, invoking all registered listeners with the provided arguments.
   *
   * @param event - The event name to emit.
   * @param args - Arguments to pass to the listeners.
   * @returns `true` if the event had listeners, `false` otherwise.
   */
  protected emit<K extends string & keyof T>(
    event: K,
    ...args: T[K] extends (...args: infer A) => void ? A : never
  ): boolean {
    return this.emitter.emit(event, ...args);
  }

  /**
   * Get the number of listeners currently registered for the given event.
   *
   * @param event - The event name to query.
   * @returns The number of registered listeners.
   */
  listenerCount<K extends string & keyof T>(event: K): number {
    return this.emitter.listenerCount(event);
  }
}
