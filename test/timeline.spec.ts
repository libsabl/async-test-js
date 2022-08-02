// Copyright 2022 Joshua Honig. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

import { limit, wait } from '@sabl/async';
import { later, Timeline } from '$';

function makeLog(tl?: Timeline) {
  const msgs: string[] = [];
  let log: (msg: string) => void;

  if (tl == null) {
    log = (msg: string) => msgs.push(msg);
  } else {
    log = (msg: string) => msgs.push(tl.tick.toString() + ': ' + msg);
  }
  return { msgs, log };
}

function noOp() {
  /* nothing */
}

function noOpAsync() {
  /* nothing */
  return Promise.resolve();
}

describe('setTimeout', () => {
  it('schedules callback in the future', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    tl.setTimeout(() => log('one'), 2);
    tl.setTimeout(() => log('two'), 1);
    tl.setTimeout(() => log('three'));

    tl.start();
    await tl.drain();

    expect(msgs).toEqual(['0: three', '1: two', '2: one']);
  });

  it('schedules same tick from within callback', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    tl.setTimeout(() => tl.setTimeout(() => log('a')), 2);
    tl.setTimeout(() => log('b'), 2);

    tl.start();
    await tl.drain();

    expect(msgs).toEqual(['2: b', '2: a']);
  });

  it('restarts loop if already running but drained', async () => {
    const tl = new Timeline();
    tl.setTimeout(noOpAsync, 2);
    tl.start();

    expect(tl.running).toBe(true);
    expect(tl.drained).toBe(false);

    await tl.drain();

    expect(tl.tick).toBe(2);
    expect(tl.running).toBe(true);
    expect(tl.drained).toBe(true);

    await wait(10);

    // Still 3, because loop stops when drained
    expect(tl.tick).toBe(2);

    tl.setTimeout(noOp, 2);

    expect(tl.running).toBe(true);
    expect(tl.drained).toBe(false);

    await tl.drain();

    expect(tl.tick).toBe(4);
    expect(tl.running).toBe(true);
    expect(tl.drained).toBe(true);
  });

  it('rejects negative ticks', () => {
    const tl = new Timeline();
    expect(() => tl.setTimeout(noOp, -1)).toThrow('ticks cannot be negative');
  });

  it('schedules current frame callback on running timeline', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    tl.start();

    await wait(20);

    // Still 0, never got any callbacks
    expect(tl.tick).toBe(0);

    tl.setTimeout(() => log('same frame -- which frame?'));

    expect(msgs).toEqual(['0: same frame -- which frame?']);

    await tl.drain();

    expect(tl.tick).toBe(1);
  });

  it('intuitively adds frame counts', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    tl.setTimeout(() => log('frame 1'), 1);
    tl.setTimeout(() => log('frame 2'), 2);

    tl.setTimeout(() => {
      log('scheduling from frame 2');
      tl.setTimeout(() => log('frame 2 + 2 = 4'), 2);
    }, 2);

    tl.setTimeout(() => {
      log('scheduling from frame 1');
      tl.setTimeout(() => {
        log('scheduling from frame 1 + 3 = 4');
        tl.setTimeout(() => log('frame 1 + 3 + 2 = 6'), 2);
      }, 3);

      tl.setTimeout(() => log('frame 1 + 0 = still 1'), 0);
    }, 1);

    tl.start();
    await tl.drain();

    expect(msgs).toEqual([
      '1: frame 1',
      '1: scheduling from frame 1',
      '1: frame 1 + 0 = still 1',
      '2: frame 2',
      '2: scheduling from frame 2',
      '4: scheduling from frame 1 + 3 = 4',
      '4: frame 2 + 2 = 4',
      '6: frame 1 + 3 + 2 = 6',
    ]);
  });
});

describe('clearTimeout', () => {
  it('clears scheduled callback', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    const id1 = tl.setTimeout(() => log('run1'), 3);
    const id2 = tl.setTimeout(() => log('run2'), 3);

    await tl.next();
    expect(tl.tick).toBe(1);
    expect(msgs).toEqual([]);

    await tl.next();
    expect(tl.tick).toBe(2);
    expect(msgs).toEqual([]);

    expect(tl.clearTimeout(id1)).toBe(true);

    await tl.next();
    expect(tl.tick).toBe(3);
    expect(msgs).toEqual(['3: run2']);

    expect(tl.clearTimeout(id2)).toBe(false);
  });

  it('clears scheduled callback within same frame', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    const id1 = tl.setTimeout(() => log('run1'));
    const id2 = tl.setTimeout(() => log('run2'));

    expect(tl.clearTimeout(id1)).toBe(true);

    await tl.next();
    expect(tl.tick).toBe(1);
    expect(msgs).toEqual(['0: run2']);

    expect(tl.clearTimeout(id2)).toBe(false);
  });
});

