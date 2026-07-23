import { Device } from '../types/device';
import { normalizeDevicePlatform, inferDevicePlatformFromMetadata } from './devicePlatform';
import {
  DEFAULT_WAKE_PORT,
  getSuggestedWakeAddress,
  isValidIpAddress,
  isValidMacAddress,
  normalizeMacAddress,
  sanitizeWakePort,
} from './deviceNetwork';

const NAME_KEYS = [
  'name',
  'hostname',
  'host',
  'devicename',
  'computername',
  'machinename',
  'friendlyname',
  'systemname',
];
const IP_KEYS = ['ip', 'localip', 'ipaddress', 'address', 'hostip', 'ipv4', 'localaddress'];
const MAC_KEYS = [
  'mac',
  'macaddress',
  'hwaddress',
  'physicaladdress',
  'ethernetmac',
  'wifimac',
  'primarymac',
  'primarymacaddress',
  'adaptermac',
  'networkadaptermac',
  'lanmac',
];
const WAKE_ADDRESS_KEYS = [
  'wakeaddress',
  'broadcast',
  'broadcastaddress',
  'wakebroadcast',
  'wolbroadcast',
  'wolbroadcastaddress',
];
const WAKE_PORT_KEYS = ['wakeport', 'wakeonlanport', 'wolport', 'wakeudpport', 'woludpport'];

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeKey = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toLowerCase();

const toCandidateString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
};

const toCandidatePort = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
      return parsed;
    }
  }

  return null;
};

const findValueByKeys = (
  input: unknown,
  keys: string[],
  validator?: (value: string) => boolean
): string | null => {
  const normalizedKeys = new Set(keys.map(normalizeKey));
  const queue: unknown[] = [input];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (!isRecord(current)) {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const [key, value] of Object.entries(current)) {
      const candidate = toCandidateString(value);

      if (normalizedKeys.has(normalizeKey(key)) && candidate && (!validator || validator(candidate))) {
        return candidate;
      }

      if (Array.isArray(value) || isRecord(value)) {
        queue.push(value);
      }
    }
  }

  return null;
};

const findNumberByKeys = (input: unknown, keys: string[]): number | null => {
  const normalizedKeys = new Set(keys.map(normalizeKey));
  const queue: unknown[] = [input];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (!isRecord(current)) {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const [key, value] of Object.entries(current)) {
      const candidate = toCandidatePort(value);

      if (normalizedKeys.has(normalizeKey(key)) && candidate !== null) {
        return candidate;
      }

      if (Array.isArray(value) || isRecord(value)) {
        queue.push(value);
      }
    }
  }

  return null;
};

const findMatchingValue = (input: unknown, validator: (value: string) => boolean): string | null => {
  const queue: unknown[] = [input];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (!isRecord(current)) {
      const candidate = toCandidateString(current);
      if (candidate && validator(candidate)) {
        return candidate;
      }
      continue;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const value of Object.values(current)) {
      const candidate = toCandidateString(value);
      if (candidate && validator(candidate)) {
        return candidate;
      }

      if (Array.isArray(value) || isRecord(value)) {
        queue.push(value);
      }
    }
  }

  return null;
};

const collectRecords = (input: unknown): UnknownRecord[] => {
  const queue: unknown[] = [input];
  const visited = new Set<object>();
  const records: UnknownRecord[] = [];

  while (queue.length > 0) {
    const current = queue.shift();

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (!isRecord(current) || visited.has(current)) {
      continue;
    }

    visited.add(current);
    records.push(current);

    for (const value of Object.values(current)) {
      if (Array.isArray(value) || isRecord(value)) {
        queue.push(value);
      }
    }
  }

  return records;
};

