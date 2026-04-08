import { EventEmitter } from 'node:events';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEventEmitter<T> {
  private readonly emitter = new EventEmitter();

  on<K extends string & keyof T>(
    event: K,
    listener: T[K] extends (...args: infer A) => void ? (...args: A) => void : never,
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.emitter.on(event, listener as any);
    return this;
  }

  once<K extends string & keyof T>(
    event: K,
    listener: T[K] extends (...args: infer A) => void ? (...args: A) => void : never,
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.emitter.once(event, listener as any);
    return this;
  }

  off<K extends string & keyof T>(
    event: K,
    listener: T[K] extends (...args: infer A) => void ? (...args: A) => void : never,
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.emitter.off(event, listener as any);
    return this;
  }

  removeAllListeners<K extends string & keyof T>(event?: K): this {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
    return this;
  }

  protected emit<K extends string & keyof T>(
    event: K,
    ...args: T[K] extends (...args: infer A) => void ? A : never
  ): boolean {
    return this.emitter.emit(event, ...args);
  }

  listenerCount<K extends string & keyof T>(event: K): number {
    return this.emitter.listenerCount(event);
  }
}