describe('drain', () => {
  it('returns immediately if not running', async () => {
    const tl = new Timeline();
    await limit(tl.drain(), 0);
  });

  it('returns immediately if already drained', async () => {
    const tl = new Timeline();
    tl.setTimeout(noOp, 3);
    tl.setTimeout(noOp, 6);

    tl.start();

    await limit(tl.drain(), 0);
  });

  it('resolves when drained and still running', async () => {
    const tl = new Timeline();
    tl.setTimeout(async () => {
      await wait(2);
      tl.setTimeout(noOp, 3);
    }, 3);

    tl.start();

    const pDrain = tl.drain();

    await wait(1);

    expect(tl.drained).toBe(false);

    await pDrain;

    expect(tl.drained).toBe(true);
  });
});

describe('start', () => {
  it('stops ticking if wait = null', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);
    tl.start();

    await wait(10);

    expect(tl.tick).toBe(0);

    tl.setTimeout(() => log('frame 123'), 123);

    // Zips ahead
    await wait(1);

    expect(tl.tick).toBe(123);
    expect(msgs).toEqual(['123: frame 123']);

    await wait(10);

    // Still frame 123
    expect(tl.tick).toBe(123);
  });

  it('keeps ticking until reset if wait >= 0', async () => {
    const tl = new Timeline(0);
    const { msgs, log } = makeLog(tl);
    tl.start();

    await wait(10);

    const tick = tl.tick;
    expect(tick).toBeGreaterThan(1);

    tl.setTimeout(() => log('frame 10'), 10 - tick);
    tl.setTimeout(() => log('frame 20'), 20 - tick);

    await tl.drain();
    await tl.reset();

    expect(msgs).toEqual(['10: frame 10', '20: frame 20']);
  });

  it('throws if already running', () => {
    const tl = new Timeline();
    tl.start();
    expect(() => tl.start()).toThrow('already running');
  });

  it('throws if in a tick', async () => {
    const tl = new Timeline();
    expect.assertions(2);
    tl.setTimeout(() => {
      expect(tl.running).toBe(true);
      expect(() => tl.start()).toThrow('already running');
    });
    await tl.next();
  });
});

