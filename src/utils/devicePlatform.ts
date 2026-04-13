import { DevicePlatform } from '../types/device';

const PLATFORM_HINT_KEYS = [
  'platform',
  'os',
  'osname',
  'osversion',
  'operatingsystem',
  'system',
  'systemname',
  'hostname',
  'hostos',
  'kernel',
  'runtimeplatform',
  'deviceplatform',
  'deviceos',
];

const MAC_PATTERNS = [
  /\bmacos\b/i,
  /\bos x\b/i,
  /\bosx\b/i,
  /\bdarwin\b/i,
  /\bmacbook\b/i,
  /\bimac\b/i,
  /\bmac mini\b/i,
  /\bmac studio\b/i,
  /\bmac pro\b/i,
];

const WINDOWS_PATTERNS = [/\bwindows\b/i, /\bwin32\b/i, /\bwin64\b/i, /\bmicrosoft\b/i];
const LINUX_PATTERNS = [
  /\blinux\b/i,
  /\bubuntu\b/i,
  /\bdebian\b/i,
  /\bfedora\b/i,
  /\barch\b/i,
  /\bmanjaro\b/i,
  /\bpop!_os\b/i,
  /\bcentos\b/i,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeKey = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toLowerCase();

const detectPlatformFromString = (value: string): DevicePlatform => {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'unknown';
  }

  if (MAC_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return 'mac';
  }
  if (WINDOWS_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return 'windows';
  }
  if (LINUX_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return 'linux';
  }

  return 'unknown';
};

export const normalizeDevicePlatform = (value: unknown): DevicePlatform => {
  if (typeof value !== 'string') {
    return 'unknown';
  }

  return detectPlatformFromString(value);
};

export const inferDevicePlatformFromName = (name: string | null | undefined): DevicePlatform => {
  if (!name) {
    return 'unknown';
  }

  return detectPlatformFromString(name);
};

export const inferDevicePlatformFromMetadata = (
  input: unknown,
  fallbackName?: string | null
): DevicePlatform => {
  const queue: unknown[] = [input];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (typeof current === 'string') {
      const platform = detectPlatformFromString(current);
      if (platform !== 'unknown') {
        return platform;
      }
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (!isRecord(current) || visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const [key, value] of Object.entries(current)) {
      const normalizedKey = normalizeKey(key);

      if (typeof value === 'string') {
        const platform = detectPlatformFromString(value);
        if (PLATFORM_HINT_KEYS.includes(normalizedKey) && platform !== 'unknown') {
          return platform;
        }
      }

      if (Array.isArray(value) || isRecord(value) || typeof value === 'string') {
        queue.push(value);
      }
    }
  }

  return inferDevicePlatformFromName(fallbackName);
};

export const getPrimaryShortcutModifier = (
  platform: DevicePlatform
): { label: string; keyValue: string } =>
  platform === 'mac'
    ? { label: 'Command', keyValue: 'command' }
    : { label: 'Ctrl', keyValue: 'ctrl' };
