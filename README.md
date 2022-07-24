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
 
- [`promise`](#promise)
- [`limit`](#limit)
- [`later`](#later)
 
### `promise`

```ts
function promise<T>(): CallbackPromise<T>;

interface CallbackPromise<T> extends Promise<T> {
  resolve(value: T | PromiseLike<T>): void;
  reject(reason: unknown): void;
} 
```

`promise` returns an actual [`Promise`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) which also exposes its own `resolve` and `reject` callbacks. This is very helpful for bridging or wrapping event- and callback-based programs to expose APIs as simple Promises that can be `awaited`. In particular, it allows queued requests to be resolved as promises.

#### **Example**: an async queue.

```ts
class AsyncQueue<T> {
  readonly #itemQueue: T[] = [];
  readonly #reqQueue: CallbackPromise<T>[] = [];

  // Await the next value available in the queue
  get(): Promise<T> {
    if(this.#itemQueue.length > 0) {
      return Promise.resolve(this.#itemQueue.shift());
    }

    const p = promise<T>();
    this.#reqQueue.push(p);
    return p;
  }

  // Put an item in the queue
  put(item: T): void {
    if(this.#reqQueue.length > 0) {
      this.#reqQueue.shift().resolve(item);
      return;
    }
    this.#itemQueue.push(item);
  }
}
```

### Cancelable `promise`

```ts
function promise<T>(ctx: IContext): CallbackPromise<T>;

function isCanceled(reason: unknown): boolean;
```

`promise` also supports an overload which accepts a [context](https://). If the context is cancelable, and the context is canceled before the promise is resolved, then the promise is automatically rejected with a cancellation error.

The helper function `isCanceled` checks a rejection reason or error value to detect if the error represents an automatic cancellation.

#### **Example revisited**: Async queue with cancelable get:

```ts
class AsyncQueue<T> {
  readonly #itemQueue: T[] = [];
  readonly #reqQueue: CallbackPromise<T>[] = [];

  // Await the next value available in the queue
  get(ctx?: IContext): Promise<T> {
    if(this.#itemQueue.length > 0) {
      return Promise.resolve(this.#itemQueue.shift());
    }

    const p = promise<T>(ctx);
    this.#reqQueue.push(p);

    const wrapped = p.catch((reason) => {
      if(isCanceled(reason)) {
        // Request was canceled. Remove from queue
        this.#reqQueue.splice(this.#reqQueue.indexOf(p));
      }
      throw reason;
    })

    return wrapped;
  }

  // Put an item in the queue
  put(item: T): void {
    if(this.#reqQueue.length > 0) {
      this.#reqQueue.shift().resolve(item);
      return;
    }
    this.#itemQueue.push(item);
  }
}
```

### `limit`

```ts
limit<T>(promise: Promise<T>, ms: number): Promise<T>
limit<T>(promise: Promise<T>, deadline: Date): Promise<T>
limit<T>(promise: Promise<T>, ctx: IContext): Promise<T>
```

`limit` awaits an input promise, but rejects it automatically if it has not completed by a timeout determined by any of the following:

- A relative timeout in milliseconds
- An absolute `Date` deadline
- A cancelable context

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
