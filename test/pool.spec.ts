// Copyright 2022 Joshua Honig. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { later, limit, wait } from '$';
import { AsyncFactory, createPool } from '$/pool';
import { Context } from '@sabl/context';

class Counter {
  destroyed = false;

  constructor(readonly id: number) {}

  #cnt = 0;
  inc() {
    return this.#cnt++;
  }
  dec() {
    return this.#cnt--;
  }
  get value() {
    return this.#cnt;
  }
}

let factoryId = 0;
let counterId = 0;

class CounterFactory implements AsyncFactory<Counter> {
  created = 0;
  destroyed = 0;

  readonly delay: number;
  readonly id = ++factoryId;
  readonly debug: boolean;
  readonly failCount: number;
  readonly destroyFail: boolean;

  #failCtr = 0;

  constructor(
    options: {
      delay?: number;
      debug?: boolean;
      failCount?: number;
      destroyFail?: boolean;
    } = {}
  ) {
    this.delay = options.delay || 2;
    this.debug = options.debug === true;
    this.failCount = options.failCount || 0;
    this.destroyFail = options.destroyFail === true;
  }

  create(): Promise<Counter> {
    return later<Counter>(() => {
      if (this.failCount > 0) {
        if (this.#failCtr == this.failCount) {
          this.#failCtr = 0;
        } else {
          this.#failCtr++;
          throw new Error(
            `Failing on purpose: failure ${this.#failCtr} of ${this.failCount}`
          );
        }
      }

      this.created++;
      const ctr = new Counter(++counterId);
      if (this.debug) {
        console.log(`ctr ${this.id}: create (${this.created}) id ${ctr.id}`);
      }
      return ctr;
    }, this.delay + 5 * Math.random());
  }

  destroy(item: Counter): Promise<void> {
    return later<void>(() => {
      if (this.destroyFail) {
        throw new Error(`Failing on purpose in destroy: id ${item.id}`);
      }
      this.destroyed++;
      if (this.debug) {
        console.log(
          `ctr ${this.id}: destroy (${this.destroyed}) id ${item.id}`
        );
      }
      item.destroyed = true;
    }, this.delay + 5 * Math.random());
  }
}

type ErrorInfo = {
  action: string;
  err: Error | unknown;
};

function lastErr(errs: ErrorInfo[]): Error {
  return <Error>(errs[0] || {}).err || {};
}

function lastAction(errs: ErrorInfo[]): string {
  return (errs[0] || {}).action;
}

describe('get', () => {
  it('gets an item', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);
    const item = await pool.get();
    expect(item.value).toBe(0);
  });

  it('awaits released item', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 1 });
    const item1 = await pool.get();

    const pItem2 = pool.get();

    wait(10);

    // Should be an item waiting
    const stats = pool.stats();
    expect(stats.waitCount).toBe(1);

    // Still hasn't created a second item
    expect(factory.created).toBe(1);

    // Now release item1 back to pool
    pool.release(item1);

    // Await second request to be fulfilled
    const item2 = await pItem2;

    // We should have got the same item
    expect(item2).toBe(item1);
  });

  it('gets idled item', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);
    const item1 = await pool.get();

    // Now release item1 back to pool
    pool.release(item1);

    // Should be an item in the pool
    const stats = pool.stats();
    expect(stats.idleCount).toBe(1);

    // Await second request to be fulfilled
    const item2 = await pool.get();

    // We should have got the same item
    expect(item2).toBe(item1);
  });

  it('rejects when context is canceled', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 1 });
    const item1 = await pool.get();

    const [ctx, cancel] = Context.cancel();

    const pItem2 = pool.get(ctx);

    // Should be an item waiting
    expect(pool.stats().waitCount).toBe(1);

    // Cancel in 5 ms
    setTimeout(cancel, 5);

    await expect(pItem2).rejects.toThrow(
      'canceled before an item was available'
    );

    // Should no longer be any waiting requests
    expect(pool.stats().waitCount).toBe(0);

    pool.release(item1);

    await pool.close();
  });

  it('rejects when context is already canceled', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 1 });
    const item1 = await pool.get();

    const [ctx, cancel] = Context.cancel();
    cancel();

    const pItem2 = pool.get(ctx);

    // Should NOT be an item waiting
    // because it was rejected without being queued
    expect(pool.stats().waitCount).toBe(0);

    await expect(pItem2).rejects.toThrow(
      'canceled before an item was available'
    );

    pool.release(item1);

    await pool.close();
  });

  it('throws if pool is closing', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 1 });
    const item1 = await pool.get();

    const pClose = pool.close();

    expect(() => pool.get()).toThrow('Pool is closing');

    // Should NOT be an item waiting
    expect(pool.stats().waitCount).toBe(0);

    pool.release(item1);

    await pClose;
  });

  it('throws if pool is closed', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);
    const pClose = pool.close();

    expect(() => pool.get()).toThrow('Pool is closed');

    // Should NOT be an item waiting
    expect(pool.stats().waitCount).toBe(0);

    await pClose;
  });
});

