// Copyright 2022 Joshua Honig. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

import { later, limit } from '$';
import { Context, IContext } from '@sabl/context';

describe('limit', () => {
  describe('resolve', () => {
    it('resolves with ms', async () => {
      const p = later(22, 2);
      const result = await limit(p, 4);
      expect(result).toBe(22);
    });

    it('resolves with deadline', async () => {
      const p = later(22, 2);
      const result = await limit(p, new Date(4 + +new Date()));
      expect(result).toBe(22);
    });

    it('resolves with null context', async () => {
      const p = later(22, 2);
      const result = await limit(p, <IContext>null!);
      expect(result).toBe(22);
    });

    it('resolves with non-cancelable context', async () => {
      const p = later(22, 2);
      const result = await limit(p, Context.background);
      expect(result).toBe(22);
    });

    it('resolves with cancelable context', async () => {
      const [ctx, cancel] = Context.cancel();
      const p = later(22, 2);
      const result = await limit(p, ctx);
      expect(result).toBe(22);
      cancel();
    });
  });

  describe('reject', () => {
    it('rejects with ms', async () => {
      const p = Promise.reject(new Error('failing on purpose'));
      const pLimit = limit(p, 4);
      await expect(pLimit).rejects.toThrow('failing on purpose');
    });

    it('rejects with deadline', async () => {
      const p = Promise.reject(new Error('failing on purpose'));
      const pLimit = limit(p, new Date(4 + +new Date()));
      await expect(pLimit).rejects.toThrow('failing on purpose');
    });

    it('rejects with null context', async () => {
      const p = Promise.reject(new Error('failing on purpose'));
      const pLimit = limit(p, <IContext>null!);
      await expect(pLimit).rejects.toThrow('failing on purpose');
    });

    it('rejects with non-cancelable context', async () => {
      const p = Promise.reject(new Error('failing on purpose'));
      const pLimit = limit(p, Context.background);
      await expect(pLimit).rejects.toThrow('failing on purpose');
    });

    it('rejects with cancelable context', async () => {
      const [ctx, cancel] = Context.cancel();
      const p = Promise.reject(new Error('failing on purpose'));
      const pLimit = limit(p, ctx);
      await expect(pLimit).rejects.toThrow('failing on purpose');
      cancel();
    });
  });

  describe('timeout', () => {
    it('times out before resolve with ms', async () => {
      const p = later(22, 10);
      const pLimit = limit(p, 1);

      // Outer promise rejects with cancellation error
      await expect(pLimit).rejects.toThrow('canceled due to timeout');

      // Inner promise still resolves as expected
      expect(await p).toBe(22);
    });

    it('times out before resolve with deadline', async () => {
      const p = later(22, 10);
      const pLimit = limit(p, new Date(1 + +new Date()));

      // Outer promise rejects with cancellation error
      await expect(pLimit).rejects.toThrow('canceled due to timeout');

      // Inner promise still resolves as expected
      expect(await p).toBe(22);
    });

    it('times out before resolve with cancelable context', async () => {
      const [ctx, cancel] = Context.cancel();
      const p = later(22, 10);
      const pLimit = limit(p, ctx);
      setTimeout(cancel, 1);

      // Outer promise rejects with cancellation error
      await expect(pLimit).rejects.toThrow('canceled due to timeout');

      // Inner promise still resolves as expected
      expect(await p).toBe(22);
    });

    it('immediately times out with 0 ms', async () => {
      const p = Promise.resolve(22);
      const pLimit = limit(p, 0);

      // Outer promise rejects with cancellation error
      await expect(pLimit).rejects.toThrow('canceled due to timeout');

      // Inner promise still resolves as expected
      expect(await p).toBe(22);
    });

    it('immediately times out with past deadline', async () => {
      const p = Promise.resolve(22);
      const pLimit = limit(p, new Date(+new Date() - 1000));

      // Outer promise rejects with cancellation error
      await expect(pLimit).rejects.toThrow('canceled due to timeout');

      // Inner promise still resolves as expected
      expect(await p).toBe(22);
    });

    it('immediately times out with canceled context', async () => {
      const [ctx, cancel] = Context.cancel();
      cancel();

      const p = Promise.resolve(22);
      const pLimit = limit(p, ctx);

      // Outer promise rejects with cancellation error
      await expect(pLimit).rejects.toThrow('canceled due to timeout');

      // Inner promise still resolves as expected
      expect(await p).toBe(22);
    });

    it('times out before reject with ms', async () => {
      const p = later(() => {
        throw new Error('failing on purpose');
      }, 10);

      const pLimit = limit(p, 1);

      // Outer promise rejects with cancellation error
      await expect(pLimit).rejects.toThrow('canceled due to timeout');

      // Inner promise still rejects as expected
      await expect(p).rejects.toThrow('on purpose');
    });

    it('times out before reject with deadline', async () => {
      const p = later(() => {
        throw new Error('failing on purpose');
      }, 10);

      const pLimit = limit(p, new Date(1 + +new Date()));

      // Outer promise rejects with cancellation error
      await expect(pLimit).rejects.toThrow('canceled due to timeout');

      // Inner promise still rejects as expected
      await expect(p).rejects.toThrow('on purpose');
    });

    it('times out before reject with cancelable context', async () => {
      const [ctx, cancel] = Context.cancel();
      const p = later(() => {
        throw new Error('failing on purpose');
      }, 10);

      const pLimit = limit(p, ctx);
      setTimeout(cancel, 1);

      // Outer promise rejects with cancellation error
      await expect(pLimit).rejects.toThrow('canceled due to timeout');

      // Inner promise still rejects as expected
      await expect(p).rejects.toThrow('on purpose');
    });
  });
});
