<!-- BEGIN:REMOVE_FOR_NPM -->
[![codecov](https://codecov.io/gh/libsabl/async-js/branch/main/graph/badge.svg?token=TVL1XYSJHA)](https://app.codecov.io/gh/libsabl/async-js/branch/main)
<span class="badge-npmversion"><a href="https://npmjs.org/package/@sabl/async" title="View this project on NPM"><img src="https://img.shields.io/npm/v/@sabl/async.svg" alt="NPM version" /></a></span>

<!-- END:REMOVE_FOR_NPM -->

# @sabl/async

**async** contains several simple utilities for async programming in javascript. Several of the utilities use the [context pattern](https://github.com/libsabl/patterns/blob/main/patterns/context.md) implemented in [`@sabl/context`](https://npmjs.com/package/@sabl/context) to implement automatic async cancellation.
    
<!-- BEGIN:REMOVE_FOR_NPM -->
> [**sabl**](https://github.com/libsabl/patterns) is an open-source project to identify, describe, and implement effective software patterns which solve small problems clearly, can be composed to solve big problems, and which work consistently across many programming languages.

## Developer orientation

See [SETUP.md](./docs/SETUP.md), [CONFIG.md](./docs/CONFIG.md).
<!-- END:REMOVE_FOR_NPM -->

## API
 
- [`later`](#later)
 
### `later`

```ts
later<T>(fn: () => T, ms?: number): Promise<T>
later<T>(fn: () => Promise<T>, ms?: number): Promise<T>
later<T>(value: T, ms?: number): Promise<T>
later<T>(promise: Promise<T>, ms?: number): Promise<T>
```

`later` resolves a value or function after a delay. It wraps JavaScript's `setTimeout` as a promise. It is especially helpful in testing async programs to create artificial delays that work with `await`. The input can be any of the following:

- [A synchronous function](#synchronous-function)
- [An async function](#async-function)
- [A promise](#existing-promise)
- [A literal value](#literal-value)

Note that if the `ms` timeout is less than or equal to zero, the call will be rejected immediately even if an input promise was already resolved.
 
#### Synchronous function

With a synchronous function, `later` works identically to `setTimeout` except that it returns a promise. 

```ts
// Before
setTimeout(() => console.log('hello'), 10);

// After 
later(() => console.log('hello'), 10); 
```

The promise resolves to whatever value is returned by the callback.

```ts 
const promise = later(() => {
  console.log('hello');
  return 'world'
}, 10); 
const result = await promise;
console.log(result); // world
```

#### Async function

If the value provided to `later` itself returns a promise, then that promise will be awaited before `later` resolves. Note that the callback will not be **started** until the timeout expires, so the total time before the function resolves may be longer than `ms`. If you simply wish to set a timeout for how long an async function may take, use [`limit`](#limit).

```ts 
const promise = later(() => Promise.resolve('hello'), 10);
const result = await promise;
console.log(result); // hello
```
 
#### Existing promise

An existing promise will be `await` ed after the timeout to resolve the final value. 

```ts
const innerPromise = Promise.resolve('hello');
const promise = later(innerPromise, 10);
const result = await promise;
console.log(result); // hello
```

#### Literal value

Any value that is not a function or promise will be used as is to resolve the promise after the timeout:

```ts
const promise = later('hello', 10);
const result = await promise;
console.log(result); // hello
```
