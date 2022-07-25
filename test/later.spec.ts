// Copyright 2022 Joshua Honig. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

import { later } from '$';

it('resolves literal value', async () => {
  const result = await later(1, 1);
  expect(result).toBe(1);
});

it('resolves literal promise value', async () => {
  const p = Promise.resolve(1);
  const result = await later(p, 1);
  expect(result).toBe(1);
});

it('resolves to returned value', async () => {
  const result = await later(() => 1, 1);
  expect(result).toBe(1);
});

it('resolves to resolved promise value', async () => {
  const result = await later(() => Promise.resolve(1), 1);
  expect(result).toBe(1);
});

it('awaits inner promise', async () => {
  const result = await later(() => later(() => 1, 2), 1);
  expect(result).toBe(1);
});

//
it('resolves null literal', async () => {
  const result = await later(null, 1);
  expect(result).toBe(null);
});

it('resolves literal promise value', async () => {
  const p = Promise.resolve();
  const result = await later(p, 1);
  expect(result).toBe(undefined);
});

it('resolves to returned null', async () => {
  const result = await later(() => null, 1);
  expect(result).toBe(null);
});

it('resolves to resolved null promise value', async () => {
  const result = await later(() => Promise.resolve(), 1);
  expect(result).toBe(undefined);
});

//

it('rejects rejected literal promise', async () => {
  const p = Promise.reject('rejected!');

  // Need to expect rejection on p itself too or jest freaks out
  await expect(p).rejects.toEqual('rejected!');

  await expect(later(p, 1)).rejects.toEqual('rejected!');
});

it('rejects function which throws', async () => {
  await expect(
    later(() => {
      throw 'rejected!';
    }, 1)
  ).rejects.toEqual('rejected!');
});

it('rejects async function which throws', async () => {
  await expect(later(() => Promise.reject('rejected!'), 1)).rejects.toEqual(
    'rejected!'
  );
});

describe('resolves non-promises', () => {
  it('no then', async () => {
    const obj = {};
    const result = await later(obj, 1);
    expect(result).toBe(obj);
  });

  it('no catch', async () => {
    const obj = { then: 1 };
    const result = await later(obj, 1);
    expect(result).toBe(obj);
  });

  it('no finally', async () => {
    const obj = { then: 1, catch: 2 };
    const result = await later(obj, 1);
    expect(result).toBe(obj);
  });

  it('then is not a function', async () => {
    const obj = { then: 1, catch: 2, finally: 3 };
    const result = await later(obj, 1);
    expect(result).toBe(obj);
  });
});
