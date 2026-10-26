// Protocol 5 releases remote-held buttons after two seconds without successful
// input from their owner. Renew even when the finger is stationary, and order
// every release after the last down request has settled.
const HOLD_RENEWAL_INTERVAL_MS = 500;

type MouseHoldTransport = {
  down: () => Promise<unknown>;
  up: () => Promise<unknown>;
  onError: (error: unknown) => void;
};

export class MouseHoldLease {
  private desired: number | null = null;
  private remote: number | null = null;
  private generation = 0;
  private inFlight = false;
  private disposed = false;
  private renewal: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly transport: MouseHoldTransport) {}

  start(): boolean {
    if (this.disposed || this.desired !== null) {
      return false;
    }
    this.desired = ++this.generation;
    this.pump();
    return true;
  }

  release(): void {
    this.desired = null;
    this.clearRenewal();
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.release();
  }

  private clearRenewal(): void {
    if (this.renewal !== null) {
      clearTimeout(this.renewal);
      this.renewal = null;
    }
  }

  private pump(): void {
    if (this.inFlight) {
      return;
    }
    if (this.remote !== null && this.remote !== this.desired) {
      void this.send(false);
    } else if (this.desired !== null && this.remote === null) {
      this.remote = this.desired;
      void this.send(true);
    }
  }

  private async send(down: boolean): Promise<void> {
    this.inFlight = true;
    const startedAt = Date.now();
    try {
      await (down ? this.transport.down() : this.transport.up());
      if (down && this.desired !== null && this.desired === this.remote) {
        this.renewal = setTimeout(() => {
          this.renewal = null;
          if (this.desired !== null && this.desired === this.remote && !this.inFlight) {
            void this.send(true);
          }
        }, Math.max(0, HOLD_RENEWAL_INTERVAL_MS - (Date.now() - startedAt)));
      }
    } catch (error) {
      // A lost response can still mean Windows accepted the down. Attempt an
      // ordered up even when down failed, then rely on the desktop lease if
      // the connection has gone away. Never keep renewing after an error.
      this.desired = null;
      this.clearRenewal();
      this.transport.onError(error);
    } finally {
      if (!down) {
        this.remote = null;
      }
      this.inFlight = false;
      this.pump();
    }
  }
}