describe('release', () => {
  it('ignores and destroys unrecognized item', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);

    // Create an item outside the pool
    const item = await factory.create();

    pool.release(item);

    // Did NOT put item in the pool
    expect(pool.stats().idleCount).toBe(0);

    // Wait for background destroy to finish
    await wait(6);

    // Item WAS destroyed
    expect(item.destroyed).toBe(true);
    expect(factory.destroyed).toBe(1);
  });

  it('uses reset method', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);
    (<any>factory).reset = function (item: Counter) {
      (<any>item).wasReset = true;
    };

    const item = await pool.get();
    pool.release(item);

    // Reset method was invoked
    expect((<any>item).wasReset).toBe(true);

    // Item WAS added to pool
    expect(pool.stats().idleCount).toBe(1);
  });

  it('destroys if reset failed', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);
    (<any>factory).reset = function (item: Counter) {
      (<any>item).wasReset = true;
      throw new Error('Reset failure');
    };

    // jest requires that EventEmitter
    // 'error' events be handled!
    const errs: ErrorInfo[] = [];
    pool.on('error', (action, err) => {
      errs.push({ action, err });
    });

    const item = await pool.get();
    pool.release(item);

    // Reset method was invoked
    expect((<any>item).wasReset).toBe(true);

    // Item WAS NOT added to pool
    expect(pool.stats().idleCount).toBe(0);

    expect(lastErr(errs).message).toMatch('Reset failure');
    expect(lastAction(errs)).toEqual('reset');
  });

  it('puts item in pool', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);
    const item = await pool.get();
    pool.release(item);

    expect(pool.stats().idleCount).toBe(1);
  });

  it('gives item to next request', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 1 });
    const item = await pool.get();

    const req1 = pool.get();
    const req2 = pool.get();
    const req3 = pool.get();
    expect(pool.stats().waitCount).toBe(3);

    // Release
    pool.release(item);

    // Should resolve
    const item2 = await req1;
    expect(item2).toBe(item);
    expect(pool.stats().waitCount).toBe(2);

    // Release again
    pool.release(item2);

    const item3 = await req2;
    expect(item3).toBe(item);
    expect(pool.stats().waitCount).toBe(1);

    // Release again
    pool.release(item3);
    const item4 = await req3;
    expect(item4).toBe(item);
    expect(pool.stats().waitCount).toBe(0);
  });
});

