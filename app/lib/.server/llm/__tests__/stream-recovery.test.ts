import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamRecoveryManager } from '~/lib/.server/llm/stream-recovery';

/**
 * The inactivity watchdog, and how much it costs to feed.
 *
 * It is fed once per streamed chunk — once per token — so a page-sized answer
 * calls it a few thousand times. It used to rebuild its timer on every one of
 * those calls, which is a few thousand clearTimeout/setTimeout pairs per
 * request, spent answering a question that cannot change more than once a
 * second. On Cloudflare that work is charged against the request's CPU
 * budget, and long builds were being cut off mid-file with no error at all.
 */
describe('the stream watchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires when nothing arrives for the whole timeout', () => {
    const onTimeout = vi.fn();
    const m = new StreamRecoveryManager({ timeout: 1000, onTimeout });
    m.startMonitoring();

    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    m.stop();
  });

  it('does not fire while data keeps arriving', () => {
    const onTimeout = vi.fn();
    const m = new StreamRecoveryManager({ timeout: 1000, onTimeout });
    m.startMonitoring();

    /* A chunk every 100ms for five seconds — five times the timeout. */
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(100);
      m.updateActivity();
    }

    expect(onTimeout).not.toHaveBeenCalled();
    m.stop();
  });

  /* The whole point: feeding it costs nothing but a timestamp. */
  it('allocates no timers at all while chunks stream in', () => {
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const m = new StreamRecoveryManager({ timeout: 60_000 });
    m.startMonitoring();

    const before = setSpy.mock.calls.length;

    /* Two thousand chunks — a realistic page of tokens. */
    for (let i = 0; i < 2000; i++) {
      vi.advanceTimersByTime(5);
      m.updateActivity();
    }

    expect(setSpy.mock.calls.length - before).toBe(0);

    m.stop();
    setSpy.mockRestore();
  });

  /*
   * The timer is a floor, not a verdict: when it fires it asks how long it
   * has really been since a chunk, and reschedules for the remainder.
   */
  it('measures the deadline from the last chunk, not from the last timer', () => {
    const onTimeout = vi.fn();
    const m = new StreamRecoveryManager({ timeout: 5000, onTimeout });
    m.startMonitoring();

    vi.advanceTimersByTime(4000);
    m.updateActivity();

    /* The original timer comes due here, but data arrived a second ago. */
    vi.advanceTimersByTime(1500);
    expect(onTimeout).not.toHaveBeenCalled();

    /* Five seconds after that last chunk, and only then. */
    vi.advanceTimersByTime(3600);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    m.stop();
  });

  it('stops for good once stopped', () => {
    const onTimeout = vi.fn();
    const m = new StreamRecoveryManager({ timeout: 1000, onTimeout });
    m.startMonitoring();
    m.stop();

    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
