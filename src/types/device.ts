export type DevicePlatform = 'windows' | 'mac' | 'linux' | 'unknown';

export interface Device {
  id: string;
  name: string;
  mac: string;
  ip: string;
  wakeAddress: string;
  wakePort: number;
  status: 'online' | 'offline';
  type: 'wifi' | 'bluetooth';
  platform?: DevicePlatform;

  // Companion connection. Each computer owns its own, so pairing a second PC
  // no longer overwrites the first. The pairing token and TLS fingerprint are
  // deliberately NOT here -- they live in SecureStore keyed by `id`, because
  // this record is persisted to AsyncStorage and mirrored into the widget's
  // app group.
  /** Plain-HTTP companion port. Falls back to 7777 when unset. */
  apiPort?: number;
  /** Pinned-HTTPS port, used whenever a TLS fingerprint is stored. */
  tlsPort?: number | null;
}

export interface DeviceCommand {
  command: string;
  params?: Record<string, any>;
}
