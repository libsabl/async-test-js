// Copyright 2022 Joshua Honig. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

import { isPromise } from 'util/types';
import { CallbackPromise, promise } from '@sabl/async';

type TimelineCallback = () => unknown;

interface TimelineAPI {
  /** Start the timeline loop */
  start(): void;

  /** Stop the timeline loop and clear any callbacks */
  reset(): Promise<void>;

  /** Execute a single tick */
  next(): Promise<void>;

  /**
   * Async await a number of ticks. Cannot be called
   * from within a callback, but can be used outside the
   * timeline to allow the timeline to advance a
   * specified number of frames.
   */
  wait(ticks: number): Promise<void>;

  /**
   * Schedule a call back to be executed in a number
   * of ticks. Returns a unique id for the callback.
   * If `ticks` is 0, then the callback is queued within
   * the current frame.
   */
  setTimeout(cb: () => unknown, ticks: number): number;

  /** Clear a scheduled callback by its id */
  clearTimeout(id: number): boolean;

  /** Await all scheduled callbacks to complete */
  drain(): Promise<void>;

  /** The current tick number */
  get tick(): number;

  /** Whether the timeline is running */
  get running(): boolean;

  /** Whether the timeline is drained */
  get drained(): boolean;
}

type CallbackInfo = {
  fn: TimelineCallback;
  id: number;
  tick: number;
};

function safe(fn: TimelineCallback): unknown {
  try {
    return fn();
  } catch {
    /** ignore */
  }
}

/**
 * Timeline is a deterministic async timeline. It schedules
 * callbacks to be executed after a number of ticks instead
 * of milliseconds, and guarantees that callbacks will
 * be executed on the exact scheduled tick index. It's purpose
 * is for testing async lifecycles where the exact order
 * of events matters.
 */
export class Timeline implements TimelineAPI {
  /**
   * Create a new timeline.
   *
   * Timeline executes callbacks one frame at a time in deterministic
   * order, with additive frame numbers respected. If any callbacks
   * return a promise then those promises will be awaited before
   * advancing to the next frame.
   *
   * The `tickMs` parameter determines the number of platform ms to wait
   * before starting the next tick. If null, there is no pause between ticks
   * but the timeline will idle when drained.
   *
   * If 0 or positive, the platform
   * setTimeout(..., tickMs) will be awaited between ticks, and ticking
   * will continue until the timeline is reset even if there are no
   * callbacks scheduled.
   *
   * @param tickMs
   */
  constructor(tickMs?: number) {
    this.#tickMs = tickMs || null;
    this.#autoTick = tickMs != null && tickMs >= 0;
  }

  get tick(): number {
    return this.#tick;
  }

  get running(): boolean {
    return this.#running;
  }

  get drained(): boolean {
    return this.#drained;
  }

  start(): void {
    if (this.#running) {
      throw new Error('Timeline already running');
    }
    this.#run();
  }

  next(): Promise<void> {
    if (this.#running) {
      throw new Error('Cannot tick while timeline is running');
    }
    this.#running = true;
    try {
      return this.#next(false);
    } finally {
      this.#running = false;
    }
  }

