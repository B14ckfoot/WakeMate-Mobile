import { ExtensionStorage } from '@bacons/apple-targets';
import { Platform } from 'react-native';
import { Device } from '../types/device';

export const WAKEMATE_APP_GROUP = 'group.com.anonymous.wakematemobile';
export const WAKEMATE_WIDGET_KIND = 'com.anonymous.wakematemobile.widget';
export const WAKEMATE_CONTROL_KIND = 'com.anonymous.wakematemobile.control';
const WAKEMATE_DEVICES_KEY = 'wakemate.devices';
// Read by `WakeMateSharedStore.favoriteDeviceID()` in the widget extension;
// keep the key in step with targets/widget/_shared/WakeMateShared.swift.
const WAKEMATE_FAVORITE_DEVICE_KEY = 'wakemate.favoriteDeviceId';

type WidgetDeviceRecord = {
  id: string;
  name: string;
  mac: string;
  ip: string;
  wakeAddress: string;
  wakePort: number;
  status: string;
  type: string;
  platform: string;
};

const extensionStorage = new ExtensionStorage(WAKEMATE_APP_GROUP);

const toWidgetDeviceRecord = (device: Device): WidgetDeviceRecord => ({
  id: device.id,
  name: device.name,
  mac: device.mac,
  ip: device.ip,
  wakeAddress: device.wakeAddress,
  wakePort: device.wakePort,
  status: device.status,
  type: device.type,
  platform: device.platform ?? 'unknown',
});

// Both surfaces render from app-group state, so anything that changes that
// state has to ask them to redraw or the user keeps seeing the previous answer.
const reloadWidgetSurfaces = (): void => {
  ExtensionStorage.reloadWidget(WAKEMATE_WIDGET_KIND);
  ExtensionStorage.reloadControls(WAKEMATE_CONTROL_KIND);
};

export const syncDevicesToWidgetStorage = (devices: Device[]): void => {
  if (Platform.OS !== 'ios') {
    return;
  }

  extensionStorage.set(WAKEMATE_DEVICES_KEY, devices.map(toWidgetDeviceRecord));
  reloadWidgetSurfaces();
};

// The computer an unconfigured widget or control should wake. Clearing it
// leaves the extension falling back to the first saved computer.
export const syncFavoriteDeviceToWidgetStorage = (deviceId: string | null): void => {
  if (Platform.OS !== 'ios') {
    return;
  }

  // An absent key is what "no favorite" has to look like to the extension, so
  // clearing removes it rather than writing an empty string.
  if (deviceId) {
    extensionStorage.set(WAKEMATE_FAVORITE_DEVICE_KEY, deviceId);
  } else {
    extensionStorage.remove(WAKEMATE_FAVORITE_DEVICE_KEY);
  }

  reloadWidgetSurfaces();
};
