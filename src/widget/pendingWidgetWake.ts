import { ExtensionStorage } from '@bacons/apple-targets';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import { WAKEMATE_APP_GROUP } from './widgetSharedStorage';

// Written by `WakeMateWakeDeviceIntent` in the widget extension when it cannot
// send the magic packet itself (see targets/widget/WakeMateWakeIntent.swift).
// Keep this key and the expiry in step with that file.
const PENDING_WAKE_KEY = 'wakemate.pendingWake';
const PENDING_WAKE_EXPIRY_MS = 120_000;

const extensionStorage = new ExtensionStorage(WAKEMATE_APP_GROUP);

type PendingWake = {
  deviceId: string;
  requestedAt: number;
};

const parsePendingWake = (raw: string | null | undefined): PendingWake | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PendingWake>;
    const deviceId = typeof parsed.deviceId === 'string' ? parsed.deviceId.trim() : '';
    const requestedAt = typeof parsed.requestedAt === 'number' ? parsed.requestedAt : 0;

    if (!deviceId || !Number.isFinite(requestedAt)) {
      return null;
    }

    return { deviceId, requestedAt };
  } catch {
    return null;
  }
};

// Reads and clears any wake the Control Center button handed over. Always
// clears, even when the request is stale or unreadable, so a wedged value
// cannot re-trigger a wake on every future launch.
export const consumePendingWidgetWake = (): PendingWake | null => {
  if (Platform.OS !== 'ios') {
    return null;
  }

  let raw: string | null = null;
  try {
    raw = extensionStorage.get(PENDING_WAKE_KEY);
  } catch (error) {
    console.warn('Failed to read the pending widget wake:', error);
    return null;
  }

  if (raw === null || raw === undefined) {
    return null;
  }

  try {
    extensionStorage.remove(PENDING_WAKE_KEY);
  } catch (error) {
    console.warn('Failed to clear the pending widget wake:', error);
  }

  const pending = parsePendingWake(raw);
  if (!pending) {
    return null;
  }

  // A request the user made minutes ago is not one they still want acted on.
  if (Date.now() - pending.requestedAt > PENDING_WAKE_EXPIRY_MS) {
    return null;
  }

  return pending;
};

// Runs the handed-over wake through the app's normal wake screen, so the
// extension fallback and the Home Screen widget end up on exactly the same
// path.
export const usePendingWidgetWake = (): void => {
  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }

    const handOff = () => {
      const pending = consumePendingWidgetWake();
      if (pending) {
        router.push(`/wake?deviceId=${encodeURIComponent(pending.deviceId)}`);
      }
    };

    // Cold launch: the intent opened the app and the request is already there.
    handOff();

    // Warm launch: the app was backgrounded when the control was pressed.
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        handOff();
      }
    });

    return () => subscription.remove();
  }, []);
};
