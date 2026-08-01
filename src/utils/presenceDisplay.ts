import { PresenceState } from '../services/presence';

/** Short label for status pills/badges across the devices list, detail, and
 * control screens -- kept in one place so the three screens can never drift
 * into showing different words for the same state. */
export const PRESENCE_LABELS: Record<PresenceState, string> = {
  connecting: 'Connecting…',
  online: 'Online',
  unreachable: 'Unreachable',
  offline: 'Offline',
  auth_failed: 'Auth failed',
};

export const PRESENCE_COLORS: Record<PresenceState, string> = {
  connecting: '#facc15',
  online: '#4ade80',
  unreachable: '#fb923c',
  offline: '#6b7280',
  auth_failed: '#ef4444',
};

/** User-facing explanation shown under the status pill when a device is not
 * online, falling back to the state's generic label if the presence engine
 * did not attach a specific reason. */
export const presenceDetailMessage = (state: PresenceState, message: string | null): string | null => {
  if (message) {
    return message;
  }

  switch (state) {
    case 'connecting':
      return 'Waiting for the companion to respond for the first time.';
    case 'unreachable':
      return 'Companion could not be reached on the local network. Phone and computer may not be on the same network.';
    case 'offline':
      return 'Companion has not responded recently. Make sure it is running.';
    case 'auth_failed':
      return 'Companion authentication failed. Re-pair this device.';
    case 'online':
    default:
      return null;
  }
};