describe('close', () => {
  it('returns the same pending promise while waiting', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);
    const item = await pool.get();

    const pClose1 = pool.close();
    const pClose2 = pool.close();

    expect(pClose1).toBe(pClose2);

    pool.release(item);

    // Now should resolve
    await pClose1;
    await pClose2;
  });

  it('clears sweep timeout', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxIdleTime: 600_000 });
    const item = await pool.get();

    pool.release(item);

    await wait(10);

    await pool.close();

    expect(pool.stats().idleCount).toBe(0);
  });

  it('returns immediately if already closed', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);
    await pool.close();

    const pCloseAgain = pool.close();

    // Prove pCloseAgain is already resolved
    await limit(pCloseAgain, 0);
  });

  it('rejects all pending requests', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 1 });
    const item = await pool.get();

    const req1 = pool.get();
    const req2 = pool.get();

    const tests = [
      expect(req1).rejects.toThrow('Pool is closing'),
      expect(req2).rejects.toThrow('Pool is closing'),
    ];

    const pClose = pool.close();

    await Promise.all(tests);

    pool.release(item);
    await pClose;
  });

  it('invokes close on all active items', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);

    const item1 = await pool.get();
    const item2 = await pool.get();
    const item3 = await pool.get();

    await pool.close((ctr) => {
      (<any>ctr).wasClosed = true;
      pool.release(ctr);
    });

    for (const item of [item1, item2, item3]) {
      expect(item.destroyed).toBe(true);
      expect((<any>item).wasClosed).toBe(true);
    }
  });

  it('destroys item created after close', async () => {
    const factory = new CounterFactory({ delay: 20 });
    const pool = createPool(factory);

    // No items created or destroyed yet
    expect(factory.created).toBe(0);
    expect(factory.destroyed).toBe(0);

    // Request item
    const pGet = pool.get();

    // Close the pool
    const pClose = pool.close();

    await expect(pGet).rejects.toThrow('Pool is closing');
    await pClose;

    // One item was created, and one
    // (the same item) was also destroyed
    expect(factory.created).toBe(1);
    expect(factory.destroyed).toBe(1);
  });
});

describe('#grow', () => {
  it('skips if growing already in progress', async () => {
    const factory = new CounterFactory({ delay: 20 });
    const pool = createPool(factory, {
      parallelCreate: false,
    });

    // Ask for item
    const req1 = pool.get();

    await wait(2);

    // This should trigger #grow, which will
    // exit because #growing is still true
    // while it waits for the first request to resolve
    const req2 = pool.get();

    await wait(2);

    const pClose = pool.close();

    await Promise.all([
      expect(req1).rejects.toThrow('Pool is closing'),
      expect(req2).rejects.toThrow('Pool is closing'),
      pClose,
    ]);
  });

  it('retries on error', async () => {
    const factory = new CounterFactory({ delay: 2, failCount: 1 });
    const pool = createPool(factory, {
      parallelCreate: false,
    });

    const errs: ErrorInfo[] = [];
    pool.on('error', (action, err) => {
      errs.push({ action, err });
    });

    // Ask for item
    const item = await pool.get();
    expect(item.id).toBeGreaterThan(0);

    pool.release(item);

    await pool.close();

    expect(lastErr(errs).message).toMatch('Failing on purpose: failure 1 of 1');
    expect(lastAction(errs)).toEqual('create');
  });

  it('does not retry if already closing', async () => {
    const factory = new CounterFactory({ delay: 10, failCount: 1 });
    const pool = createPool(factory, {
      parallelCreate: false,
    });

    const errs: ErrorInfo[] = [];
    pool.on('error', (action, err) => {
      errs.push({ action, err });
    });

    // Ask for item
    const req1 = pool.get();

    await wait(2);

    const pClose = pool.close();

    await Promise.all([
      expect(req1).rejects.toThrow('Pool is closing'),
      pClose,
    ]);

    expect(lastErr(errs).message).toMatch('Failing on purpose: failure 1 of 1');
    expect(lastAction(errs)).toEqual('create');
  });

  it('does not retry if request canceled', async () => {
    const factory = new CounterFactory({ delay: 5, failCount: 1 });
    const pool = createPool(factory, {
      parallelCreate: false,
    });

    const [ctx, cancel] = Context.cancel();

    const errs: ErrorInfo[] = [];
    pool.on('error', (action, err) => {
      errs.push({ action, err });
    });

    // Ask for item
    const req1 = pool.get(ctx);
    const reqTest = expect(req1).rejects.toThrow('canceled');

    await wait(2);

    cancel();

    await wait(10);

    const pClose = pool.close();

    await Promise.all([reqTest, pClose]);

    expect(lastErr(errs).message).toMatch('Failing on purpose: failure 1 of 1');
    expect(lastAction(errs)).toEqual('create');
  });
});