describe('next', () => {
  it('executes the next tick', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);
    tl.setTimeout(() => log('hello'), 1);

    await tl.next();

    expect(msgs).toEqual(['1: hello']);
    expect(tl.tick).toBe(1);
    expect(tl.running).toBe(false);
  });

  it('flushes current frame callbacks first', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);
    tl.setTimeout(() => log('hello'), 1);
    tl.setTimeout(() => log('now'));

    await tl.next();

    expect(msgs).toEqual(['0: now', '1: hello']);
    expect(tl.tick).toBe(1);
    expect(tl.running).toBe(false);
  });

  it('flushes current frame callbacks first - recursive', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    tl.setTimeout(() => log('hello'), 1);

    tl.setTimeout(() => {
      tl.setTimeout(() => {
        tl.setTimeout(() => {
          tl.setTimeout(() => log('now'));
        });
      });
    });

    await tl.next();

    expect(msgs).toEqual(['0: now', '1: hello']);
    expect(tl.tick).toBe(1);
    expect(tl.running).toBe(false);
  });

  it('flushes running frame callbacks at end of frame', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    tl.setTimeout(() => tl.setTimeout(() => log('same frame')), 1);
    tl.setTimeout(() => log('hello'), 1);

    await tl.next();

    expect(msgs).toEqual(['1: hello', '1: same frame']);
    expect(tl.tick).toBe(1);
    expect(tl.running).toBe(false);
  });

  it('flushes running frame callbacks at end of frame - recursive', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    tl.setTimeout(
      () =>
        tl.setTimeout(() =>
          tl.setTimeout(() => tl.setTimeout(() => log('same frame')))
        ),
      1
    );
    tl.setTimeout(() => log('hello'), 1);

    await tl.next();

    expect(msgs).toEqual(['1: hello', '1: same frame']);
    expect(tl.tick).toBe(1);
    expect(tl.running).toBe(false);
  });

  it('awaits resolution of all callbacks within the tick', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);
    tl.setTimeout(() => {
      log('now 1');
      return later(() => log('later: 100'), 100);
    }, 1);
    tl.setTimeout(() => {
      log('now 2');
      return later(() => log('later: 50'), 50);
    }, 1);
    tl.setTimeout(() => log('now 3'), 1);

    await tl.next();

    expect(msgs).toEqual([
      '1: now 1',
      '1: now 2',
      '1: now 3',
      '1: later: 50',
      '1: later: 100',
    ]);
    expect(tl.tick).toBe(1);
    expect(tl.running).toBe(false);
  });

  it('aborts if canceled while awaiting', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    tl.setTimeout(async () => {
      log('now 1');
      await wait(100);
      if (tl.running) {
        log('later 1');
      }
    }, 1);

    tl.setTimeout(async () => {
      log('now 2');
      await wait(100);
      if (tl.running) {
        log('later 2');
      }
    }, 1);

    tl.setTimeout(() => log('now 3'), 1);

    tl.setTimeout(() => {
      tl.reset();
      return;
    }, 1);

    tl.start();
    await tl.drain();

    expect(msgs).toEqual(['1: now 1', '1: now 2', '1: now 3']);
    expect(tl.tick).toBe(0);
    expect(tl.running).toBe(false);
  });

  it('throws if already running', () => {
    const tl = new Timeline();
    tl.start();
    expect(() => tl.next()).toThrow('Cannot tick while timeline is running');
  });

  it('throws if in a tick', async () => {
    const tl = new Timeline();
    expect.assertions(2);
    tl.setTimeout(() => {
      expect(tl.running).toBe(true);
      expect(() => tl.next()).toThrow('Cannot tick while timeline is running');
    });
    await tl.next();
  });
});

describe('reset', () => {
  it('returns immediately if not running', async () => {
    const tl = new Timeline();
    expect(limit(tl.reset(), 0)).resolves.toBe(undefined);
  });

  it('returns immediately if already drained', async () => {
    const tl = new Timeline();
    tl.start();
    expect(limit(tl.reset(), 0)).resolves.toBe(undefined);
  });

  it('can cancel from within synchronous pre-frame callback', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);
    tl.setTimeout(() => log('frame 0'));
    tl.setTimeout(() => {
      log('resetting from frame 0');
      tl.reset();
    });
    tl.setTimeout(() => log('still frame 0'));
    tl.setTimeout(() => log('frame 1'), 1);

    tl.start();
    await tl.drain();

    expect(msgs).toEqual(['0: frame 0', '0: resetting from frame 0']);
  });

  it('can cancel from within async pre-frame callback', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);
    tl.setTimeout(() => log('frame 0'));
    tl.setTimeout(async () => {
      log('starting async callback in frame 0');
      await wait(10);
      log('resetting from frame 0');
      tl.reset();
    });
    tl.setTimeout(() => log('still frame 0'));
    tl.setTimeout(() => log('frame 1'), 1);

    tl.start();
    await tl.drain();

    expect(msgs).toEqual([
      '0: frame 0',
      '0: starting async callback in frame 0',
      '0: still frame 0',
      '0: resetting from frame 0',
    ]);
  });

  it('can cancel from within synchronous normal callback', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);
    tl.setTimeout(() => log('frame 1'), 1);
    tl.setTimeout(() => {
      log('resetting from frame 1');
      tl.reset();
    }, 1);
    tl.setTimeout(() => log('still frame 1'), 1);
    tl.setTimeout(() => log('frame 2'), 2);

    tl.start();
    await tl.drain();

    expect(msgs).toEqual(['1: frame 1', '1: resetting from frame 1']);
  });

  it('can cancel from within async normal callback', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);
    tl.setTimeout(() => log('frame 1'), 1);
    tl.setTimeout(async () => {
      log('starting async callback in frame 1');
      await wait(10);
      log('resetting from frame 1');
      tl.reset();
    }, 1);
    tl.setTimeout(() => log('still frame 1'), 1);
    tl.setTimeout(() => log('frame 2'), 2);

    tl.start();
    await tl.drain();

    expect(msgs).toEqual([
      '1: frame 1',
      '1: starting async callback in frame 1',
      '1: still frame 1',
      '1: resetting from frame 1',
    ]);
  });

  it('can cancel from within synchronous tail callback', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);
    tl.setTimeout(() => log('frame 1'), 1);
    tl.setTimeout(() => {
      log('normal frame 1 callback');
      tl.setTimeout(() => {
        log('resetting from tail of frame 1');
        tl.reset();
      });
    }, 1);
    tl.setTimeout(() => log('still frame 1'), 1);
    tl.setTimeout(() => log('frame 2'), 2);

    tl.start();
    await tl.drain();

    expect(msgs).toEqual([
      '1: frame 1',
      '1: normal frame 1 callback',
      '1: still frame 1',
      '1: resetting from tail of frame 1',
    ]);
  });

  it('can cancel from within async tail callback', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);
    tl.setTimeout(() => log('frame 1'), 1);
    tl.setTimeout(() => {
      log('normal frame 1 callback');

      tl.setTimeout(async () => {
        log('starting async callback in frame 1 tail');
        await wait(10);
        log('resetting from frame 1 tail');
        tl.reset();
      });
    }, 1);
    tl.setTimeout(() => log('still frame 1'), 1);
    tl.setTimeout(() => log('frame 2'), 2);

    tl.start();
    await tl.drain();

    expect(msgs).toEqual([
      '1: frame 1',
      '1: normal frame 1 callback',
      '1: still frame 1',
      '1: starting async callback in frame 1 tail',
      '1: resetting from frame 1 tail',
    ]);
  });
});

