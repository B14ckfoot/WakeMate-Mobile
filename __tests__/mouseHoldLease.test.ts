import { MouseHoldLease } from '../src/services/mouseHoldLease';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};

describe('serialized remote mouse hold', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const setup = () => {
    const down = jest.fn<Promise<unknown>, []>().mockResolvedValue(undefined);
    const up = jest.fn<Promise<unknown>, []>().mockResolvedValue(undefined);
    const onError = jest.fn();
    return { down, up, onError, lease: new MouseHoldLease({ down, up, onError }) };
  };

  it('renews a stationary drag every 500 ms and stops immediately on release', async () => {
    const { down, up, lease } = setup();
    expect(lease.start()).toBe(true);
    expect(lease.start()).toBe(false);
    await jest.advanceTimersByTimeAsync(1500);
    expect(down).toHaveBeenCalledTimes(4);
    lease.release();
    await jest.advanceTimersByTimeAsync(3000);
    expect(up).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(4);
  });

  it('waits for a late initial down before sending up, without renewing it', async () => {
    const { down, up, lease } = setup();
    const pending = deferred();
    down.mockReturnValueOnce(pending.promise);
    lease.start();
    lease.release();
    await jest.advanceTimersByTimeAsync(4000);
    expect(up).not.toHaveBeenCalled();
    expect(down).toHaveBeenCalledTimes(1);
    pending.resolve();
    await jest.advanceTimersByTimeAsync(3000);
    expect(up).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(1);
  });

  it('does not overlap slow renewals and orders release after the last renewal', async () => {
    const { down, up, lease } = setup();
    const pending = deferred();
    down.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise);
    lease.start();
    await jest.advanceTimersByTimeAsync(3000);
    expect(down).toHaveBeenCalledTimes(2);
    lease.release();
    expect(up).not.toHaveBeenCalled();
    pending.resolve();
    await jest.advanceTimersByTimeAsync(3000);
    expect(up).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('serializes a new gesture behind the prior gesture release', async () => {
    const { down, up, lease } = setup();
    const pending = deferred();
    down.mockReturnValueOnce(pending.promise);
    lease.start();
    lease.release();
    lease.start();
    expect(down).toHaveBeenCalledTimes(1);
    pending.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(up).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(2);
    const downOrder = down.mock.invocationCallOrder;
    expect(up.mock.invocationCallOrder[0]).toBeGreaterThan(downOrder[0]);
    expect(up.mock.invocationCallOrder[0]).toBeLessThan(downOrder[1]);
    lease.dispose();
    await jest.advanceTimersByTimeAsync(0);
  });

  it('cleans up a possibly accepted down after a rejected response', async () => {
    const { down, up, onError, lease } = setup();
    const error = new Error('response lost');
    down.mockRejectedValueOnce(error);
    lease.start();
    await jest.advanceTimersByTimeAsync(3000);
    expect(onError).toHaveBeenCalledWith(error);
    expect(up).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(1);
  });

  it('cancels the hold after renewal failure and makes one release attempt', async () => {
    const { down, up, onError, lease } = setup();
    down.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    up.mockRejectedValueOnce(new Error('still offline'));
    lease.start();
    await jest.advanceTimersByTimeAsync(5000);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(up).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('disposes while down is pending and prevents future gestures', async () => {
    const { down, up, lease } = setup();
    const pending = deferred();
    down.mockReturnValueOnce(pending.promise);
    lease.start();
    lease.dispose();
    expect(lease.start()).toBe(false);
    pending.reject(new Error('late failure'));
    await jest.advanceTimersByTimeAsync(5000);
    expect(up).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(1);
  });
});