describe('#destroy', () => {
  it('emits destroy errors', async () => {
    const factory = new CounterFactory({ destroyFail: true });
    const pool = createPool(factory, {
      parallelCreate: false,
    });

    const errs: ErrorInfo[] = [];
    pool.on('error', (action, err) => {
      errs.push({ action, err });
    });

    // Ask for item
    const item = await pool.get();

    expect(item.id).toBeGreaterThan(0);

    pool.release(item);

    await pool.close();

    expect(lastErr(errs).message).toMatch('Failing on purpose in destroy');
    expect(lastAction(errs)).toEqual('destroy');
  });
});

describe('maxLifetime', () => {
  it('prohibits 0 value', () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);
    expect(() => pool.setOptions({ maxLifetime: 0 })).toThrow(
      'maxLifetime cannot be 0'
    );
  });

  it('ignores set to same value', async () => {
    // Ensures coverage of short-circuit in EmittingPoolOptions
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxLifetime: 2 });
    pool.setOptions({ maxLifetime: 2 });
    await expect(pool.close()).resolves.toBe(undefined);
  });

  it('destroys on release if item is expired', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, {
      maxLifetime: 10,
      maxIdleCount: 2,
    });

    const item = await pool.get();

    await wait(15);

    pool.release(item);
    const stats = pool.stats();
    expect(stats.idleCount).toBe(0);
    expect(stats.maxLifetimeClosed).toBe(1);
  });

  it('auto sweeps item when item expires - lifetime', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, {
      maxLifetime: 10,
      maxIdleCount: 2,
    });

    const item = await pool.get();

    pool.release(item);
    let stats = pool.stats();
    expect(stats.idleCount).toBe(1);
    expect(stats.maxLifetimeClosed).toBe(0);

    await wait(15);

    stats = pool.stats();
    expect(stats.idleCount).toBe(0);
    expect(stats.maxLifetimeClosed).toBe(1);
  });

  it('sweeps pool when maxLifetime is changed', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, {
      maxLifetime: 600_000,
      maxIdleCount: 2,
    });

    const item = await pool.get();

    pool.release(item);
    let stats = pool.stats();
    expect(stats.idleCount).toBe(1);
    expect(stats.maxLifetimeClosed).toBe(0);

    // Allow initial sweep to schedule
    await wait(10);

    pool.setOptions({ maxLifetime: 10 });

    // Allow sweep to execute
    await wait(10);

    stats = pool.stats();
    expect(stats.idleCount).toBe(0);
    expect(stats.maxLifetimeClosed).toBe(1);
  });

  it('cancels sweep if maxLifetime is negative', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, {
      maxLifetime: 600_000,
      maxIdleCount: 2,
    });

    const item = await pool.get();

    pool.release(item);
    const stats = pool.stats();
    expect(stats.idleCount).toBe(1);
    expect(stats.maxLifetimeClosed).toBe(0);

    // Allow initial sweep to schedule
    await wait(10);

    pool.setOptions({ maxLifetime: -1 });

    await expect(pool.close()).resolves.toBe(undefined);
  });

  it('does not sweep if pool is empty', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, {
      maxLifetime: 600_000,
      maxIdleCount: 2,
    });

    pool.setOptions({ maxLifetime: 500_000 });

    await expect(pool.close()).resolves.toBe(undefined);
  });
});

