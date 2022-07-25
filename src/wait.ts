// Copyright 2022 Joshua Honig. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

import { IContext } from '@sabl/context';

/** Asynchronously wait for `ms` milliseconds */
export function wait(ms: number): Promise<void>;

/** Asynchronously wait until `deadline` */
export function wait(deadline: Date): Promise<void>;

/** Asynchronously wait until `ctx` is canceled */
export function wait(ctx: IContext): Promise<void>;

export function wait(limiter: number | Date | IContext): Promise<void> {
  let ms: number;
  if (typeof limiter === 'number') {
    ms = limiter;
  } else if (limiter instanceof Date) {
    ms = +limiter - +new Date();
  } else {
    // Context
    const ctx = limiter;
    if (ctx.canceler == null || ctx.canceler.canceled) {
      return Promise.resolve();
    }
    return new Promise((resolve) => ctx.canceler!.onCancel(resolve));
  }

  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}
