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
}

export interface DeviceCommand {
  command: string;
  params?: Record<string, any>;
}