describe('wait', () => {
  it('waits specified number of ticks', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    tl.setTimeout(() => {
      log('frame 2 from a callback');
    }, 2);

    const wait2 = tl.wait(2);
    tl.start();

    await wait2;

    log('frame 2 from outside world');

    await tl.wait(3);

    log('frame 5 from outside world');

    await tl.drain();

    expect(msgs).toEqual([
      '2: frame 2 from a callback',
      '2: frame 2 from outside world',
      '5: frame 5 from outside world',
    ]);
  });

  it('is illegal to call wait from within an async callback', async () => {
    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    expect.assertions(2);
    tl.setTimeout(async () => {
      log('frame 2 from a callback');

      await wait(1);

      expect(() => tl.wait(2)).toThrow(
        'Cannot wait from within an async callback'
      );
    }, 2);

    tl.start();
    await tl.drain();
    expect(msgs).toEqual(['2: frame 2 from a callback']);
  });
});

describe('interleave', () => {
  it('maintains deterministic frames', async () => {
    const stack: number[] = [];
    let n = 0;

    const tl = new Timeline();
    const { msgs, log } = makeLog(tl);

    const pop = async (cnt = 1, delay = 0) => {
      const val = stack.pop();
      log(`pop  ${val}`);

      if (cnt > 1) {
        tl.setTimeout(() => pop(cnt - 1, delay), delay);
      } else {
        log('resetting');
        tl.reset();
      }
      await wait(3);
    };

    const push = async (cnt = 1, delay = 0) => {
      const val = n++;
      log(`push ${val}`);
      stack.push(val);
      if (cnt > 1) {
        tl.setTimeout(() => push(cnt - 1, delay), delay);
      }
      await wait(1);
    };

    const logTick = () => {
      log(`log [${stack.join(', ')}]`);
      if (tl.running) {
        tl.setTimeout(logTick, 1);
      }
    };

    tl.setTimeout(() => push(5, 1));
    tl.setTimeout(logTick);
    tl.setTimeout(() => pop(5, 2), 2);
    tl.start();

    await tl.drain();

    expect(msgs).toEqual([
      '0: push 0',
      '0: log [0]',
      '1: push 1',
      '1: log [0, 1]',
      '2: pop  1',
      '2: push 2',
      '2: log [0, 2]',
      '3: push 3',
      '3: log [0, 2, 3]',
      '4: pop  3',
      '4: push 4',
      '4: log [0, 2, 4]',
      '5: log [0, 2, 4]',
      '6: pop  4',
      '6: log [0, 2]',
      '7: log [0, 2]',
      '8: pop  2',
      '8: log [0]',
      '9: log [0]',
      '10: pop  0',
      '10: resetting',
    ]);
  });
});
