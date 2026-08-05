import AsyncStorage from '@react-native-async-storage/async-storage';
import { Device } from '../types/device';
import { syncFavoriteDeviceToWidgetStorage } from '../widget/widgetSharedStorage';

// The computer the Home Screen widget and the Control Center button wake when
// they have not been pointed at a specific one. Mirrored into the app group so
// the widget extension can read it without launching the app.
const FAVORITE_DEVICE_KEY = 'wakemate.favoriteDeviceId';

const trimId = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

export const getFavoriteDeviceId = async (): Promise<string | null> => {
  try {
    return trimId(await AsyncStorage.getItem(FAVORITE_DEVICE_KEY));
  } catch (error) {
    console.warn('Could not read the favorite device:', error);
    return null;
  }
};

/** Returns the stored value so callers can render exactly what was saved. */
export const setFavoriteDeviceId = async (deviceId: string | null): Promise<string | null> => {
  const next = trimId(deviceId);

  if (next) {
    await AsyncStorage.setItem(FAVORITE_DEVICE_KEY, next);
  } else {
    await AsyncStorage.removeItem(FAVORITE_DEVICE_KEY);
  }

  syncFavoriteDeviceToWidgetStorage(next);
  return next;
};

/**
 * The same fallback order the widget extension uses: the favorite when it is
 * still saved, otherwise the first computer that was added. Kept here so the
 * app can show the user which computer the widget will actually wake.
 */
export const resolveWidgetDevice = (
  devices: Device[],
  favoriteDeviceId: string | null
): Device | null => {
  const favorite = favoriteDeviceId
    ? devices.find((device) => device.id === favoriteDeviceId)
    : undefined;

  return favorite ?? devices[0] ?? null;
};

/**
 * Drops a favorite that points at a computer the user deleted, then re-mirrors
 * the result. Without this the app group keeps naming a device that no longer
 * exists and the widget silently stops resolving one.
 */
export const reconcileFavoriteDevice = async (devices: Device[]): Promise<string | null> => {
  const stored = await getFavoriteDeviceId();
  const isStillSaved = stored !== null && devices.some((device) => device.id === stored);

  if (stored !== null && !isStillSaved) {
    return setFavoriteDeviceId(null);
  }

  syncFavoriteDeviceToWidgetStorage(stored);
  return stored;
};
