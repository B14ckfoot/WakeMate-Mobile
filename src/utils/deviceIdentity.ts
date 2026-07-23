import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Friendly name this phone reports when enrolling with the companion.
 * Shown in the desktop approval dialog and the tray's paired-device list.
 */
export const getThisPhoneDisplayName = (): string => {
  const name = Constants.deviceName?.trim();
  if (name) {
    return name;
  }

  if (Platform.OS === 'ios') {
    return 'iPhone';
  }

  if (Platform.OS === 'android') {
    return 'Android phone';
  }

  return 'WakeMATE app';
};
