// Copyright 2022 Joshua Honig. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

import { wait } from '$';
import { Context } from '@sabl/context';

it('waits ms milliseconds', async () => {
  const start = +new Date();
  await wait(100);
  const end = +new Date();
  const waited = end - start;

  // Accurate withing 20 ms
  expect(Math.abs(100 - waited)).toBeLessThan(20);
});

it('waits until deadline', async () => {
  const start = +new Date();
  await wait(new Date(100 + start));
  const end = +new Date();
  const waited = end - start;

  // Accurate withing 20 ms
  expect(Math.abs(100 - waited)).toBeLessThan(20);
});

it('waits for context to cancel', async () => {
  const [ctx, cancel] = Context.cancel();

  const start = +new Date();
  setTimeout(cancel, 100);

  await wait(ctx);
  const end = +new Date();
  const waited = end - start;

  // Accurate withing 20 ms
  expect(Math.abs(100 - waited)).toBeLessThan(20);
});

it('returns for 0 ms', async () => {
  const start = +new Date();
  await wait(0);
  const end = +new Date();
  const waited = end - start;

  expect(waited).toBeLessThan(2);
});

it('returns for past date', async () => {
  const start = +new Date();
  await wait(new Date(start - 1000));
  const end = +new Date();
  const waited = end - start;

  expect(waited).toBeLessThan(2);
});

it('returns for non-cancelable context', async () => {
  const start = +new Date();
  await wait(Context.background);
  const end = +new Date();
  const waited = end - start;

  expect(waited).toBeLessThan(2);
});

it('returns for canceled context', async () => {
  const [ctx, cancel] = Context.cancel();
  cancel();

  const start = +new Date();
  await wait(ctx);
  const end = +new Date();
  const waited = end - start;

  expect(waited).toBeLessThan(2);
});
