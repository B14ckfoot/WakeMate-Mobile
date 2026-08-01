import deviceService from './deviceService';

/**
 * Live connectivity state for a paired companion. Distinct from "paired"
 * (credentials saved) -- a device can be paired and still be connecting,
 * unreachable, or failing authentication. See docs/pairing-and-presence.md.
 */
export type PresenceState = 'connecting' | 'online' | 'unreachable' | 'offline' | 'auth_failed';

export type PresenceSnapshot = {
  state: PresenceState;
  message: string | null;
  lastOnlineAt: number | null;
  lastCheckedAt: number | null;
  consecutiveFailures: number;
};

type PresenceListener = (snapshot: PresenceSnapshot) => void;

/** How often a subscribed screen re-checks the companion. */
const HEARTBEAT_INTERVAL_MS = 5000;
/** Consecutive failures required before a previously-online device is
 * reported Offline instead of merely Unreachable, so one dropped packet or
 * a phone briefly switching Wi-Fi networks does not read as a hard outage. */
const OFFLINE_FAILURE_THRESHOLD = 3;
/** How long a device that has never once answered stays "Connecting" before
 * being reported Unreachable. Covers the iOS local-network permission
 * prompt and the first TLS handshake, both of which can take a few
 * seconds longer than a steady-state health check. */
const CONNECTING_GRACE_MS = 20000;

const initialSnapshot = (): PresenceSnapshot => ({
  state: 'connecting',
  message: null,
  lastOnlineAt: null,
  lastCheckedAt: null,
  consecutiveFailures: 0,
});

class DevicePresenceMonitor {
  private snapshot: PresenceSnapshot = initialSnapshot();
  private readonly listeners = new Set<PresenceListener>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private connectingSince = Date.now();
  private inFlight: Promise<void> | null = null;

  constructor(private readonly ip: string) {}

  subscribe(listener: PresenceListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);

    if (this.listeners.size === 1) {
      this.resume();
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.pause();
      }
    };
  }

  getSnapshot(): PresenceSnapshot {
    return this.snapshot;
  }

  /** Forces an immediate check and waits for it, e.g. a manual refresh tap. */
  async checkNow(): Promise<PresenceSnapshot> {
    await this.poll();
    return this.snapshot;
  }

  /** Drops accumulated history (failure count, last-online time) without
   * stopping an active subscription -- used right after re-pairing so a
   * stale failure streak from the old credentials cannot linger. */
  reset(): void {
    this.connectingSince = Date.now();
    this.update(initialSnapshot());
  }

  private resume(): void {
    if (this.intervalId) {
      return;
    }
    void this.poll();
    this.intervalId = setInterval(() => void this.poll(), HEARTBEAT_INTERVAL_MS);
  }

  private pause(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  private update(next: PresenceSnapshot): void {
    this.snapshot = next;
    this.emit();
  }

  private async poll(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.runCheck().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async runCheck(): Promise<void> {
    const result = await deviceService.checkDeviceStatusDetailed(this.ip);
    const now = Date.now();

    if (result.online) {
      this.connectingSince = now;
      this.update({
        state: 'online',
        message: null,
        lastOnlineAt: now,
        lastCheckedAt: now,
        consecutiveFailures: 0,
      });
      return;
    }

    const consecutiveFailures = this.snapshot.consecutiveFailures + 1;

    if (result.reason === 'auth' || result.reason === 'fingerprint_mismatch') {
      this.update({
        state: 'auth_failed',
        message: result.message,
        lastOnlineAt: this.snapshot.lastOnlineAt,
        lastCheckedAt: now,
        consecutiveFailures,
      });
      return;
    }

    if (!this.snapshot.lastOnlineAt) {
      // Never connected yet: a brief delay is expected (local-network
      // permission prompt, first TLS handshake) and must not read as a
      // confirmed outage until the grace window elapses.
      const stillConnecting = now - this.connectingSince < CONNECTING_GRACE_MS;
      this.update({
        state: stillConnecting ? 'connecting' : 'unreachable',
        message: result.message,
        lastOnlineAt: null,
        lastCheckedAt: now,
        consecutiveFailures,
      });
      return;
    }

    this.update({
      state: consecutiveFailures >= OFFLINE_FAILURE_THRESHOLD ? 'offline' : 'unreachable',
      message: result.message,
      lastOnlineAt: this.snapshot.lastOnlineAt,
      lastCheckedAt: now,
      consecutiveFailures,
    });
  }
}

const monitors = new Map<string, DevicePresenceMonitor>();

const getMonitor = (ip: string): DevicePresenceMonitor => {
  const trimmedIp = ip.trim();
  let monitor = monitors.get(trimmedIp);
  if (!monitor) {
    monitor = new DevicePresenceMonitor(trimmedIp);
    monitors.set(trimmedIp, monitor);
  }
  return monitor;
};

/**
 * Subscribes to live presence updates for a companion IP. The heartbeat
 * starts on the first subscriber for that IP and stops when the last one
 * unsubscribes, so no screen leaves a poll loop running after it unmounts,
 * but any number of screens (list, detail, control) watching the same
 * device share one underlying poll and see updates at the same time.
 */
export const subscribeToDevicePresence = (ip: string, listener: PresenceListener): (() => void) =>
  getMonitor(ip).subscribe(listener);

export const getDevicePresenceSnapshot = (ip: string): PresenceSnapshot => getMonitor(ip).getSnapshot();

export const refreshDevicePresence = (ip: string): Promise<PresenceSnapshot> => getMonitor(ip).checkNow();

/** Clears accumulated state (failure streak, last-online time) for an IP,
 * e.g. right after a fresh pairing, so the new session starts at
 * "Connecting" instead of inheriting a previous device's failure count. */
export const resetDevicePresence = (ip: string): void => {
  getMonitor(ip).reset();
};

/** Drops the monitor entirely, e.g. when a device is deleted, so it stops
 * polling a companion the user no longer has saved. */
export const forgetDevicePresence = (ip: string): void => {
  monitors.delete(ip.trim());
};
