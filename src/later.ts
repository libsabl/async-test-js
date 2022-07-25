// Copyright 2022 Joshua Honig. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

/**
 * Resolve a value after `ms` milliseconds. If `value`
 * itself is a promise, that promise will also be awaited.
 */
export async function later<T>(
  value: T | Promise<T>,
  ms?: number | undefined
): Promise<T>;

/**
 * Await a callback that will be started after `ms` milliseconds.
 * If the callback itself returns a promise, that promise will
 * also be awaited.
 */
export async function later<T>(
  fn: () => T | Promise<T>,
  ms?: number | undefined
): Promise<T>;

/**
 * Await a callback that will be started after `ms` milliseconds.
 * If the callback itself returns a promise, that promise will
 * also be awaited.
 */
export async function later<T>(
  fnOrValue: T | Promise<T> | (() => T | Promise<T>),
  ms?: number | undefined
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    setTimeout(async () => {
      try {
        let result: T | Promise<T>;
        if (typeof fnOrValue === 'function') {
          result = (<() => T | Promise<T>>fnOrValue)();
        } else {
          result = fnOrValue;
        }
        if (isPromise(result)) {
          result = await result;
        }
        resolve(result);
      } catch (e) {
        reject(e);
      }
    }, ms);
  });
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  if (value == null) return false;
  if (typeof value !== 'object') return false;
  if (!('then' in value)) return false;
  if (!('catch' in value)) return false;
  if (!('finally' in value)) return false;

  if (typeof value.then !== 'function') return false;

  // Object is thenable, runtime itself would treat as a promise

  return true;
}