describe('maxIdleTime', () => {
  it('prohibits 0 value', () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);
    expect(() => pool.setOptions({ maxIdleTime: 0 })).toThrow(
      'maxIdleTime cannot be 0'
    );
  });

  it('ignores set to same value', async () => {
    // Ensures coverage of short-circuit in EmittingPoolOptions
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxIdleTime: 2 });
    pool.setOptions({ maxIdleTime: 2 });
    await expect(pool.close()).resolves.toBe(undefined);
  });

  it('auto sweeps item when item expires - idle time', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, {
      maxLifetime: 600_000,
      maxIdleTime: 10,
      maxIdleCount: 2,
    });

    const item = await pool.get();

    pool.release(item);
    let stats = pool.stats();
    expect(stats.idleCount).toBe(1);
    expect(stats.maxLifetimeClosed).toBe(0);

    await wait(15);

    stats = pool.stats();
    expect(stats.idleCount).toBe(0);
    expect(stats.maxIdleTimeClosed).toBe(1);
  });

  it('auto re-sweeps item on sweep - idle time', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, {
      maxLifetime: 600_000,
      maxIdleTime: 40,
      maxIdleCount: 2,
    });

    const item1 = await pool.get();
    const item2 = await pool.get();

    pool.release(item1);
    let stats = pool.stats();
    expect(stats.idleCount).toBe(1);
    expect(stats.maxLifetimeClosed).toBe(0);

    await wait(30); // Wait a bit, but not until item1 idles out

    pool.release(item2);
    stats = pool.stats();
    expect(stats.idleCount).toBe(2);
    expect(stats.maxIdleTimeClosed).toBe(0);

    await wait(20); // Wait for item1 to idle out

    stats = pool.stats();
    expect(stats.idleCount).toBe(1);
    expect(stats.maxIdleTimeClosed).toBe(1);

    await wait(40); // Wait for item2 to idle out

    stats = pool.stats();
    expect(stats.idleCount).toBe(0);
    expect(stats.maxIdleTimeClosed).toBe(2);
  });

  it('sweeps pool when maxIdleTime is changed', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, {
      maxIdleTime: 600_000,
      maxIdleCount: 2,
    });

    const item = await pool.get();

    pool.release(item);
    let stats = pool.stats();
    expect(stats.idleCount).toBe(1);
    expect(stats.maxIdleTimeClosed).toBe(0);

    // Allow initial sweep to schedule
    await wait(10);

    pool.setOptions({ maxIdleTime: 10 });

    // Allow sweep to execute
    await wait(10);

    stats = pool.stats();
    expect(stats.idleCount).toBe(0);
    expect(stats.maxIdleTimeClosed).toBe(1);
  });

  it('cancels sweep if maxIdleTime is negative', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, {
      maxIdleTime: 600_000,
      maxIdleCount: 2,
    });

    const item = await pool.get();

    pool.release(item);
    const stats = pool.stats();
    expect(stats.idleCount).toBe(1);
    expect(stats.maxIdleTimeClosed).toBe(0);

    // Allow initial sweep to schedule
    await wait(10);

    pool.setOptions({ maxIdleTime: -1 });

    await expect(pool.close()).resolves.toBe(undefined);
  });

  it('does not sweep if pool is empty', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, {
      maxIdleTime: 600_000,
      maxIdleCount: 2,
    });

    pool.setOptions({ maxIdleTime: 500_000 });

    await expect(pool.close()).resolves.toBe(undefined);
  });
});

