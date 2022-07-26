// Copyright 2022 Joshua Honig. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

import { EventEmitter } from 'events';
import { IContext } from '@sabl/context';
import { promise, CallbackPromise, isCanceled } from './promise';

export interface AsyncFactory<T extends object> {
  /** Create a new item */
  create(): Promise<T>;

  /** Destroy an item */
  destroy(item: T): Promise<void>;

  /** Optional method to reset an item before reuse */
  reset?(item: T): void;
}

/** Options for managing the count and lifetime of pool items */
export interface PoolOptions {
  /**
   * The maximum total lifetime in milliseconds for an item. If
   * values is <= 0, items have indefinite lifetime
   */
  maxLifetime?: number;

  /**
   * The maximum time in milliseconds for an item to remain
   * idle. If values is <= 0, items may idle indefinitely
   */
  maxIdleTime?: number;

  /** The maximum count of items, both in use and idle */
  maxOpenCount?: number;

  /** The maximum count of items kept idle */
  maxIdleCount?: number;

  /** Whether items can be created in parallel */
  parallelCreate?: boolean;
}

/** Current statistics about an {@link AsyncPool} */
export interface PoolStats {
  // Settings

  /** The maximum count of items, both in use and idle */
  readonly maxOpenCount: number;

  /** The maximum lifetime in milliseconds for an item */
  readonly maxLifetime: number;

  /** The maximum time in milliseconds for an item to remain  */
  readonly maxIdleTime: number;

  /** The maximum count of items kept idle */
  readonly maxIdleCount: number;

  // Item counts

  /** Current number of items, both in use and idle */
  readonly count: number;

  /** Current number of items currently in use */
  readonly inUseCount: number;

  /** Current number of items currently idle */
  readonly idleCount: number;

  // Session stats

  /** Current number of requests currently waiting for an item */
  readonly waitCount: number;

  /**
   * Total time in milliseconds that all requests have waited
   * for items, for the entire lifetime of the pool. Does not
   * include items that are still waiting
   */
  readonly waitDuration: number;

  /** The total number of items destroyed due to maxIdleCount */
  readonly maxIdleClosed: number;

  /** The total number of items destroyed due to maxIdleTime */
  readonly maxIdleTimeClosed: number;

  /** The total number of items destroyed due to maxLifetime */
  readonly maxLifetimeClosed: number;
}

/** A pool of items with async, cancellable get */
export interface AsyncPool<T extends object> {
  /**
   * Request an item from the pool. Rejected if ctx
   * is canceled before an item becomes available.
   */
  get(ctx?: IContext): Promise<T>;

  /**
   * Release an item back to the pool.
   */
  release(item: T): void;

  /**
   * Gracefully the close pool. Destroys all idle items and
   * rejects any pending requests, but waits for in use
   * items to be released.
   */
  close(): Promise<void>;

  /**
   * Gracefully the close pool. Destroys all idle items and
   * rejects any pending requests, but waits for in use
   * items to be released. Also closes any in use items
   * using the provided function
   */
  close(fn: (item: T) => void): Promise<void>;

  /** Calculate the current stats for the pool */
  stats(): PoolStats;

  /** Update the options for the pool */
  setOptions(options: PoolOptions): void;
}

type FactoryEvent = 'create' | 'destroy' | 'reset';

/**
 * A constrained {@link EventEmitter} that supports
 * an `error` event.
 */
export interface FactoryErrorEmitter {
  on(type: 'error', fn: (action: FactoryEvent, err: unknown) => void): void;
  off(type: 'error', fn: (action: FactoryEvent, err: unknown) => void): void;
}

/**
 * Create a new {@link AsyncPool}. The returned pool
 * will also emit an `error` event for any errors encountered
 * when attempting to `create` or `destroy` an item using
 * the provided factory.
 */
export function createPool<T extends object>(
  factory: AsyncFactory<T>,
  options?: PoolOptions
): AsyncPool<T> & FactoryErrorEmitter {
  return new Pool(factory, options);
}

export class PoolError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export const MAX_CREATE_FAILURES = 10;

/**
 * Internal options bundle that raises events
 * when any of its properties are changed. Allows
 * Pool to respond to changes in settings.
 */
class EmittingPoolOptions extends EventEmitter {
  #maxLifetime: number;
  #maxIdleTime: number;
  #maxOpenCount: number;
  #maxIdleCount: number;

  parallelCreate: boolean;

