import { NativeModules, Platform } from 'react-native';

type WakeOnLanNativeModule = {
  awake(macAddress: string, broadcastAddress: string, port: number): Promise<{
    ok: boolean;
    broadcastAddress: string;
    port: number;
  }>;
};

const LINKING_ERROR =
  "Wake-on-LAN native module isn't available. Use a native development build and rebuild the app after changing native code.";

const getNativeModule = (): WakeOnLanNativeModule => {
  if (Platform.OS === 'web') {
    throw new Error('Wake-on-LAN is not supported on web.');
  }

  const module = NativeModules.WakeOnLan as WakeOnLanNativeModule | undefined;

  if (!module?.awake) {
    throw new Error(LINKING_ERROR);
  }

  return module;
};

export const sendWakeOnLanPacket = async (
  macAddress: string,
  broadcastAddress: string,
  port: number
) => {
  const module = getNativeModule();
  const result = await module.awake(macAddress, broadcastAddress, port);

  return result ?? {
    ok: true,
    broadcastAddress,
    port,
  };
};