describe('maxOpenCount', () => {
  it('prohibits 0 value', () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);
    expect(() => pool.setOptions({ maxOpenCount: 0 })).toThrow(
      'maxOpenCount cannot be 0'
    );
  });

  it('ignores set to same value', async () => {
    // Ensures coverage of short-circuit in EmittingPoolOptions
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 2 });
    pool.setOptions({ maxOpenCount: 2 });
    await expect(pool.close()).resolves.toBe(undefined);
  });

  it('destroys on release if over maxOpenCount', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 3, maxIdleCount: 3 });

    const item1 = await pool.get();
    const item2 = await pool.get();
    const item3 = await pool.get();

    pool.setOptions({ maxOpenCount: 2 });

    pool.release(item1);
    const stats = pool.stats();
    expect(stats.idleCount).toBe(0);
    expect(stats.maxIdleClosed).toBe(1);

    pool.release(item2);
    pool.release(item3);

    await expect(pool.close()).resolves.toBe(undefined);
  });

  it('auto-grows if maxOpenCount increased', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 1, maxIdleCount: 3 });

    const item1 = await pool.get();
    const req2 = pool.get();
    const req3 = pool.get();

    await wait(10);

    // Still only 1 item created
    expect(factory.created).toBe(1);

    pool.setOptions({ maxOpenCount: 4 });

    // Allow a moment to create more items
    await wait(10);

    expect(factory.created).toBe(3);

    const item2 = await req2;
    const item3 = await req3;

    for (const item of [item1, item2, item3]) {
      expect(item.id).toBeGreaterThan(0);
      pool.release(item);
    }

    await expect(pool.close()).resolves.toBe(undefined);
  });

  it('retires pooled items if maxOpenCount reduced', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 4 });

    // Make three items
    const item1 = await pool.get();
    const item2 = await pool.get();
    const item3 = await pool.get();

    // Return them to the pool
    pool.release(item3); // Item 3 will have longest idle time
    await wait(10);
    pool.release(item1); // Item 1 will have second longest idle time
    await wait(10);
    pool.release(item2); // Item 1 will have shortest idle time

    expect(pool.stats().idleCount).toBe(3);

    pool.setOptions({ maxOpenCount: 2 });

    // Allow a moment to destroy item
    await wait(10);

    let stats = pool.stats();
    expect(stats.idleCount).toBe(2);
    expect(stats.maxIdleClosed).toBe(1);

    // Should have specifically destroyed item 3 (longest idle)
    expect(item3.destroyed).toBe(true);
    expect(item1.destroyed).toBe(false);
    expect(item2.destroyed).toBe(false);

    // Shrink again
    pool.setOptions({ maxOpenCount: 1 });

    // Allow a moment to destroy item
    await wait(10);

    stats = pool.stats();
    expect(stats.idleCount).toBe(1);
    expect(stats.maxIdleClosed).toBe(2);

    // Should have specifically destroyed item 1 (next longest idle)
    expect(item1.destroyed).toBe(true);
    expect(item2.destroyed).toBe(false);

    await expect(pool.close()).resolves.toBe(undefined);
  });

  it('does not retire items if maxOpenCount negative', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 4 });

    // Make three items
    const item1 = await pool.get();
    const item2 = await pool.get();
    const item3 = await pool.get();

    for (const item of [item1, item2, item3]) {
      pool.release(item);
    }

    expect(pool.stats().idleCount).toBe(3);

    pool.setOptions({ maxOpenCount: -1 });

    await wait(10);

    // Items left in pool
    expect(pool.stats().idleCount).toBe(3);

    await expect(pool.close()).resolves.toBe(undefined);
  });

  it('does not retire items if maxOpenCount is greater than total count', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 6 });

    // Make three items
    const item1 = await pool.get();
    const item2 = await pool.get();
    const item3 = await pool.get();

    for (const item of [item1, item2, item3]) {
      pool.release(item);
    }

    expect(pool.stats().idleCount).toBe(3);

    pool.setOptions({ maxOpenCount: 4 });

    await wait(10);

    // Items left in pool
    expect(pool.stats().idleCount).toBe(3);

    await expect(pool.close()).resolves.toBe(undefined);
  });
});