  reset(): Promise<void> {
    if ((!this.#running || this.#drained) && !this.#autoTick) {
      this.#completeReset();
      return Promise.resolve();
    }

    this.#canceling = true;
    return (this.#waitReset = this.#waitReset || promise<void>());
  }

  wait(ticks: number): Promise<void> {
    if (this.#isAwaiting) {
      throw new Error('Cannot wait from within an async callback');
    }
    return new Promise((resolve) => this.setTimeout(resolve, ticks));
  }

  setTimeout(fn: () => unknown, ticks = 0): number {
    if (ticks < 0) {
      throw new Error('ticks cannot be negative');
    }

    const wasDrained = this.#drained;

    this.#drained = false;
    const id = this.#nextId++;
    const info: CallbackInfo = { fn, id, tick: this.#tick + ticks };

    this.#map[id] = info;

    if (ticks === 0) {
      this.#currentFrame.push(info);
    } else {
      const stack = (this.#buffer[ticks - 1] = this.#buffer[ticks - 1] || []);
      stack.push(info);
    }

    if (this.#running && wasDrained && !this.#autoTick) {
      // Restart loop
      this.#run();
    }

    return id;
  }

  clearTimeout(id: number): boolean {
    const info = this.#map[id];
    if (info == null) return false;

    // Delete from map
    delete this.#map[info.id];

    // Also remove from callback stack if present
    const relativeTick = info.tick - this.#tick - 1;

    let stack: CallbackInfo[];
    if (relativeTick < 0) {
      stack = this.#currentFrame;
    } else {
      stack = this.#buffer[relativeTick];
    }

    const ix = stack.indexOf(info);
    stack.splice(ix, 1);

    return true;
  }

  drain(): Promise<void> {
    if (!this.#running || this.#drained) {
      return Promise.resolve();
    }
    return (this.#waitDrain = this.#waitDrain || promise<void>());
  }

  #tickMs: number | null = null;
  #autoTick = false;
  #nextId = 1;
  #tick = 0;
  #canceling = false;
  #running = false;
  #drained = true;
  #waitReset: CallbackPromise<void> | null = null;
  #waitDrain: CallbackPromise<void> | null = null;
  #isAwaiting = false;

  readonly #map: { [index: number]: CallbackInfo } = {};
  readonly #buffer: CallbackInfo[][] = [];
  #currentFrame: CallbackInfo[] = [];

  async #next(canCancel: boolean) {
    // Pre-frame flush current
    while (this.#currentFrame.length) {
      const current = this.#currentFrame.splice(0, this.#currentFrame.length);
      if (!(await this.#exec(canCancel, current))) return;
    }

    // Increment frame
    const stack = this.#buffer.shift();
    this.#tick += 1;

    // Run queued frame
    if (!(await this.#exec(canCancel, stack))) return;

    // End-of-frame flush current
    while (this.#currentFrame.length) {
      const current = this.#currentFrame.splice(0, this.#currentFrame.length);
      if (!(await this.#exec(canCancel, current))) return;
    }
  }

  async #exec(
    canCancel: boolean,
    stack: CallbackInfo[] | undefined
  ): Promise<boolean> {
    if (stack == undefined || stack.length == 0) {
      return true;
    }

    // Start all callbacks at the same time
    const results: unknown[] = [];
    for (const info of stack) {
      delete this.#map[info.id];
      results.push(safe(info.fn));

      if (canCancel && this.#canceling) {
        this.#completeReset();
        return false;
      }
    }

    // Also await all callbacks to complete
    for (const res of results) {
      if (canCancel && this.#canceling) {
        this.#completeReset();
        return false;
      }

      if (res != null && isPromise(res)) {
        this.#isAwaiting = true;
        try {
          await res;
        } catch {
          /* ignore errors */
        } finally {
          this.#isAwaiting = false;
        }
      }
    }

    return true;
  }

  async #run() {
    this.#running = true;

    while (this.#buffer.length || this.#currentFrame.length) {
      if (this.#canceling) {
        this.#completeReset();
        return;
      }

      await this.#next(true);

      if (this.#autoTick) {
        setTimeout(() => {
          this.#run();
        }, this.#tickMs!);
        return;
      }
    }

    this.#resolveDrain();

    if (this.#autoTick) {
      if (this.#canceling) {
        this.#completeReset();
        return;
      }

      // Empty buffer but need to auto-tick.
      // Wait AT LEAST 1 ms to avoid infinite
      // loop. Also force-advance tick # by 1.
      this.#tick++;

      setTimeout(() => {
        this.#run();
      }, Math.max(1, this.#tickMs!));
    }
  }

  #completeReset() {
    this.#canceling = false;
    this.#running = false;
    this.#tick = 0;
    this.#buffer.splice(0, this.#buffer.length);

    this.#resolveReset();
    this.#resolveDrain();
  }

  #resolveDrain() {
    this.#drained = true;
    const wd = this.#waitDrain;
    if (wd != null) {
      this.#waitDrain = null;
      wd.resolve();
    }
  }

  #resolveReset() {
    const wr = this.#waitReset;
    if (wr != null) {
      this.#waitReset = null;
      wr.resolve();
    }
  }
}
