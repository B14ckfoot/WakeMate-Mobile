import { ExtensionStorage } from '@bacons/apple-targets';
import { Platform } from 'react-native';
import { Device } from '../types/device';

export const WAKEMATE_APP_GROUP = 'group.com.anonymous.wakematemobile';
export const WAKEMATE_WIDGET_KIND = 'com.anonymous.wakematemobile.widget';
export const WAKEMATE_CONTROL_KIND = 'com.anonymous.wakematemobile.control';
const WAKEMATE_DEVICES_KEY = 'wakemate.devices';

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

export const syncDevicesToWidgetStorage = (devices: Device[]): void => {
  if (Platform.OS !== 'ios') {
    return;
  }

  extensionStorage.set(WAKEMATE_DEVICES_KEY, devices.map(toWidgetDeviceRecord));
  ExtensionStorage.reloadWidget(WAKEMATE_WIDGET_KIND);
  ExtensionStorage.reloadControls(WAKEMATE_CONTROL_KIND);
};
