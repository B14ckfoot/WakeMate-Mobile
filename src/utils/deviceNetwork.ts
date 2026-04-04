import { Device } from '../types/device';

export const DEFAULT_WAKE_PORT = 9;

const IPV4_SEGMENT = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_REGEX = new RegExp(`^(${IPV4_SEGMENT}\\.){3}${IPV4_SEGMENT}$`);
const MAC_REGEX = /^(([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}|[0-9A-Fa-f]{12})$/;

type DeviceSeed = Partial<Device> & {
  id: string;
  name: string;
  ip: string;
};

export const isValidIpAddress = (value: string): boolean => IPV4_REGEX.test(value.trim());

export const isValidMacAddress = (value: string): boolean => MAC_REGEX.test(value.trim());

export const normalizeMacAddress = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const hex = trimmed.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (hex.length !== 12) {
    return trimmed.toUpperCase();
  }

  return hex.match(/.{1,2}/g)?.join(':') ?? trimmed.toUpperCase();
};

export const sanitizeWakePort = (
  value: string | number | null | undefined,
  fallback: number = DEFAULT_WAKE_PORT
): number => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '').trim(), 10);

  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
    return parsed;
  }

  return fallback;
};

export const getSuggestedWakeAddress = (ip: string): string => {
  const trimmed = ip.trim();
  if (!isValidIpAddress(trimmed)) {
    return '';
  }

  const octets = trimmed.split('.');
  return `${octets[0]}.${octets[1]}.${octets[2]}.255`;
};

export const normalizeDevice = (device: DeviceSeed): Device => {
  const ip = device.ip.trim();
  const wakeAddress = device.wakeAddress?.trim() || getSuggestedWakeAddress(ip) || ip;

  return {
    id: String(device.id),
    name: device.name.trim(),
    mac: normalizeMacAddress(device.mac ?? ''),
    ip,
    wakeAddress,
    wakePort: sanitizeWakePort(device.wakePort),
    status: device.status === 'online' ? 'online' : 'offline',
    type: device.type === 'bluetooth' ? 'bluetooth' : 'wifi',
  };
};
