<!-- BEGIN:REMOVE_FOR_NPM -->
[![codecov](https://codecov.io/gh/libsabl/async-test-js/branch/main/graph/badge.svg?token=TVL1XYSJHA)](https://app.codecov.io/gh/libsabl/async-test-js/branch/main)
<span class="badge-npmversion"><a href="https://npmjs.org/package/@sabl/async-test" title="View this project on NPM"><img src="https://img.shields.io/npm/v/@sabl/async-test.svg" alt="NPM version" /></a></span>

<!-- END:REMOVE_FOR_NPM -->

# @sabl/async-test

**async-test** contains several simple utilities for **testing** concurrent or async programs in JavaScript and TypeScript. Several of the utilities use the [context pattern](https://github.com/libsabl/patterns/blob/main/patterns/context.md) implemented in [`@sabl/context`](https://npmjs.com/package/@sabl/context) to implement automatic async cancellation. It builds on [`@sabl/async`](https://github.com/libsabl/async-js), which contains utilities that are useful in both test and production scenarios.
    
<!-- BEGIN:REMOVE_FOR_NPM -->
> [**sabl**](https://github.com/libsabl/patterns) is an open-source project to identify, describe, and implement effective software patterns which solve small problems clearly, can be composed to solve big problems, and which work consistently across many programming languages.

## Developer orientation

See [SETUP.md](./docs/SETUP.md), [CONFIG.md](./docs/CONFIG.md).
<!-- END:REMOVE_FOR_NPM -->

## API
 
- [`later`](#later)
- [`Timeline`](#timeline)
  
## `later`

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
 
### Synchronous function

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

### Async function

If the value provided to `later` itself returns a promise, then that promise will be awaited before `later` resolves. Note that the callback will not be **started** until the timeout expires, so the total time before the function resolves may be longer than `ms`. If you simply wish to set a timeout for how long an async function may take, use [`limit`](#limit).

```ts 
const promise = later(() => Promise.resolve('hello'), 10);
const result = await promise;
console.log(result); // hello
```
 
### Existing promise

An existing promise will be `await` ed after the timeout to resolve the final value. 

```ts
const innerPromise = Promise.resolve('hello');
const promise = later(innerPromise, 10);
const result = await promise;
console.log(result); // hello
```

### Literal value

Any value that is not a function or promise will be used as is to resolve the promise after the timeout:

```ts
const promise = later('hello', 10);
const result = await promise;
console.log(result); // hello
```

## `wait`
```ts
wait<T>(ms: number): Promise<T>
wait<T>(deadline: Date): Promise<T>
wait<T>(ctx: IContext): Promise<T>
``` 

`wait` returns a promise that resolves in the future based on any of the following:

- A relative timeout in milliseconds
- An absolute `Date` deadline
- A cancelable context

`wait` resolves immediately for a negative `ms`, a past `deadline`, or a context that is either non-cancelable or is already canceled.

## `Timeline`

```ts
export class Timeline {
  constructor(tickMs?: number);

  get tick(): number;
  get running(): boolean;
  get drained(): boolean;

  setTimeout(cb: () => unknown, ticks: number): number;
  clearTimeout(id: number): boolean;
  wait(ticks: number): Promise<void>;
  
  start(): void;
  reset(): Promise<void>;
  next(): Promise<void>;
  drain(): Promise<void>;
}
```

`Timeline` schedules callbacks to be executed in a deterministic order one frame at a time. It designed to set up tests of async programs where the exact order of async events matters. Frame numbers add up intuitively for understandable ordering.

`Timeline`'s `setTimeout` and `clearTimeout` methods are replacements for using the otherwise builtin `setTimeout` and `clearTimeout`, which do not actually guarantee that a callback will be executed after the exact number of ms specified.
`

### constructor 

```ts
new Timeline(tickMs?: number) 
```

The constructor accepts a single options parameter `tickMs`, which determines the number of platform ms to wait before starting the next tick. If null, there is no pause between ticks but the timeline will idle when drained.

If 0 or positive, the platform setTimeout(..., tickMs) will be awaited between ticks, and ticking will continue until the timeline is reset even if there are no callbacks scheduled.

### `tick`

The current tick number.

### `running`

Whether the timeline is running.

### `drained`

`true` if there are no scheduled callbacks

### `setTimeout(fn, ticks = 0)`

Schedule a callback to be executed `ticks` ticks in the future. Can be called from within a callback. Returns an id which can be used to clear the callback.

**If `ticks` is exactly 0**:
- If timeline has not yet started, callback will be invoked before the first (frame 1) tick
- If timeline is running, callback will be invoked at the end of the current tick
- Same-frame scheduling is respected recursively, including for async callbacks


### `clearTimeout(id)`

Clear a previously scheduled callback using its `id` value as returned from `setTimeout`.

### `wait(ticks)`

Returns a promise which will be resolved after `ticks` ticks. Useful for succinctly awaiting in tests to let a certain number of frames complete, regardless of how long that takes in real time.

### `start()`

Start the timeline.

- **If `tickMs` provided to constructor is >= 0**

  Timeline will continue ticking indefinitely until `reset()` is called, and will wait `tickMs` milliseconds between ticks using the platform `setTimeout`.

- **If `tickMs` is empty (default)**

  Timeline will cycle without stopping through all scheduled frames. When all callbacks have been cleared or called, the timeline will pause until `setTimeout` is called again.

### `drain()`

Returns a promise which will resolve when all scheduled callbacks have been cleared or executed.

### `reset()`

Cancels and clears all pending callbacks, stops ticking, and resets tick number to 0.

### `next()`

Advance a single tick on a timeline that was never started. Can be used to manually tick forward one frame at a time. Returns a promise which resolves when all callbacks from the frame have been executed, and any promises returned from them have resolved or rejected.

### Example

A contrived example that demonstrates deterministic ordering and additive frame numbers:


```ts
const tl = new Timeline();
const log: string[] = [];
const logTick = (msg: string) => log.push(`tick ${tl.tick} : ` + msg);

tl.setTimeout(() => logTick('E @ 3'), 3); 

tl.setTimeout(() => { 
  tl.setTimeout(() => logTick('G @ 3 + 3 = 6'), 3);
}, 3);

tl.setTimeout(async () => {
  logTick('A @ 1');  
  
  await new Promise(resolve => setTimeout(resolve, 500));

  tl.setTimeout(() => {
    logTick('B @ 1 + 1 = 2'); 

    tl.setTimeout(() => logTick('F @ 1 + 1 + 3 = 5'), 3);
    tl.setTimeout(() => logTick('C @ 1 + 1 + 0 = still 2'), 0);
    tl.setTimeout(() => {
      tl.setTimeout(() => {
        tl.setTimeout(() => {
          logTick('D @ 1 + 1 + 0 + 0 + 0 = *still* 2')
        }, 0);
      }, 0);
    }, 0);
  }, 1);
}, 1);

tl.setTimeout(() => logTick('pre-tick @ 0')); // Can omit 0 timeout

tl.start();

await tl.drain();

console.log(log.join('\n'));

// tick 0: pre-tick @ 0
// tick 1: A @ 1 
// tick 2: B @ 1 + 1 = 2
// tick 2: C @ 1 + 1 + 0 = still 2
// tick 2: D @ 1 + 1 + 0 + 0 + 0 = *still* 2
// tick 3: E @ 3
// tick 5: F @ 1 + 1 + 3 = 5
// tick 6: G @ 3 + 3 = 6
```

