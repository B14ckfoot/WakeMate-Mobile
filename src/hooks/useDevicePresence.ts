import { useEffect, useState } from 'react';
import {
  getDevicePresenceSnapshot,
  PresenceSnapshot,
  subscribeToDevicePresence,
} from '../services/presence';

/**
 * Live-subscribes a component to a companion's presence state. The
 * underlying heartbeat is shared across every screen watching the same IP
 * (see src/services/presence.ts), so a device list row and an open control
 * screen for the same companion update in lockstep without either one
 * polling independently.
 */
export const useDevicePresence = (ip: string | null | undefined): PresenceSnapshot | null => {
  const [snapshot, setSnapshot] = useState<PresenceSnapshot | null>(
    ip ? getDevicePresenceSnapshot(ip) : null
  );

  useEffect(() => {
    if (!ip) {
      setSnapshot(null);
      return;
    }

    setSnapshot(getDevicePresenceSnapshot(ip));
    return subscribeToDevicePresence(ip, setSnapshot);
  }, [ip]);

  return snapshot;
};
