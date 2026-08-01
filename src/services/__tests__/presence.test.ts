import deviceService from '../deviceService';
import {
  forgetDevicePresence,
  getDevicePresenceSnapshot,
  PresenceSnapshot,
  refreshDevicePresence,
  resetDevicePresence,
  subscribeToDevicePresence,
} from '../presence';

// jest.mock calls are hoisted above these imports by babel-plugin-jest-hoist.
jest.mock('../deviceService', () => ({
  __esModule: true,
  default: { checkDeviceStatusDetailed: jest.fn() },
}));

const mockedCheck = deviceService.checkDeviceStatusDetailed as jest.Mock;

const ONLINE = { online: true, reason: 'ok', message: null };
const NETWORK_FAIL = {
  online: false,
  reason: 'network',
  message: 'Companion could not be reached on the local network.',
};
const AUTH_FAIL = {
  online: false,
  reason: 'auth',
  message: 'Companion authentication failed.',
};

// A fresh IP per test avoids reusing another test's monitor state, since
// monitors are keyed by IP in a module-level map shared across this file.
let ipCounter = 1;
const uniqueIp = (): string => `10.99.0.${ipCounter++}`;

describe('device presence engine', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedCheck.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports online immediately when the first check succeeds', async () => {
    mockedCheck.mockResolvedValue(ONLINE);
    const ip = uniqueIp();
    const updates: PresenceSnapshot[] = [];
    const unsubscribe = subscribeToDevicePresence(ip, (snapshot) => updates.push(snapshot));

    await jest.advanceTimersByTimeAsync(0);

    expect(updates[updates.length - 1].state).toBe('online');
    unsubscribe();
  });

  it('stays "connecting" through repeated failures inside the grace window', async () => {
    mockedCheck.mockResolvedValue(NETWORK_FAIL);
    const ip = uniqueIp();
    const unsubscribe = subscribeToDevicePresence(ip, () => {});

    await jest.advanceTimersByTimeAsync(0);
    expect(getDevicePresenceSnapshot(ip).state).toBe('connecting');

    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(5000);
    expect(getDevicePresenceSnapshot(ip).state).toBe('connecting');

    unsubscribe();
  });

  it('reports "unreachable" once the connecting grace window elapses without ever connecting', async () => {
    mockedCheck.mockResolvedValue(NETWORK_FAIL);
    const ip = uniqueIp();
    const unsubscribe = subscribeToDevicePresence(ip, () => {});

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(25000);

    expect(getDevicePresenceSnapshot(ip).state).toBe('unreachable');
    unsubscribe();
  });

  it('does not drop straight to offline on one failure after being online', async () => {
    mockedCheck.mockResolvedValueOnce(ONLINE);
    const ip = uniqueIp();
    const unsubscribe = subscribeToDevicePresence(ip, () => {});
    await jest.advanceTimersByTimeAsync(0);
    expect(getDevicePresenceSnapshot(ip).state).toBe('online');

    mockedCheck.mockResolvedValue(NETWORK_FAIL);
    await jest.advanceTimersByTimeAsync(5000);
    expect(getDevicePresenceSnapshot(ip).state).toBe('unreachable');

    unsubscribe();
  });

  it('reports offline only after the consecutive-failure threshold', async () => {
    mockedCheck.mockResolvedValueOnce(ONLINE);
    const ip = uniqueIp();
    const unsubscribe = subscribeToDevicePresence(ip, () => {});
    await jest.advanceTimersByTimeAsync(0);

    mockedCheck.mockResolvedValue(NETWORK_FAIL);
    await jest.advanceTimersByTimeAsync(5000); // failure 1
    expect(getDevicePresenceSnapshot(ip).state).toBe('unreachable');
    await jest.advanceTimersByTimeAsync(5000); // failure 2
    expect(getDevicePresenceSnapshot(ip).state).toBe('unreachable');
    await jest.advanceTimersByTimeAsync(5000); // failure 3 -> threshold
    expect(getDevicePresenceSnapshot(ip).state).toBe('offline');

    unsubscribe();
  });

  it('recovers from offline back to online and resets the failure count', async () => {
    mockedCheck.mockResolvedValueOnce(ONLINE);
    const ip = uniqueIp();
    const unsubscribe = subscribeToDevicePresence(ip, () => {});
    await jest.advanceTimersByTimeAsync(0);

    mockedCheck.mockResolvedValue(NETWORK_FAIL);
    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(5000);
    expect(getDevicePresenceSnapshot(ip).state).toBe('offline');

    mockedCheck.mockResolvedValue(ONLINE);
    await jest.advanceTimersByTimeAsync(5000);
    expect(getDevicePresenceSnapshot(ip).state).toBe('online');
    expect(getDevicePresenceSnapshot(ip).consecutiveFailures).toBe(0);

    unsubscribe();
  });

  it('reports auth_failed distinctly, even on the very first check', async () => {
    mockedCheck.mockResolvedValue(AUTH_FAIL);
    const ip = uniqueIp();
    const unsubscribe = subscribeToDevicePresence(ip, () => {});
    await jest.advanceTimersByTimeAsync(0);
    expect(getDevicePresenceSnapshot(ip).state).toBe('auth_failed');
    unsubscribe();
  });

  it('stops polling once the last subscriber unsubscribes', async () => {
    mockedCheck.mockResolvedValue(ONLINE);
    const ip = uniqueIp();
    const unsubscribe = subscribeToDevicePresence(ip, () => {});
    await jest.advanceTimersByTimeAsync(0);
    const callsAfterFirst = mockedCheck.mock.calls.length;

    unsubscribe();
    await jest.advanceTimersByTimeAsync(20000);

    expect(mockedCheck.mock.calls.length).toBe(callsAfterFirst);
  });

  it('shares one poll across multiple subscribers to the same IP', async () => {
    mockedCheck.mockResolvedValue(ONLINE);
    const ip = uniqueIp();
    const unsubscribeA = subscribeToDevicePresence(ip, () => {});
    const unsubscribeB = subscribeToDevicePresence(ip, () => {});

    await jest.advanceTimersByTimeAsync(0);

    expect(mockedCheck).toHaveBeenCalledTimes(1);

    unsubscribeA();
    unsubscribeB();
  });

  it('resetDevicePresence clears failure history without stopping the subscription', async () => {
    mockedCheck.mockResolvedValueOnce(ONLINE);
    const ip = uniqueIp();
    const unsubscribe = subscribeToDevicePresence(ip, () => {});
    await jest.advanceTimersByTimeAsync(0);

    mockedCheck.mockResolvedValue(NETWORK_FAIL);
    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(5000);
    expect(getDevicePresenceSnapshot(ip).consecutiveFailures).toBe(2);

    resetDevicePresence(ip);
    expect(getDevicePresenceSnapshot(ip).state).toBe('connecting');
    expect(getDevicePresenceSnapshot(ip).consecutiveFailures).toBe(0);

    unsubscribe();
  });

  it('refreshDevicePresence forces an immediate check and returns the result', async () => {
    mockedCheck.mockResolvedValue(ONLINE);
    const ip = uniqueIp();
    const snapshot = await refreshDevicePresence(ip);
    expect(snapshot.state).toBe('online');
  });

  it('forgetDevicePresence drops monitor state for an IP', async () => {
    mockedCheck.mockResolvedValue(ONLINE);
    const ip = uniqueIp();
    await refreshDevicePresence(ip);
    expect(getDevicePresenceSnapshot(ip).state).toBe('online');

    forgetDevicePresence(ip);
    expect(getDevicePresenceSnapshot(ip).state).toBe('connecting');
  });
});