  constructor(...opts: (PoolOptions | undefined)[]) {
    super();
    const resolved = Object.assign(
      {
        maxIdleCount: -1,
        maxIdleTime: -1,
        maxLifetime: -1,
        maxOpenCount: -1,
      },
      ...opts.filter((n) => n != null)
    );
    this.#maxLifetime = resolved.maxLifetime;
    this.#maxIdleTime = resolved.maxIdleTime;
    this.#maxOpenCount = resolved.maxOpenCount;
    this.#maxIdleCount = resolved.maxIdleCount;
    this.parallelCreate = resolved.parallelCreate !== false;
  }

  get maxLifetime(): number {
    return this.#maxLifetime;
  }

  set maxLifetime(value: number) {
    if (value == this.#maxLifetime) return;

    this.#maxLifetime = value;
    this.emit('maxLifetime', value);
  }

  get maxIdleTime(): number {
    return this.#maxIdleTime;
  }

  set maxIdleTime(value: number) {
    if (value == this.#maxIdleTime) return;

    this.#maxIdleTime = value;
    this.emit('maxIdleTime', value);
  }

  get maxOpenCount(): number {
    return this.#maxOpenCount;
  }

  set maxOpenCount(value: number) {
    if (value == this.#maxOpenCount) return;

    this.#maxOpenCount = value;
    this.emit('maxOpenCount', value);
  }

  get maxIdleCount(): number {
    return this.#maxIdleCount;
  }

  set maxIdleCount(value: number) {
    if (value == this.#maxIdleCount) return;

    this.#maxIdleCount = value;
    this.emit('maxIdleCount', value);
  }
}

interface PoolElement<T> {
  item: T;
  created: Date;
  idled: Date | null;
}

const SymPoolElement = Symbol('PoolElement');

type DecoratedItem<T> = T & {
  [SymPoolElement]: PoolElement<T>;
};

function setElement<T>(item: T, element: PoolElement<T>): void {
  const decorated = <DecoratedItem<T>>(<unknown>item);
  decorated[SymPoolElement] = element;
}

function getElement<T>(item: T | DecoratedItem<T>): PoolElement<T> {
  const decorated = <DecoratedItem<T>>(<unknown>item);
  return decorated[SymPoolElement];
}

/** Get the number of milliseconds elapsed since the provided date */
function sinceMs(time: Date): number {
  const then = +time;
  const now = +new Date();
  return now - then;
}

/** A generic implementation of an asynchronous, concurrent pool of items */
class Pool<T extends object>
  extends EventEmitter
  implements AsyncPool<T>, FactoryErrorEmitter
{
  readonly #factory: AsyncFactory<T>;
  readonly #active: PoolElement<T>[] = [];
  readonly #pool: PoolElement<T>[] = [];
  readonly #queue: CallbackPromise<T>[] = [];
  readonly #options: EmittingPoolOptions;

  /**
   * Total time in milliseconds that all requests have waited
   * for items, for the entire lifetime of the pool. Does not
   * include items that are still waiting
   */
  #waitDuration = 0;

  /** The total number of items destroyed due to maxIdleCount */
  #maxIdleClosed = 0;

  /** The total number of items destroyed due to maxIdleTime */
  #maxIdleTimeClosed = 0;

  /** The total number of items destroyed due to maxLifetime */
  #maxLifetimeClosed = 0;

  #growing = false;
  #closing = false;
  #closed = false;
  #waitClose: CallbackPromise<void> | null = null;
  #sweepTimeout: null | { timeout: NodeJS.Timeout; deadline: Date } = null;

  // Number of items that are currently being destroyed by the factory
  #destroying = 0;

  // Number of items that are currently being created by the factory
  #creating = 0;

  // Number of consecutive times
  #createFailures = 0;

  constructor(factory: AsyncFactory<T>, options?: PoolOptions) {
    super();
    this.#factory = factory;
    const opts = (this.#options = new EmittingPoolOptions(options));
    opts.on('maxLifetime', this.#onMaxLifetime.bind(this));
    opts.on('maxIdleTime', this.#onMaxIdleTime.bind(this));
    opts.on('maxOpenCount', this.#onMaxOpenCount.bind(this));
    opts.on('maxIdleCount', this.#onMaxIdleCount.bind(this));
  }

  stats(): PoolStats {
    return {
      maxOpenCount: this.#options.maxOpenCount,
      maxLifetime: this.#options.maxLifetime,
      maxIdleTime: this.#options.maxIdleTime,
      maxIdleCount: this.#options.maxIdleCount,
      count: this.#pool.length + this.#active.length,
      inUseCount: this.#active.length,
      idleCount: this.#pool.length,

      waitCount: this.#queue.length,
      waitDuration: this.#waitDuration,
      maxIdleClosed: this.#maxIdleClosed,
      maxIdleTimeClosed: this.#maxIdleTimeClosed,
      maxLifetimeClosed: this.#maxLifetimeClosed,
    };
  }

  readonly #err = {
    closing() {
      return new PoolError('Pool is closing');
    },
    closed() {
      return new PoolError('Pool is closed');
    },
    canceled() {
      return new PoolError('Request was canceled before an item was available');
    },
  };

  #checkStatus() {
    if (this.#closed) {
      throw this.#err.closed();
    } else if (this.#closing) {
      throw this.#err.closing();
    }
  }

  setOptions(options: PoolOptions): void {
    this.#checkStatus();
    Object.assign(this.#options, options);
  }

  get(ctx?: IContext): Promise<T> {
    this.#checkStatus();
    const clr = ctx?.canceler;

    // Immediate reject: Context already canceled
    if (clr != null && clr.canceled) {
      return Promise.reject(this.#err.canceled());
    }

    // Immediate resolve: Existing idle
    while (this.#pool.length > 0) {
      // Intentionally *pop*ing: LIFO. Reusing most recently closed item
      const el = this.#pool.pop()!;

      // if (this.#isExpired(el)) {
      //   this.#destroy(el.item); // Do not await
      //   continue;
      // }

      el.idled = null;
      return Promise.resolve(el.item);
    }

    // Enqueue the request
    const queue = this.#queue;
    const handle = promise<T>(ctx!, this.#err.canceled);
    queue.push(handle);

    const wrapped = handle.catch((reason) => {
      if (isCanceled(reason)) {
        // If the request was canceled,
        // remove the request from the queue
        queue.splice(queue.indexOf(handle), 1);
      }
      throw reason;
    });

    // Trigger a spawn to create a new item if possible. Do not await
    this.#grow();

    return wrapped;
  }

  release(item: T): void {
    const el = getElement(item);
    const ix = this.#active.indexOf(el);
    if (ix < 0) {
      // Unrecognized item. Destroy and return
      this.#destroy(item);
      return;
    }

    // Remove from active list
    this.#active.splice(ix, 1);

    if (this.#factory.reset != null) {
      try {
        this.#factory.reset(el.item);
      } catch (e) {
        // Failed to reset. Emit error and destroy the item
        this.#error('reset', e);
        this.#destroy(el.item);
        return;
      }
    }

    this.#available(el);
  }

  close(fn?: (item: T) => void): Promise<void> {
    if (this.#closed) {
      // Close is complete
      return Promise.resolve();
    }

    if (this.#closing) {
      // Already started closing.
      // Compiler cannot determine it,
      // but #waitClosed will always be non-null
      // if this code block is reached
      return this.#waitClose!;
    }

    this.#closing = true;
    const p = (this.#waitClose = promise<void>());

    // Clear any outstanding sweep timeout
    this.#clearSweep();

    // Start closing process concurrently
    this.#processClose(fn);

    // Return the promise
    return p;
  }

  async #grow(): Promise<void> {
    if (this.#growing) {
      return;
    }
    this.#growing = true;

    const queue = this.#queue;
    const active = this.#active;
    const maxOpenCount = this.#options.maxOpenCount;

    if (maxOpenCount > 0 && active.length >= maxOpenCount) {
      // Already max amount of open items. Don't make new items
      this.#growing = false;
      return;
    }

    let needed = queue.length;
    if (maxOpenCount > 0) {
      const allowed = maxOpenCount - active.length;
      needed = Math.min(needed, allowed);
    }

    // Subtract the number of items that
    // are already being created
    needed -= this.#creating;

    for (let i = 0; i < needed; i++) {
      const promise = this.#create();

      if (this.#options.parallelCreate === false) {
        // Do not create multiple items concurrently.
        // Wait for this item to complete
        await promise;

        // Break so that counts will be recalculated
        // since we have awaited an unknown amount of time
        break;
      }
    }

    this.#growing = false;
    if (!this.#closed && !this.#closing) {
      if (queue.length > 0 && this.#creating == 0) {
        setTimeout(() => this.#grow(), 0);
      }
    }
    this.#flush();
  }

  async #create(): Promise<void> {
    this.#creating++;
    let item: T;
    try {
      item = await this.#factory.create();
      this.#createFailures = 0;
    } catch (e) {
      this.#error('create', e);
      this.#createFailures++;
      if (this.#createFailures >= MAX_CREATE_FAILURES) {
        this.close();
      }
      return;
    } finally {
      this.#creating--;
    }

    this.#created(item!);
  }

  // Handle a new item that was created
  #created(item: T): void {
    if (this.#closed || this.#closing) {
      this.#destroy(item);
      return;
    }

    const el: PoolElement<T> = {
      item,
      created: new Date(),
      idled: null,
    };
    setElement(item, el);

    this.#available(el);
  }

  // Handle an item that is now available
  async #available(el: PoolElement<T>): Promise<void> {
    const pool = this.#pool;
    const active = this.#active;
    const queue = this.#queue;

    let canUse = true;
    const maxOpenCount = this.#options.maxOpenCount;
    const tot = active.length + pool.length;

    // Step 1: Destroy even if requests are waiting
    if (this.#closing) {
      // Pool is closing. Need to destroy even
      // if a request is waiting
      canUse = false;
    } else if (this.#isExpired(el)) {
      // Item has expired. Need to destroy even
      // if a request is waiting
      canUse = false;
    } else if (maxOpenCount > 0 && tot >= maxOpenCount) {
      // Excess item, need to destroy even
      // if a request is waiting

      // Account for as maxIdleClosed
      this.#maxIdleClosed++;
      canUse = false;
    }

    if (!canUse) {
      return this.#destroy(el.item);
    }

    // Step 2: Fulfill next request
    const req = queue.shift();
    if (req != null) {
      active.push(el);
      req.resolve(el.item);
      return;
    }

    // Step 3: Add to pool
    let canPool = true;
    if (this.#options.maxIdleCount > 0) {
      if (pool.length >= this.#options.maxIdleCount) {
        canPool = false;
      }
    }

    if (!canPool) {
      // Just have to destroy the item.
      this.#maxIdleClosed++;
      return this.#destroy(el.item);
    }

    // Add the item to the pool
    el.idled = new Date();
    pool.push(el);

    // Schedule a sweep for expired idling items
    const ttl = this.#ttl(el);
    if (ttl != null) {
      this.#pushSweep(ttl);
    }
  }

  /** Destroy an item */
  async #destroy(item: T): Promise<void> {
    this.#destroying++;
    try {
      await this.#factory.destroy(item);
    } catch (e) {
      this.#error('destroy', e);
    } finally {
      this.#destroying--;
      if (this.#destroying == 0) {
        this.#flush();
      }
    }
  }

  /** Sweep idle connections for timeout */
  #sweep() {
    let ttl = 600_000;
    const pool = this.#pool;
    for (let i = pool.length - 1; i >= 0; i--) {
      const el = pool[i];
      if (this.#isExpired(el)) {
        pool.splice(i, 1);
        this.#destroy(el.item);
      } else {
        const itemTtl = this.#ttl(el);
        if (itemTtl != null) {
          ttl = Math.min(ttl, itemTtl);
        }
      }
    }

    if (pool.length > 0) {
      this.#pushSweep(ttl);
    }
  }

  /**
   * Check if the element is expired, either due to
   * total lifetime or idle time. If it is, return
   * true *and* increment the applicable counter
   */
  #isExpired(el: PoolElement<T>): boolean {
    if (this.#options.maxLifetime > 0) {
      const lifetime = sinceMs(el.created);
      if (lifetime > this.#options.maxLifetime) {
        this.#maxLifetimeClosed++;
        return true;
      }
    }

    if (this.#options.maxIdleTime > 0 && el.idled != null) {
      const idled = sinceMs(el.idled);
      if (idled > this.#options.maxIdleTime) {
        this.#maxIdleTimeClosed++;
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate the max remaining life in milliseconds of the
   * element, based on maxLifetime and maxIdletime. Returns
   * null if there is no deadline.
   */
  #ttl(el: PoolElement<T>): number | null {
    let remLifetime = -1;
    let remIdletime = -1;

    if (this.#options.maxLifetime > 0) {
      const lifetime = sinceMs(el.created);
      remLifetime = this.#options.maxLifetime - lifetime;
    }

    if (this.#options.maxIdleTime > 0 && el.idled != null) {
      const idled = sinceMs(el.idled);
      remIdletime = this.#options.maxIdleTime - idled;
    }

    if (remLifetime < 0 && remIdletime < 0) {
      return null;
    } else if (remLifetime < 0) {
      return remIdletime;
    } else if (remIdletime < 0) {
      return remLifetime;
    } else {
      return Math.min(remLifetime, remIdletime);
    }
  }

  #error(action: FactoryEvent, reason: Error | unknown): void {
    this.emit('error', action, reason);
  }

  /**
   * Schedule a sweep after ttl seconds. If there is already
   * a scheduled sweep, determine if new ttl is sooner
   */
  #pushSweep(ttl: number): void {
    const deadline = new Date(+new Date() + ttl);
    if (this.#sweepTimeout != null) {
      if (this.#sweepTimeout.deadline < deadline) {
        // Existing deadline is already sooner
        return;
      } else {
        // Clear the existing timeout
        clearTimeout(this.#sweepTimeout.timeout);
      }
    }

    const sweep = () => {
      this.#sweepTimeout = null;
      this.#sweep();
    };

    this.#sweepTimeout = {
      deadline,
      timeout: setTimeout(sweep, ttl),
    };
  }

  #clearSweep() {
    if (this.#sweepTimeout != null) {
      clearTimeout(this.#sweepTimeout.timeout);
      this.#sweepTimeout = null;
    }
  }

  #processClose(fn?: (item: T) => void): void {
    const queue = this.#queue;
    while (queue.length > 0) {
      // Reject all requests
      const req = queue.pop()!;
      req.reject(this.#err.closing());
    }

    const pool = this.#pool;
    while (pool.length > 0) {
      // Destroy all idle items
      this.#destroy(pool.pop()!.item);
    }

    const active = this.#active;
    if (active.length > 0) {
      if (fn != null) {
        // Actively close all active items
        while (active.length > 0) {
          fn(active.pop()!.item);
        }
      }
    }

    this.#flush();
  }

  /**
   * If pool is closing, check to see if
   * all resources have been cleaned up
   */
  #flush() {
    if (!this.#closing) return;

    if (this.#destroying > 0) return;
    if (this.#creating > 0) return;
    if (this.#active.length > 0) return;

    // if (this.#queue.length > 0) return;  // logically unreachable
    // if (this.#pool.length > 0) return;   // logically unreachable

    // Close process complete.
    this.#closed = true;

    const wc = this.#waitClose;
    if (wc != null) {
      this.#waitClose = null;
      wc.resolve();
    }
  }

  #onMaxLifetime(value: number) {
    if (value === 0) {
      throw new PoolError('maxLifetime cannot be 0');
    }
    if (value <= 0) {
      if (this.#options.maxIdleTime < 0) {
        this.#clearSweep();
      }
      return;
    }

    const pool = this.#pool;
    if (pool.length == 0) return;

    // Immediately sweep for expired idled items
    this.#pushSweep(0);
  }

  #onMaxIdleTime(value: number) {
    if (value === 0) {
      throw new PoolError('maxIdleTime cannot be 0');
    }
    if (value <= 0) {
      if (this.#options.maxLifetime < 0) {
        this.#clearSweep();
      }
      return;
    }

    const pool = this.#pool;
    if (pool.length == 0) return;

    // Immediately sweep for expired idled items
    this.#pushSweep(0);
  }

  #onMaxOpenCount(value: number) {
    if (value === 0) {
      throw new PoolError('maxOpenCount cannot be 0');
    }

    // Step 1: Rerun grow in case we can add items now
    if (this.#queue.length > 0) {
      this.#grow(); // do not await
    }

    // Step 2: Check if we need to trim the pool

    // New max count is unlimited, no need to trim
    if (value <= 0) return;

    const pCount = this.#pool.length;

    // Nothing in pool. Can't trim
    if (pCount == 0) return;

    const aCount = this.#active.length;

    // Less than or equal to allowed count
    if (pCount + aCount <= value) return;

    // Too many open connections, and some are just idle. Kill
    // any idle ones as needed and possible
    while (this.#pool.length > 0 && aCount + this.#pool.length > value) {
      // Retire the oldest items
      const el = this.#pool.shift()!;
      this.#maxIdleClosed++;
      this.#destroy(el.item); // Do not await
    }
  }

  #onMaxIdleCount(value: number) {
    // New max idle count is unlimited, no need to trim
    if (value <= 0) return;

    // Less than or equal to allowed idle count
    if (this.#pool.length <= value) return;

    // Need to trim pool
    while (this.#pool.length > value) {
      // Retire the oldest items
      const el = this.#pool.shift()!;
      this.#maxIdleClosed++;
      this.#destroy(el.item); // Do not await
    }
  }
}
