// Copyright 2022 Joshua Honig. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

import { Canceler, IContext } from '@sabl/context';

export type FnReject = (reason: unknown) => void;
export type FnResolve<T> = (value: T | PromiseLike<T>) => void;

/**
 * A promise that also exposes its own
 * resolve and reject callbacks
 */
export interface CallbackPromise<T> extends Promise<T> {
  resolve(value: T | PromiseLike<T>): void;
  reject(reason: unknown): void;
}

/**
 * Create a promise that also exposes its own
 * resolve and reject callbacks
 */
export function promise<T>(): CallbackPromise<T>;

/**
 * Create a promise that also exposes its own
 * resolve and reject callbacks, which
 * will be automatically canceled if ctx
 * is cancelable and is canceled
 *
 * @param ctx A context. If it is not cancelable, it is ignored
 * @param errCanceled Optional callback with creates a new Error
 * which is used to reject the promise if the context is canceled
 * before the promise is resolved.
 */
export function promise<T>(ctx: IContext): CallbackPromise<T>;

export function promise<T>(ctx?: IContext): CallbackPromise<T> {
  let res: FnResolve<T>;
  let rej: FnReject;

  // Create promise and capture callbacks
  const p = new Promise<T>((resolve, reject) => {
    res = resolve;
    rej = reject;
  });

  // Assign callbacks to promise object
  const cbp = <CallbackPromise<T>>p;
  cbp.resolve = res!;
  cbp.reject = rej!;

  if (ctx == null || ctx.canceler == null) {
    return cbp;
  }

  // Handle cancellation
  const clr = ctx.canceler;
  if (clr.canceled) {
    // Already canceled. Immediately reject and return
    cbp.reject(clr.err);
    return cbp;
  }

  // Handle future possible cancellation
  const outerPromise = runWithCancel(clr, cbp);
  const outerCbp = <CallbackPromise<T>>outerPromise;
  outerCbp.reject = rej!; // Yes, inner reject
  outerCbp.resolve = res!; // Yes, inner resolve
  return outerCbp;
}

async function runWithCancel<T>(
  clr: Canceler,
  cbp: CallbackPromise<T>
): Promise<T> {
  const onCancel = (err: Error) => {
    cbp.reject(err);
  };

  clr.onCancel(onCancel);
  try {
    return await cbp;
  } finally {
    clr.off(onCancel);
  }
}
