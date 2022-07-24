// Copyright 2022 Joshua Honig. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

import { CancelFunc, IContext } from '@sabl/context';
import { FnReject } from './promise';

function timeoutError() {
  return new Error('Promise canceled due to timeout');
}

/**
 * Await promise `p`, but automatically reject it if `ctx`
 * is canceled before `p` resolves.
 */
export async function limit<T>(p: Promise<T>, ctx: IContext): Promise<T>;

/**
 * Await promise `p`, but automatically reject it if it
 * has not resolved by `deadline`
 */
export async function limit<T>(p: Promise<T>, deadline: Date): Promise<T>;

/**
 * Await promise `p`, but automatically reject it if it
 * has not resolved after `ms` milliseconds
 */
export async function limit<T>(p: Promise<T>, ms: number): Promise<T>;

export async function limit<T>(
  p: Promise<T>,
  limiter: number | Date | IContext
): Promise<T> {
  let ms: number;
  if (typeof limiter === 'number') {
    ms = limiter;
  } else if (limiter instanceof Date) {
    ms = +limiter - +new Date();
  } else {
    // Context
    return limitContext(p, limiter);
  }

  if (ms <= 0) {
    return Promise.reject(timeoutError());
  }

  let rejected = false;

  const timeout: {
    token?: NodeJS.Timeout;
    reject?: FnReject;
  } = {};

  const clearAndCancel = () => {
    clearTimeout(timeout.token);
    rejected = true;
    timeout.reject!(timeoutError());
  };

  timeout.token = setTimeout(clearAndCancel, ms);

  return new Promise<T>((resolve, reject) => {
    timeout.reject = reject;
    p.finally(() => {
      clearTimeout(timeout.token);
    })
      .then((value) => {
        if (rejected) {
          // Already rejected by timeout
          return;
        }
        resolve(value);
      })
      .catch((reason) => {
        if (rejected) {
          // Already rejected by timeout
          return;
        }
        reject(reason);
      });
  });
}

function limitContext<T>(p: Promise<T>, ctx: IContext): Promise<T> {
  if (ctx == null || ctx.canceler == null) {
    return p;
  }

  const clr = ctx.canceler;
  if (clr.canceled) {
    return Promise.reject(timeoutError());
  }

  let rejected = false;

  const handler: {
    cancel?: CancelFunc;
    reject?: FnReject;
  } = {};

  handler.cancel = () => {
    clr.off(handler.cancel!);
    rejected = true;
    handler.reject!(timeoutError());
  };

  clr.onCancel(handler.cancel);

  return new Promise<T>((resolve, reject) => {
    handler.reject = reject;
    p.finally(() => {
      clr.off(handler.cancel!);
    })
      .then((value) => {
        if (rejected) {
          // Already rejected by timeout
          return;
        }
        resolve(value);
      })
      .catch((reason) => {
        if (rejected) {
          // Already rejected by timeout
          return;
        }
        reject(reason);
      });
  });
}
