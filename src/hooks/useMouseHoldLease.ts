import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import deviceService from '../services/deviceService';
import { MouseHoldLease } from '../services/mouseHoldLease';

type Options = {
  deviceId?: string;
  deviceIp?: string;
  enabled: boolean;
  onError: (error: unknown) => void;
  onRelease: () => void;
};

export const useMouseHoldLease = ({ deviceId, deviceIp, enabled, onError, onRelease }: Options) => {
  const callbacks = useRef({ onError, onRelease });
  callbacks.current = { onError, onRelease };
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');

  // The transport closures retain their original computer identity. A late
  // cleanup must never send an up to the newly selected computer instead.
  const holder = useMemo(() => ({
    lease: null as MouseHoldLease | null,
    target: deviceId && deviceIp ? { id: deviceId, ip: deviceIp } : null,
  }), [deviceId, deviceIp]);
  const latestHolder = useRef(holder);
  latestHolder.current = holder;

  const release = useCallback(() => {
    callbacks.current.onRelease();
    holder.lease?.release();
  }, [holder]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    foreground.current = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const subscription = AppState.addEventListener('change', (state) => {
      foreground.current = state !== 'background' && state !== 'inactive';
      if (!foreground.current) {
        release();
      }
    });
    return () => {
      focused.current = false;
      subscription.remove();
      release();
    };
  }, [release]));

  useEffect(() => {
    if (!enabled) {
      release();
    }
  }, [enabled, release]);

  useEffect(() => {
    if (!holder.target) {
      return;
    }
    const { id, ip } = holder.target;
    const lease = new MouseHoldLease({
      down: () => deviceService.sendMouseButtonDown(id, ip, 'left'),
      up: () => deviceService.sendMouseButtonUp(id, ip, 'left'),
      onError: (error) => {
        // A late failure belongs to the old route/PC, whose cleanup is already
        // ordered by its lease. It must not cancel a gesture on the next PC.
        if (latestHolder.current === holder && holder.lease === lease && focused.current && foreground.current) {
          callbacks.current.onRelease();
          callbacks.current.onError(error);
        }
      },
    });
    holder.lease = lease;
    return () => {
      lease.dispose();
      holder.lease = null;
    };
  }, [holder]);

  const start = useCallback(() => {
    if (!enabled || !focused.current || !foreground.current) {
      return false;
    }
    return holder.lease?.start() ?? false;
  }, [enabled, holder]);

  return { start, release };
};
