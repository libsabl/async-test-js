// Copyright 2022 Joshua Honig. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

import { isCanceled, later, promise } from '$';
import { Canceler, Context } from '@sabl/context';

describe('promise', () => {
  it('resolves on resolve', async () => {
    const p = promise<number>();

    await later(() => p.resolve(1), 1);

    const result = await p;
    expect(result).toBe(1);
  });

  it('rejects on reject', async () => {
    const p = promise<number>();
    const err = new Error('rejected!');

    // Note: need to hook up rejects
    // expectation before promise is rejected
    await Promise.all([
      later(() => p.reject(err), 1),
      expect(p).rejects.toBe(err),
    ]);
  });

  it('ignores reject after resolve', async () => {
    const p = promise<number>();
    const err = new Error('rejected!');

    await later(() => p.resolve(1), 1);
    await later(() => p.reject(err), 2);

    const result = await p;
    expect(result).toBe(1);
  });

  it('ignores resolve after reject', async () => {
    const p = promise<number>();
    const err = new Error('rejected!');

    // Note: need to hook up rejects
    // expectation before promise is rejected
    await Promise.all([
      later(() => p.reject(err), 1),
      later(() => p.resolve(1), 2),
      expect(p).rejects.toBe(err),
    ]);
  });

  it('ignores non-cancelable context', async () => {
    const p = promise<number>(Context.background);

    await later(() => p.resolve(1), 1);

    const result = await p;
    expect(result).toBe(1);
  });

  describe('cancelable', () => {
    it('immediately rejects canceled context', async () => {
      const [ctx, cancel] = Context.cancel();
      cancel();

      const p = promise<number>(ctx);

      await expect(p).rejects.toThrow('Context was already canceled');
    });

    it('immediately rejects canceled context with custom error', async () => {
      const [ctx, cancel] = Context.cancel();
      cancel();

      const p = promise<number>(ctx, () => new Error('Custom error'));

      await expect(p).rejects.toThrow('Custom error');
    });

    it('resolves if resolved before canceled', async () => {
      const [ctx, cancel] = Context.cancel();
      const p = promise<number>(ctx);

      p.resolve(1);
      cancel();

      const result = await p;
      expect(result).toBe(1);
    });

    it('rejects if rejected before canceled', async () => {
      const [ctx, cancel] = Context.cancel();

      const p = promise<number>(ctx);
      const pTest = expect(p).rejects.toThrow('Custom error');

      p.reject(new Error('Custom error'));
      cancel();

      await pTest;
    });

    it('rejects with cancellation when canceled', async () => {
      const [ctx, cancel] = Context.cancel();

      const p = promise<number>(ctx);
      const pTest = expect(p).rejects.toThrow('canceled');

      cancel();

      await pTest;
    });

    it('rejects with custom cancellation error when canceled', async () => {
      const [ctx, cancel] = Context.cancel();

      const p = promise<number>(ctx, () => new Error('Custom error'));
      const pTest = expect(p).rejects.toThrow('Custom error');

      cancel();

      await pTest;
    });

    it('removes cancel callback when resolved', async () => {
      const [ctx] = Context.cancel();
      const p = promise<number>(ctx);

      expect(Canceler.size(ctx.canceler)).toBe(1);

      p.resolve(1);

      await p;

      expect(Canceler.size(ctx.canceler)).toBe(0);
    });

    it('removes cancel callback when rejected', async () => {
      const [ctx] = Context.cancel();
      const p = promise<number>(ctx);

      expect(Canceler.size(ctx.canceler)).toBe(1);

      p.reject(new Error('failed'));

      await expect(p).rejects.toThrow('failed');

      expect(Canceler.size(ctx.canceler)).toBe(0);
    });

    it('removes cancel callback when canceled', async () => {
      const [ctx, cancel] = Context.cancel();
      const p = promise<number>(ctx);

      expect(Canceler.size(ctx.canceler)).toBe(1);

      const pTest = expect(p).rejects.toThrow('canceled');

      cancel();

      await pTest;

      expect(Canceler.size(ctx.canceler)).toBe(0);
    });

    it('ignores resolve after cancel', async () => {
      const [ctx, cancel] = Context.cancel();
      const p = promise<number>(ctx);

      const pTest = expect(p).rejects.toThrow('canceled');

      cancel();
      p.resolve(1);

      await pTest;

      expect(Canceler.size(ctx.canceler)).toBe(0);
    });

    it('ignores reject after cancel', async () => {
      const [ctx, cancel] = Context.cancel();
      const p = promise<number>(ctx);

      const pTest = expect(p).rejects.toThrow('canceled');

      cancel();
      p.reject(new Error('foo'));

      await pTest;

      expect(Canceler.size(ctx.canceler)).toBe(0);
    });
  });
});