describe('maxIdleCount', () => {
  it('allows 0 value', () => {
    const factory = new CounterFactory();
    const pool = createPool(factory);
    expect(() => pool.setOptions({ maxIdleCount: 0 })).not.toThrow();
  });

  it('ignores set to same value', async () => {
    // Ensures coverage of short-circuit in EmittingPoolOptions
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxIdleCount: 2 });
    pool.setOptions({ maxIdleCount: 2 });
    await expect(pool.close()).resolves.toBe(undefined);
  });

  it('destroys on release if over maxIdleCount', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxOpenCount: 4, maxIdleCount: 2 });

    const item1 = await pool.get();
    const item2 = await pool.get();
    const item3 = await pool.get();

    pool.release(item1);
    expect(pool.stats().idleCount).toBe(1);

    pool.release(item2);
    expect(pool.stats().idleCount).toBe(2);

    pool.release(item3);
    const stats = pool.stats();
    expect(stats.idleCount).toBe(2);
    expect(stats.maxIdleClosed).toBe(1);
  });

  it('retires pooled items if maxOpenCount reduced', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxIdleCount: 4 });

    // Make three items
    const item1 = await pool.get();
    const item2 = await pool.get();
    const item3 = await pool.get();

    // Return them to the pool
    pool.release(item3); // Item 3 will have longest idle time
    await wait(10);
    pool.release(item1); // Item 1 will have second longest idle time
    await wait(10);
    pool.release(item2); // Item 1 will have shortest idle time

    expect(pool.stats().idleCount).toBe(3);

    pool.setOptions({ maxIdleCount: 2 });

    // Allow a moment to destroy item
    await wait(10);

    let stats = pool.stats();
    expect(stats.idleCount).toBe(2);
    expect(stats.maxIdleClosed).toBe(1);

    // Should have specifically destroyed item 3 (longest idle)
    expect(item3.destroyed).toBe(true);
    expect(item1.destroyed).toBe(false);
    expect(item2.destroyed).toBe(false);

    // Shrink again
    pool.setOptions({ maxIdleCount: 1 });

    // Allow a moment to destroy item
    await wait(10);

    stats = pool.stats();
    expect(stats.idleCount).toBe(1);
    expect(stats.maxIdleClosed).toBe(2);

    // Should have specifically destroyed item 1 (next longest idle)
    expect(item1.destroyed).toBe(true);
    expect(item2.destroyed).toBe(false);

    await expect(pool.close()).resolves.toBe(undefined);
  });

  it('does not retire items if maxIdleCount negative', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxIdleCount: 4 });

    // Make three items
    const item1 = await pool.get();
    const item2 = await pool.get();
    const item3 = await pool.get();

    for (const item of [item1, item2, item3]) {
      pool.release(item);
    }

    expect(pool.stats().idleCount).toBe(3);

    pool.setOptions({ maxIdleCount: -1 });

    await wait(10);

    // Items left in pool
    expect(pool.stats().idleCount).toBe(3);

    await expect(pool.close()).resolves.toBe(undefined);
  });

  it('does not retire items if maxIdleCount is greater than idled total count', async () => {
    const factory = new CounterFactory();
    const pool = createPool(factory, { maxIdleCount: 6 });

    // Make three items
    const item1 = await pool.get();
    const item2 = await pool.get();
    const item3 = await pool.get();

    for (const item of [item1, item2, item3]) {
      pool.release(item);
    }

    expect(pool.stats().idleCount).toBe(3);

    pool.setOptions({ maxIdleCount: 4 });

    await wait(10);

    // Items left in pool
    expect(pool.stats().idleCount).toBe(3);

    await expect(pool.close()).resolves.toBe(undefined);
  });
});

describe('errors', () => {
  it('captures and emits create errors', async () => {
    const errs: string[] = [];
    const badPool = createPool<object>({
      create() {
        throw new Error('Error creating');
      },
      destroy() {
        return Promise.resolve();
      },
    });

    badPool.on('error', (action, err) => {
      errs.push(`Pool error for ${action} action: ${err}`);
    });

    const req = badPool.get();

    await wait(5);

    const reqTest = expect(req).rejects.toThrow('Pool is closing');

    // Put it out of its misery
    await badPool.close();
    await reqTest;

    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(
      'Pool error for create action: Error: Error creating'
    );
  });

  it('captures and emits destroy errors', async () => {
    const errs: string[] = [];
    const badPool = createPool<object>({
      create() {
        return Promise.resolve({ msg: 'Hello' });
      },
      destroy() {
        throw new Error('Error destroying');
      },
    });

    badPool.on('error', (action, err) => {
      errs.push(`Pool error for ${action} action: ${err}`);
    });

    const item = await badPool.get();

    badPool.release(item);

    // Put it out of its misery
    await badPool.close();

    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(
      'Pool error for destroy action: Error: Error destroying'
    );
  });

  it('captures and emits release errors', async () => {
    const errs: string[] = [];
    const badPool = createPool<object>({
      create() {
        return Promise.resolve({ msg: 'Hello' });
      },
      destroy() {
        return Promise.resolve();
      },
      reset(item) {
        throw new Error(`I refuse to reset item ${item}`);
      },
    });

    badPool.on('error', (action, err) => {
      errs.push(`Pool error for ${action} action: ${err}`);
    });

    const item = await badPool.get();

    badPool.release(item);

    // Put it out of its misery
    await badPool.close();

    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(
      'Pool error for reset action: Error: I refuse to reset item [object Object]'
    );
  });

  it('kills pool on 10 consecutive create failures', async () => {
    const errs: string[] = [];
    const badPool = createPool<object>({
      create() {
        throw new Error('Error creating');
      },
      destroy() {
        return Promise.resolve();
      },
    });

    badPool.on('error', (action, err) => {
      errs.push(`Pool error for ${action} action: ${err}`);
    });

    const req = badPool.get();

    await expect(req).rejects.toThrow('Pool is closing');

    expect(errs.length).toBe(10);
  });
});