const scoreCompanionRecord = (record: UnknownRecord, fallbackIp: string): number => {
  const ip = findValueByKeys(record, IP_KEYS, isValidIpAddress);
  const mac = findValueByKeys(record, MAC_KEYS, isValidMacAddress);
  const wakeAddress = findValueByKeys(record, WAKE_ADDRESS_KEYS, isValidIpAddress);
  const wakePort = findNumberByKeys(record, WAKE_PORT_KEYS);
  const name = findValueByKeys(record, NAME_KEYS);

  let score = 0;

  if (ip === fallbackIp) {
    score += 100;
  }
  if (mac) {
    score += 60;
  }
  if (ip) {
    score += 40;
  }
  if (wakeAddress) {
    score += 20;
  }
  if (wakePort !== null) {
    score += 10;
  }
  if (name) {
    score += 5;
  }

  return score;
};

export const extractCompanionFields = (info: unknown, fallbackIp: string) => {
  const payload = isRecord(info) && 'data' in info ? (info as UnknownRecord).data : info;
  const bestRecord = collectRecords(payload)
    .sort((left, right) => scoreCompanionRecord(right, fallbackIp) - scoreCompanionRecord(left, fallbackIp))[0];
  const preferredSource = bestRecord ?? payload;

  const pingIp =
    findValueByKeys(preferredSource, IP_KEYS, isValidIpAddress) ??
    findValueByKeys(payload, IP_KEYS, isValidIpAddress) ??
    findMatchingValue(preferredSource, isValidIpAddress) ??
    findMatchingValue(payload, isValidIpAddress) ??
    fallbackIp;

  const rawMac =
    findValueByKeys(preferredSource, MAC_KEYS, isValidMacAddress) ??
    findValueByKeys(payload, MAC_KEYS, isValidMacAddress) ??
    findMatchingValue(preferredSource, isValidMacAddress) ??
    findMatchingValue(payload, isValidMacAddress) ??
    '';

  const wakeAddress =
    findValueByKeys(preferredSource, WAKE_ADDRESS_KEYS, isValidIpAddress) ??
    findValueByKeys(payload, WAKE_ADDRESS_KEYS, isValidIpAddress) ??
    (getSuggestedWakeAddress(pingIp) || pingIp);

  const wakePort =
    findNumberByKeys(preferredSource, WAKE_PORT_KEYS) ??
    findNumberByKeys(payload, WAKE_PORT_KEYS) ??
    DEFAULT_WAKE_PORT;

  const name =
    findValueByKeys(preferredSource, NAME_KEYS) ??
    findValueByKeys(payload, NAME_KEYS) ??
    `WakeMATE ${pingIp}`;

  return {
    name,
    pingIp,
    mac: rawMac ? normalizeMacAddress(rawMac) : '',
    wakeAddress,
    wakePort,
    platform: inferDevicePlatformFromMetadata(preferredSource, name),
  };
};

export const buildScannedDevice = (fields: {
  name: string;
  pingIp: string;
  mac: string;
  wakeAddress: string;
  wakePort?: number;
  platform?: Device['platform'];
}): Device | null => {
  const trimmedName = fields.name.trim();
  const trimmedPingIp = fields.pingIp.trim();
  const normalizedMac = normalizeMacAddress(fields.mac);
  const resolvedWakeAddress =
    fields.wakeAddress.trim() || getSuggestedWakeAddress(trimmedPingIp) || trimmedPingIp;

  if (!trimmedName || !trimmedPingIp || !normalizedMac) {
    return null;
  }

  if (!isValidIpAddress(trimmedPingIp) || !isValidMacAddress(normalizedMac)) {
    return null;
  }

  return {
    id: Date.now().toString(),
    name: trimmedName,
    mac: normalizedMac,
    ip: trimmedPingIp,
    wakeAddress: resolvedWakeAddress,
    wakePort: sanitizeWakePort(fields.wakePort, DEFAULT_WAKE_PORT),
    status: 'offline',
    type: 'wifi',
    platform: normalizeDevicePlatform(fields.platform ?? trimmedName),
  };
};