describe('isCanceled', () => {
  it('is false for empty values', () => {
    expect(isCanceled(null)).toBe(false);
    expect(isCanceled(undefined)).toBe(false);
  });

  it('is false for custom errors', () => {
    expect(isCanceled(new Error('canceled'))).toBe(false);
  });

  it('is true for rejection due to context already canceled', async () => {
    const [ctx, cancel] = Context.cancel();
    cancel();

    const p = promise<number>(ctx);

    expect.assertions(1);
    try {
      await p;
    } catch (e) {
      expect(isCanceled(e)).toBe(true);
    }
  });

  it('is true for rejection due to context already canceled with custom error', async () => {
    const [ctx, cancel] = Context.cancel();
    cancel();

    const p = promise<number>(ctx, () => new Error('My own error'));

    expect.assertions(1);
    try {
      await p;
    } catch (e) {
      expect(isCanceled(e)).toBe(true);
    }
  });

  it('is true for rejection due to context canceled', async () => {
    const [ctx, cancel] = Context.cancel();

    const p = promise<number>(ctx);

    expect.assertions(1);

    later(cancel, 10);

    try {
      await p;
    } catch (e) {
      expect(isCanceled(e)).toBe(true);
    }
  });

  it('is true for rejection due to context canceled with custom error', async () => {
    const [ctx, cancel] = Context.cancel();

    const p = promise<number>(ctx, () => new Error('My own error'));

    expect.assertions(1);

    later(cancel, 10);

    try {
      await p;
    } catch (e) {
      expect(isCanceled(e)).toBe(true);
    }
  });

  it('works to wrap promise - resolve', async () => {
    const [ctx, cancel] = Context.cancel();

    const p = promise<number>(ctx);

    let msg = 'initial value';

    const wrapped = p.catch((reason) => {
      if (isCanceled(reason)) {
        msg = 'canceled!';
      }
      throw reason;
    });

    p.resolve(1);
    cancel();

    const result = await wrapped;
    expect(result).toBe(1);
    expect(msg).toEqual('initial value');
  });

  it('works to wrap promise - reject', async () => {
    const [ctx, cancel] = Context.cancel();

    const p = promise<number>(ctx);

    let msg = 'initial value';

    const wrapped = p.catch((reason) => {
      if (isCanceled(reason)) {
        msg = 'canceled!';
      }
      throw reason;
    });

    p.reject('rejected');
    cancel();

    await expect(wrapped).rejects.toThrow('rejected');
    expect(msg).toEqual('initial value');
  });

  it('works to wrap promise - canceled', async () => {
    const [ctx, cancel] = Context.cancel();

    const p = promise<number>(ctx);

    let msg = 'initial value';

    const wrapped = p.catch((reason) => {
      if (isCanceled(reason)) {
        msg = 'canceled!';
      }
      throw reason;
    });

    cancel();
    p.reject('rejected');

    await expect(wrapped).rejects.toThrow('canceled');
    expect(msg).toEqual('canceled!');
  });
});
