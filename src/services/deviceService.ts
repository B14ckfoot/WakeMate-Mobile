import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import dgram from 'react-native-udp';
import { sendWakeOnLanPacket } from '../native/wakeOnLan';
import { Device } from '../types/device';
import { inferDevicePlatformFromMetadata } from '../utils/devicePlatform';
import {
  getSuggestedWakeAddress,
  isValidIpAddress,
  isValidMacAddress,
  normalizeDevice,
  normalizeMacAddress,
  sanitizeWakePort,
} from '../utils/deviceNetwork';
import { syncDevicesToWidgetStorage } from '../widget/widgetSharedStorage';
import {
  normalizeTlsFingerprint,
  requestCompanion,
} from './companionTransport';
import {
  clearDeviceCredentials,
  clearLegacyCredentials,
  getDeviceTlsFingerprint,
  getDeviceToken,
  readLegacyCredentials,
  setDeviceTlsFingerprint,
  setDeviceToken,
} from './companionCredentials';

const SERVER_IP_KEY = 'serverIp';
const SERVER_PORT_KEY = 'serverPort';
const SERVER_TOKEN_KEY = 'serverToken';
const SECURE_SERVER_TOKEN_KEY = 'wakemate.companion.token.v1';
const SECURE_SERVER_TLS_FINGERPRINT_KEY = 'wakemate.companion.tlsFingerprint.v1';
const SECURE_SERVER_TOKEN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const DEFAULT_API_PORT = 7777;
const AUTH_HEADER = 'x-wakemate-token';
const GLOBAL_BROADCAST_ADDRESS = '255.255.255.255';
const COMPANION_SERVER_IP_REQUIRED_MESSAGE = 'Companion server IP not set. Re-scan this computer’s pairing QR code from the Devices screen.';
const COMPANION_PAIRING_TOKEN_REQUIRED_MESSAGE = 'Pairing token not set. Scan the pairing QR code shown by the WakeMATE tray icon from the Devices screen.';
const COMPANION_PAIRING_TOKEN_REJECTED_MESSAGE = 'Pairing token was rejected by the companion. Re-scan its pairing QR code from the Devices screen.';
const DISCOVERY_NAME_KEYS = [
  'name',
  'hostname',
  'host',
  'devicename',
  'device_name',
  'computername',
  'machinename',
  'friendlyname',
  'systemname',
];
const DISCOVERY_IP_KEYS = [
  'ip',
  'serverip',
  'server_ip',
  'localip',
  'local_ip',
  'ipaddress',
  'address',
  'hostip',
  'ipv4',
  'localaddress',
];
const DISCOVERY_MAC_KEYS = [
  'mac',
  'macaddress',
  'mac_address',
  'hwaddress',
  'physicaladdress',
  'physical_address',
  'ethernetmac',
  'wifimac',
  'primarymac',
  'primary_mac',
  'primarymacaddress',
  'adaptermac',
  'networkadaptermac',
  'lanmac',
];
const DISCOVERY_WAKE_ADDRESS_KEYS = [
  'wakeaddress',
  'wake_address',
  'broadcast',
  'broadcastaddress',
  'broadcast_address',
  'wakebroadcast',
  'wolbroadcast',
  'wolbroadcastaddress',
];
const DISCOVERY_WAKE_PORT_KEYS = ['wakeport', 'wake_port', 'wakeonlanport', 'wolport', 'wol_port', 'wakeudpport', 'woludpport'];
const DISCOVERY_API_PORT_KEYS = ['apiport', 'api_port'];
const DISCOVERY_TLS_PORT_KEYS = ['tlsport', 'tls_port', 'httpsport', 'https_port'];
const DISCOVERY_TLS_FINGERPRINT_KEYS = [
  'fp',
  'fingerprint',
  'certificatefingerprint',
  'certificate_fingerprint',
  'tlsfingerprint',
  'tls_fingerprint',
];
const DISCOVERY_VERSION_KEYS = ['version', 'appversion', 'serverversion'];

type CommandParams = Record<string, any>;
type MouseButton = 'left' | 'right' | 'middle';
type MouseButtonAction = 'down' | 'up';
type ScrollDirection = 'up' | 'down';

// Outcome vocabulary for the Windows security-screen command. `success`,
// `unsupported`, `permission_required` and `execution_failed` come from the
// companion's structured payload; `unauthorized`, `offline` and `timeout`
// are derived here from the transport, because a companion that rejects or
// never answers us cannot report on itself.
export type SecurityScreenStatus =
  | 'success'
  | 'unsupported'
  | 'unauthorized'
  | 'offline'
  | 'permission_required'
  | 'execution_failed'
  | 'timeout';

// What the companion actually did, which is not always what was asked for.
export type SecurityScreenAction = 'secure_attention_sequence' | 'lock' | 'none';

export type SecurityScreenOutcome = {
  status: SecurityScreenStatus;
  action: SecurityScreenAction;
  // True when `action` is the fallback rather than the real security screen.
  fallbackUsed: boolean;
  // Companion-supplied explanation, already trimmed and length-capped. Never
  // rendered as the primary message -- the UI picks that from `status`.
  detail: string | null;
};

// What to do when Windows refuses the real sequence. The phone always names
// this explicitly so the companion can never substitute an action the user
// was not asked to confirm.
export type SecurityScreenFallback = 'none' | 'lock';
type WakeRequestOptions = {
  wakeAddress?: string;
  wakePort?: number;
};
export type CompanionDiscoveryInfo = {
  serverIp: string;
  deviceName: string;
  macAddress: string | null;
  wakeAddress: string | null;
  wakePort: number | null;
  apiPort: number;
  tlsPort: number | null;
  tlsFingerprint: string | null;
  version: string | null;
  platform: Device['platform'];
};
type UnknownRecord = Record<string, unknown>;

const DISCOVERY_SUBNETS = [
  '10.0.0.',
  '10.0.1.',
  '192.168.0.',
  '192.168.1.',
  '192.168.2.',
  '192.168.3.',
  '192.168.4.',
  '192.168.5.',
];
const PRIORITY_HOSTS = [1, 10, 50, 100, 101, 102, 103, 104, 105, 150, 200, 254];
const DISCOVERY_TIMEOUT_MS = 700;
const DISCOVERY_BATCH_SIZE = 32;
const UDP_DISCOVERY_PORT = 41234;
const UDP_DISCOVERY_MESSAGE = 'wakemate:discover';
const UDP_DISCOVERY_TIMEOUT_MS = 900;
const DISCOVERY_RETRY_DELAY_MS = 250;
const COMPANION_HEALTH_TIMEOUT_MS = 1200;
const COMPANION_PAIRING_TIMEOUT_MS = 1200;
const DEVICE_STATUS_TIMEOUT_MS = 1200;
const PAIRING_CACHE_TTL_MS = 15000;
// Longer than the 5s used for ordinary commands: the companion may switch to
// the secure desktop or shell out to lock the workstation before answering.
const SECURITY_SCREEN_TIMEOUT_MS = 10000;
// Companion `detail` text is shown to the user, so cap it rather than trust
// its length.
const SECURITY_SCREEN_DETAIL_MAX_CHARS = 240;
const SECURE_ATTENTION_KEYSTROKE_MESSAGE =
  'Ctrl+Alt+Delete cannot be sent as a keystroke. Use the Windows Security control instead.';

const pairingValidationCache = new Map<string, { expiresAt: number; data: any }>();

const buildWakeAddresses = (device: Pick<Device, 'ip' | 'wakeAddress'>): string[] => {
  const configuredWakeAddress = device.wakeAddress?.trim() || '';
  const suggestedWakeAddress = getSuggestedWakeAddress(device.ip);

  return Array.from(
    new Set(
      [configuredWakeAddress, suggestedWakeAddress, GLOBAL_BROADCAST_ADDRESS].filter(
        (value): value is string => Boolean(value)
      )
    )
  );
};

const normalizeStoredValue = (value: string | null | undefined): string | null => {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : null;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeKey = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toLowerCase();

const toCandidateString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    return trimmedValue || null;
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
    const parsedValue = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsedValue) && parsedValue >= 0 && parsedValue <= 65535) {
      return parsedValue;
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

    if (!isRecord(current) || visited.has(current)) {
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

    if (!isRecord(current) || visited.has(current)) {
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

const scoreDiscoveryRecord = (record: UnknownRecord, fallbackIp?: string | null): number => {
  const ip = findValueByKeys(record, DISCOVERY_IP_KEYS, isValidIpAddress);
  const mac = findValueByKeys(record, DISCOVERY_MAC_KEYS, isValidMacAddress);
  const wakeAddress = findValueByKeys(record, DISCOVERY_WAKE_ADDRESS_KEYS, isValidIpAddress);
  const wakePort = findNumberByKeys(record, DISCOVERY_WAKE_PORT_KEYS);
  const name = findValueByKeys(record, DISCOVERY_NAME_KEYS);

  let score = 0;

  if (fallbackIp && ip === fallbackIp) {
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

const extractDiscoveryDetails = (
  payload: unknown,
  options: {
    fallbackIp?: string;
    fallbackName?: string;
  } = {}
) => {
  if (!isRecord(payload)) {
    return null;
  }

  const source = isRecord(payload.data) ? payload.data : payload;
  const preferredSource =
    collectRecords(source).sort(
      (left, right) => scoreDiscoveryRecord(right, options.fallbackIp) - scoreDiscoveryRecord(left, options.fallbackIp)
    )[0] ?? source;
  const deviceName =
    findValueByKeys(preferredSource, DISCOVERY_NAME_KEYS) ??
    findValueByKeys(source, DISCOVERY_NAME_KEYS) ??
    options.fallbackName ??
    null;
  const serverIp =
    findValueByKeys(preferredSource, DISCOVERY_IP_KEYS, isValidIpAddress) ??
    findValueByKeys(source, DISCOVERY_IP_KEYS, isValidIpAddress) ??
    options.fallbackIp ??
    null;
  const macAddressValue =
    findValueByKeys(preferredSource, DISCOVERY_MAC_KEYS, isValidMacAddress) ??
    findValueByKeys(source, DISCOVERY_MAC_KEYS, isValidMacAddress) ??
    findMatchingValue(preferredSource, isValidMacAddress) ??
    findMatchingValue(source, isValidMacAddress);
  const wakeAddress =
    findValueByKeys(preferredSource, DISCOVERY_WAKE_ADDRESS_KEYS, isValidIpAddress) ??
    findValueByKeys(source, DISCOVERY_WAKE_ADDRESS_KEYS, isValidIpAddress);
  const wakePort =
    findNumberByKeys(preferredSource, DISCOVERY_WAKE_PORT_KEYS) ??
    findNumberByKeys(source, DISCOVERY_WAKE_PORT_KEYS);
  const apiPort =
    findNumberByKeys(preferredSource, DISCOVERY_API_PORT_KEYS) ??
    findNumberByKeys(source, DISCOVERY_API_PORT_KEYS);
  const tlsPort =
    findNumberByKeys(preferredSource, DISCOVERY_TLS_PORT_KEYS) ??
    findNumberByKeys(source, DISCOVERY_TLS_PORT_KEYS);
  const tlsFingerprint = normalizeTlsFingerprint(
    findValueByKeys(preferredSource, DISCOVERY_TLS_FINGERPRINT_KEYS) ??
      findValueByKeys(source, DISCOVERY_TLS_FINGERPRINT_KEYS)
  );
  const version =
    findValueByKeys(preferredSource, DISCOVERY_VERSION_KEYS) ??
    findValueByKeys(payload, DISCOVERY_VERSION_KEYS);
  const platform = inferDevicePlatformFromMetadata(
    preferredSource,
    deviceName ?? options.fallbackName ?? (serverIp ? `WakeMATE ${serverIp}` : 'WakeMATE')
  );

  return {
    deviceName,
    serverIp,
    macAddress: macAddressValue ? normalizeMacAddress(macAddressValue) : null,
    wakeAddress: wakeAddress && isValidIpAddress(wakeAddress) ? wakeAddress : null,
    wakePort,
    apiPort,
    tlsPort,
    tlsFingerprint,
    version,
    platform,
  };
};

const parseDiscoveryResponse = (payload: unknown): CompanionDiscoveryInfo | null => {
  const details = extractDiscoveryDetails(payload);
  const serverIp = details?.serverIp ?? null;
  const deviceName = details?.deviceName ?? (serverIp ? `WakeMATE ${serverIp}` : null);

  if (!details || !serverIp || !isValidIpAddress(serverIp) || !deviceName) {
    return null;
  }

  return {
    serverIp,
    deviceName,
    macAddress: details.macAddress,
    wakeAddress: details.wakeAddress,
    wakePort: details.wakePort ?? null,
    apiPort: normalizeDiscoveredPort(details.apiPort, DEFAULT_API_PORT),
    tlsPort: details.tlsPort
      ? normalizeDiscoveredPort(details.tlsPort, DEFAULT_API_PORT + 1)
      : null,
    tlsFingerprint: details.tlsFingerprint,
    version: details.version,
    platform: details.platform,
  };
};

const parseHealthDiscoveryResponse = (payload: unknown, serverIp: string): CompanionDiscoveryInfo | null => {
  const details = extractDiscoveryDetails(payload, {
    fallbackIp: serverIp,
    fallbackName: `WakeMATE ${serverIp}`,
  });
  const deviceName = details?.deviceName ?? `WakeMATE ${serverIp}`;

  if (!deviceName) {
    return null;
  }

  return {
    serverIp,
    deviceName,
    macAddress: details?.macAddress ?? null,
    wakeAddress: details?.wakeAddress ?? null,
    wakePort: details?.wakePort ?? null,
    apiPort: normalizeDiscoveredPort(details?.apiPort, DEFAULT_API_PORT),
    tlsPort: details?.tlsPort
      ? normalizeDiscoveredPort(details.tlsPort, DEFAULT_API_PORT + 1)
      : null,
    tlsFingerprint: details?.tlsFingerprint ?? null,
    version: details?.version ?? null,
    platform: details?.platform ?? inferDevicePlatformFromMetadata(payload, deviceName),
  };
};

const mergeCompanionDiscoveries = (discoveries: CompanionDiscoveryInfo[]): CompanionDiscoveryInfo[] => {
  const byIp = new Map<string, CompanionDiscoveryInfo>();

  for (const discovery of discoveries) {
    const serverIp = discovery.serverIp.trim();
    if (!serverIp) {
      continue;
    }

    const existing = byIp.get(serverIp);
    if (!existing) {
      byIp.set(serverIp, discovery);
      continue;
    }

    byIp.set(serverIp, {
      ...existing,
      deviceName: existing.deviceName.startsWith('WakeMATE ') && !discovery.deviceName.startsWith('WakeMATE ')
        ? discovery.deviceName
        : existing.deviceName,
      macAddress: existing.macAddress ?? discovery.macAddress,
      wakeAddress: existing.wakeAddress ?? discovery.wakeAddress,
      wakePort: existing.wakePort ?? discovery.wakePort,
      apiPort: existing.apiPort || discovery.apiPort,
      tlsPort: existing.tlsPort ?? discovery.tlsPort,
      tlsFingerprint: existing.tlsFingerprint ?? discovery.tlsFingerprint,
      version: existing.version ?? discovery.version,
      platform: existing.platform === 'unknown' ? discovery.platform : existing.platform,
    });
  }

  return Array.from(byIp.values()).sort((left, right) =>
    left.deviceName.localeCompare(right.deviceName, undefined, { sensitivity: 'base' })
  );
};

const closeDiscoverySocket = (socket: { close: (callback?: (...args: unknown[]) => void) => unknown } | null) => {
  if (!socket) {
    return;
  }

  try {
    socket.close();
  } catch {
    // Ignore close failures while resolving discovery attempts.
  }
};

const discoverCompanionsViaUdpTargets = async (targets: string[]): Promise<CompanionDiscoveryInfo[]> =>
  new Promise((resolve) => {
    let socket: ReturnType<typeof dgram.createSocket> | null = null;
    let finished = false;
    const discoveries = new Map<string, CompanionDiscoveryInfo>();
    const uniqueTargets = Array.from(new Set(targets.map((target) => target.trim()).filter(Boolean)));

    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeoutId);
      closeDiscoverySocket(socket);
      resolve(mergeCompanionDiscoveries(Array.from(discoveries.values())));
    };

    const timeoutId = setTimeout(() => finish(), UDP_DISCOVERY_TIMEOUT_MS);

    try {
      socket = dgram.createSocket({ type: 'udp4' });
    } catch (error) {
      console.warn('UDP discovery unavailable, falling back to HTTP scan:', error);
      finish();
      return;
    }

    socket.once('error', () => finish());
    socket.on('message', (message: { toString: (encoding?: string) => string }) => {
      try {
        const parsed = parseDiscoveryResponse(JSON.parse(message.toString('utf8')));
        if (parsed) {
          discoveries.set(parsed.serverIp, parsed);
        }
      } catch {
        // Ignore malformed discovery packets while waiting for the rest.
      }
    });

    socket.once('listening', () => {
      try {
        if (uniqueTargets.includes(GLOBAL_BROADCAST_ADDRESS)) {
          socket.setBroadcast(true);
        }

        if (uniqueTargets.length === 0) {
          finish();
          return;
        }

        let remainingTargets = uniqueTargets.length;
        let failedTargets = 0;

        for (const target of uniqueTargets) {
          socket.send(
            UDP_DISCOVERY_MESSAGE,
            undefined,
            undefined,
            UDP_DISCOVERY_PORT,
            target,
            (error?: Error) => {
              remainingTargets -= 1;

              if (error) {
                failedTargets += 1;
              }

              if (remainingTargets === 0 && failedTargets === uniqueTargets.length) {
                finish();
              }
            }
          );
        }
      } catch {
        finish();
      }
    });

    try {
      socket.bind(0, '0.0.0.0');
    } catch {
      finish();
    }
  });

const discoverCompanionsViaUdp = async (): Promise<CompanionDiscoveryInfo[]> =>
  discoverCompanionsViaUdpTargets([GLOBAL_BROADCAST_ADDRESS]);

const persistStringSetting = async (key: string, value: string): Promise<void> => {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    await AsyncStorage.removeItem(key);
    return;
  }

  await AsyncStorage.setItem(key, trimmedValue);
};

const persistNumberSetting = async (key: string, value: number | null | undefined): Promise<void> => {
  if (value === null || value === undefined) {
    await AsyncStorage.removeItem(key);
    return;
  }

  await AsyncStorage.setItem(key, String(value));
};

const removeLegacyServerToken = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(SERVER_TOKEN_KEY);
  } catch (error) {
    // The secure value is still usable. Retry this cleanup on the next read so
    // a transient storage failure cannot leave the plaintext copy indefinitely.
    console.error('Error removing legacy plaintext pairing token:', error);
  }
};

const readOrMigrateServerToken = async (): Promise<string | null> => {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error('Secure credential storage is unavailable on this device.');
  }

  const secureToken = normalizeStoredValue(
    await SecureStore.getItemAsync(SECURE_SERVER_TOKEN_KEY, SECURE_SERVER_TOKEN_OPTIONS)
  );
  if (secureToken) {
    await removeLegacyServerToken();
    return secureToken;
  }

  const legacyToken = normalizeStoredValue(await AsyncStorage.getItem(SERVER_TOKEN_KEY));
  if (!legacyToken) {
    await removeLegacyServerToken();
    return null;
  }

  // Write first, delete second. A crash between these operations leaves a
  // recoverable plaintext copy that the next read will migrate again.
  await SecureStore.setItemAsync(
    SECURE_SERVER_TOKEN_KEY,
    legacyToken,
    SECURE_SERVER_TOKEN_OPTIONS
  );
  await removeLegacyServerToken();
  return legacyToken;
};

const readStoredTlsFingerprint = async (): Promise<string | null> => {
  if (!(await SecureStore.isAvailableAsync())) {
    return null;
  }

  const storedValue = await SecureStore.getItemAsync(
    SECURE_SERVER_TLS_FINGERPRINT_KEY,
    SECURE_SERVER_TOKEN_OPTIONS
  );
  const fingerprint = normalizeTlsFingerprint(storedValue);
  if (storedValue && !fingerprint) {
    await SecureStore.deleteItemAsync(
      SECURE_SERVER_TLS_FINGERPRINT_KEY,
      SECURE_SERVER_TOKEN_OPTIONS
    );
  }
  return fingerprint;
};

const persistTlsFingerprint = async (
  fingerprint: string | null | undefined
): Promise<void> => {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error('Secure credential storage is unavailable on this device.');
  }

  const trimmedValue = fingerprint?.trim() ?? '';
  if (!trimmedValue) {
    await SecureStore.deleteItemAsync(
      SECURE_SERVER_TLS_FINGERPRINT_KEY,
      SECURE_SERVER_TOKEN_OPTIONS
    );
    return;
  }

  const normalized = normalizeTlsFingerprint(trimmedValue);
  if (!normalized) {
    throw new Error('The pairing QR code contained an invalid TLS fingerprint.');
  }
  await SecureStore.setItemAsync(
    SECURE_SERVER_TLS_FINGERPRINT_KEY,
    normalized,
    SECURE_SERVER_TOKEN_OPTIONS
  );
};

const chunkArray = <T,>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const normalizeDiscoveredPort = (value: number | null | undefined, fallback: number): number =>
  Number.isInteger(value) && (value ?? 0) > 0 && (value ?? 0) <= 65535 ? (value as number) : fallback;

const parseStoredPort = (value: string | null | undefined): number | null => {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return null;
  }

  const parsedValue = Number.parseInt(trimmedValue, 10);
  return Number.isInteger(parsedValue) && parsedValue > 0 && parsedValue <= 65535 ? parsedValue : null;
};

const getStoredServerPort = async (): Promise<number | null> => {
  try {
    return parseStoredPort(await AsyncStorage.getItem(SERVER_PORT_KEY));
  } catch (error) {
    console.error('Error getting companion port:', error);
    return null;
  }
};

type CompanionEndpoint = { ip: string; port: number; tlsFingerprint: string | null };

// Finds a saved computer by id, without going through `getDevices()` -- that
// runs the widget sync and legacy migration, which would recurse.
const findSavedDevice = async (deviceId: string | null | undefined): Promise<Device | null> => {
  const trimmedId = deviceId?.trim();
  if (!trimmedId) {
    return null;
  }

  try {
    const raw = await AsyncStorage.getItem('devices');
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }

    const match = parsed.find((entry) => isRecord(entry) && entry.id === trimmedId);
    return match ? normalizeDevice(match as any) : null;
  } catch (error) {
    console.error('Error reading the saved device for a companion request:', error);
    return null;
  }
};

// Resolves which companion to talk to, preferring the saved computer's own
// connection details over the pre-multi-device globals.
//
// `deviceId` is what makes multiple computers work: without it we fall back to
// the legacy single-companion values, which is only correct while a user still
// has one unmigrated computer.
const resolveTargetEndpoint = async (
  explicitIp?: string | null,
  explicitPort?: number | null,
  deviceId?: string | null
): Promise<CompanionEndpoint> => {
  const device = await findSavedDevice(deviceId);

  if (device) {
    const targetIp = normalizeStoredValue(explicitIp) ?? device.ip;
    const fingerprint = await getDeviceTlsFingerprint(device.id);
    // The pin belongs to the address it was scanned from. Talking to a
    // different host on the same record must not reuse it.
    const usableFingerprint = targetIp === device.ip ? fingerprint : null;

    if (explicitPort !== null && explicitPort !== undefined) {
      return {
        ip: targetIp,
        port: normalizeDiscoveredPort(explicitPort, DEFAULT_API_PORT),
        tlsFingerprint: usableFingerprint,
      };
    }

    // A fingerprint means pinned HTTPS, which listens on the TLS port.
    const preferredPort = usableFingerprint ? device.tlsPort ?? null : device.apiPort ?? null;
    return {
      ip: targetIp,
      port: normalizeDiscoveredPort(preferredPort, DEFAULT_API_PORT),
      tlsFingerprint: usableFingerprint,
    };
  }

  const [storedIpValue, storedTlsFingerprint] = await Promise.all([
    AsyncStorage.getItem(SERVER_IP_KEY),
    readStoredTlsFingerprint(),
  ]);
  const storedIp = normalizeStoredValue(storedIpValue);
  const targetIp = normalizeStoredValue(explicitIp) ?? storedIp;

  if (!targetIp) {
    throw new Error(COMPANION_SERVER_IP_REQUIRED_MESSAGE);
  }

  if (explicitPort !== null && explicitPort !== undefined) {
    return {
      ip: targetIp,
      port: normalizeDiscoveredPort(explicitPort, DEFAULT_API_PORT),
      tlsFingerprint:
        storedIp && storedIp === targetIp ? storedTlsFingerprint : null,
    };
  }

  const storedPort = await getStoredServerPort();
  return {
    ip: targetIp,
    port: normalizeDiscoveredPort(
      storedIp && storedIp === targetIp ? storedPort : null,
      DEFAULT_API_PORT
    ),
    tlsFingerprint:
      storedIp && storedIp === targetIp ? storedTlsFingerprint : null,
  };
};

const fetchCompanionHealthDiscovery = async (ip: string, port: number = DEFAULT_API_PORT): Promise<CompanionDiscoveryInfo | null> => {
  try {
    const response = await requestCompanion<any>({
      ip,
      port,
      path: '/v1/health',
      timeoutMs: DISCOVERY_TIMEOUT_MS,
      headers: {
        'Cache-Control': 'no-cache',
      },
    });

    if (response.data?.ok !== true || response.data?.data?.status !== 'online') {
      return null;
    }

    const parsed = parseHealthDiscoveryResponse(response.data, ip);
    return parsed ? { ...parsed, apiPort: normalizeDiscoveredPort(parsed.apiPort, port) } : null;
  } catch {
    return null;
  }
};

const wait = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

// The companion usually is one of the saved devices, so probing their IPs
// directly finds it even when UDP broadcast is unavailable (iOS blocks it
// without the multicast entitlement) and without waiting for a subnet sweep.
const probeSavedDevicesForCompanions = async (): Promise<CompanionDiscoveryInfo[]> => {
  try {
    const devices = await deviceService.getDevices();
    const uniqueIps = Array.from(
      new Set(devices.map((device) => device.ip.trim()).filter((ip) => isValidIpAddress(ip)))
    );
    const results = await Promise.all(uniqueIps.map((ip) => fetchCompanionHealthDiscovery(ip)));
    return results.filter((discovery): discovery is CompanionDiscoveryInfo => Boolean(discovery));
  } catch (error) {
    console.error('Error probing saved devices for companions:', error);
    return [];
  }
};

const discoverCompanionsOnce = async (
  storedIp: string | null,
  storedPort: number | null
): Promise<CompanionDiscoveryInfo[]> => {
  const [udpDiscoveries, storedDiscovery, savedDeviceDiscoveries] = await Promise.all([
    discoverCompanionsViaUdp(),
    storedIp ? fetchCompanionHealthDiscovery(storedIp, normalizeDiscoveredPort(storedPort, DEFAULT_API_PORT)) : Promise.resolve(null),
    probeSavedDevicesForCompanions(),
  ]);
  const directDiscoveries = mergeCompanionDiscoveries([
    ...udpDiscoveries,
    ...(storedDiscovery ? [storedDiscovery] : []),
    ...savedDeviceDiscoveries,
  ]);

  if (directDiscoveries.length > 0) {
    return directDiscoveries;
  }

  const subnetDiscoveries = await Promise.all(DISCOVERY_SUBNETS.map((subnet) => scanSubnetForCompanions(subnet)));
  const subnetHealthDiscoveries = mergeCompanionDiscoveries(subnetDiscoveries.flat());

  if (subnetHealthDiscoveries.length === 0) {
    return [];
  }

  const targetedUdpDiscoveries = await discoverCompanionsViaUdpTargets(
    subnetHealthDiscoveries.map((discovery) => discovery.serverIp)
  );

  return mergeCompanionDiscoveries([
    ...subnetHealthDiscoveries,
    ...targetedUdpDiscoveries,
  ]);
};

const scanSubnetForCompanions = async (subnet: string): Promise<CompanionDiscoveryInfo[]> => {
  const remainingHosts = Array.from({ length: 254 }, (_, index) => index + 1).filter(
    (host) => !PRIORITY_HOSTS.includes(host)
  );
  const hostOrder = [...PRIORITY_HOSTS, ...remainingHosts];
  const discoveries: CompanionDiscoveryInfo[] = [];

  for (const batch of chunkArray(hostOrder, DISCOVERY_BATCH_SIZE)) {
    const results = await Promise.all(
      batch.map(async (host) => {
        const ip = `${subnet}${host}`;
        return fetchCompanionHealthDiscovery(ip);
      })
    );

    discoveries.push(...results.filter((discovery): discovery is CompanionDiscoveryInfo => Boolean(discovery)));
  }

  return mergeCompanionDiscoveries(discoveries);
};

const normalizeNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildAuthHeaders = (token: string | null): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers[AUTH_HEADER] = token;
  }

  return headers;
};

const isUnauthorizedStatus = (status: number | undefined): boolean => status === 401;

const extractCompanionErrorMessage = (payload: unknown): string | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const message = toCandidateString(payload.message) ?? toCandidateString(payload.error);
  return message ?? null;
};

const normalizeCompanionRequestError = (error: unknown, fallbackMessage: string): Error => {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const companionMessage = extractCompanionErrorMessage(error.response?.data);

    if (isUnauthorizedStatus(status)) {
      return new Error(COMPANION_PAIRING_TOKEN_REJECTED_MESSAGE);
    }

    if (companionMessage) {
      return new Error(companionMessage);
    }

    if (typeof status === 'number') {
      return new Error(`Companion request failed with status ${status}.`);
    }

    if (typeof error.message === 'string' && error.message.trim()) {
      return new Error(error.message);
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error;
  }

  return new Error(fallbackMessage);
};

// True for Ctrl+Alt+Delete in any order or spelling, mirroring the
// companion's own guard in `src/input.rs`.
export const isSecureAttentionCombo = (key: string): boolean => {
  const parts = key
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length !== 3) {
    return false;
  }

  const seen = new Set<string>();
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') {
      seen.add('control');
    } else if (part === 'alt') {
      seen.add('alt');
    } else if (part === 'delete' || part === 'del') {
      seen.add('delete');
    } else {
      return false;
    }
  }

  return seen.size === 3;
};

const SECURITY_SCREEN_STATUSES: readonly SecurityScreenStatus[] = [
  'success',
  'unsupported',
  'unauthorized',
  'offline',
  'permission_required',
  'execution_failed',
  'timeout',
];

const SECURITY_SCREEN_ACTIONS: readonly SecurityScreenAction[] = [
  'secure_attention_sequence',
  'lock',
  'none',
];

const toSecurityScreenDetail = (value: unknown): string | null => {
  const detail = toCandidateString(value);
  return detail ? detail.slice(0, SECURITY_SCREEN_DETAIL_MAX_CHARS) : null;
};

// Reads the companion's structured result. Anything unrecognised is reported
// as `execution_failed` rather than assumed successful -- an old or unexpected
// companion must never make the app claim the security screen opened.
const parseSecurityScreenPayload = (payload: unknown): SecurityScreenOutcome => {
  const envelope = isRecord(payload) ? payload : null;
  const result = envelope && isRecord(envelope.data) ? envelope.data : null;

  const status = SECURITY_SCREEN_STATUSES.find((candidate) => candidate === result?.status);
  const action = SECURITY_SCREEN_ACTIONS.find((candidate) => candidate === result?.action);
  const detail = toSecurityScreenDetail(result?.detail) ?? toSecurityScreenDetail(envelope?.message);

  if (!status) {
    return {
      status: 'execution_failed',
      action: 'none',
      fallbackUsed: false,
      detail,
    };
  }

  return {
    status,
    action: action ?? 'none',
    fallbackUsed: result?.fallback_used === true,
    detail,
  };
};

// Maps a transport-level failure onto the same vocabulary. The companion
// cannot describe its own unreachability, so these three states are decided
// from the request itself.
const classifySecurityScreenError = (error: unknown): SecurityScreenOutcome => {
  const base = { action: 'none' as const, fallbackUsed: false };

  if (isAxiosError(error)) {
    const status = error.response?.status;
    const detail = toSecurityScreenDetail(extractCompanionErrorMessage(error.response?.data));

    if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message ?? '')) {
      return { ...base, status: 'timeout', detail: null };
    }

    if (status === undefined) {
      return { ...base, status: 'offline', detail: null };
    }

    if (isUnauthorizedStatus(status)) {
      return { ...base, status: 'unauthorized', detail };
    }

    if (status === 403 || status === 429) {
      return { ...base, status: 'permission_required', detail };
    }

    if (status === 501) {
      return { ...base, status: 'unsupported', detail };
    }

    return { ...base, status: 'execution_failed', detail };
  }

  if (/timeout/i.test(error instanceof Error ? error.message : '')) {
    return { ...base, status: 'timeout', detail: null };
  }

  return {
    ...base,
    status: 'execution_failed',
    detail: toSecurityScreenDetail(error instanceof Error ? error.message : null),
  };
};

const mapLegacyCommand = (command: string, params: CommandParams = {}) => {
  switch (command) {
    case 'mouse_move':
      return {
        type: 'mouse_move',
        delta_x: normalizeNumber(params.dx ?? params.deltaX, 0),
        delta_y: normalizeNumber(params.dy ?? params.deltaY, 0),
      };
    case 'mouse_click':
      return {
        type: 'mouse_click',
        button: (params.button ?? 'left') as MouseButton,
        double: Boolean(params.double),
      };
    case 'mouse_button':
      return {
        type: 'mouse_button',
        button: (params.button ?? 'left') as MouseButton,
        action: (params.action ?? 'down') as MouseButtonAction,
      };
    case 'mouse_scroll': {
      const rawAmount = normalizeNumber(params.amount, 3);
      const direction: ScrollDirection = params.direction === 'down' || rawAmount < 0 ? 'down' : 'up';
      return {
        type: 'mouse_scroll',
        direction,
        amount: Math.max(1, Math.abs(rawAmount)),
      };
    }
    case 'keyboard_input':
    case 'text_input':
      return {
        type: 'text_input',
        text: String(params.text ?? ''),
      };
    case 'keyboard_special':
    case 'key_press': {
      const key = String(params.key ?? '');

      // Windows filters synthetic Ctrl+Alt+Delete out of the Secure Attention
      // Sequence, so this never opens the security screen -- it only leaks a
      // bare Delete into whatever window is focused. The companion refuses it
      // too; this stops it before it leaves the phone.
      if (isSecureAttentionCombo(key)) {
        throw new Error(SECURE_ATTENTION_KEYSTROKE_MESSAGE);
      }

      return {
        type: 'key_press',
        key,
      };
    }
    case 'security_screen':
      return {
        type: 'security_screen',
        fallback: params.fallback === 'lock' ? 'lock' : 'none',
      };
    case 'media_play_pause':
      return { type: 'media', action: 'play_pause' };
    case 'media_next':
      return { type: 'media', action: 'next' };
    case 'media_prev':
      return { type: 'media', action: 'previous' };
    case 'volume_up':
      return { type: 'media', action: 'volume_up' };
    case 'volume_down':
      return { type: 'media', action: 'volume_down' };
    case 'volume_mute':
      return { type: 'media', action: 'mute' };
    case 'sleep':
      return { type: 'system', action: 'sleep' };
    case 'restart':
      return { type: 'system', action: 'restart' };
    case 'shutdown':
      return { type: 'system', action: 'shutdown' };
    case 'lock':
      return { type: 'system', action: 'lock' };
    case 'logoff':
      return { type: 'system', action: 'logoff' };
    default:
      throw new Error(`Unsupported WakeMATE command: ${command}`);
  }
};

// Prefers the computer's own pairing token, falling back to the legacy shared
// one so a user who has not re-paired since the multi-device change keeps
// working.
const requireServerToken = async (deviceId?: string | null): Promise<string> => {
  const trimmedId = deviceId?.trim();

  if (trimmedId) {
    const deviceToken = normalizeStoredValue(await getDeviceToken(trimmedId));
    if (deviceToken) {
      return deviceToken;
    }
  }

  const token = normalizeStoredValue(await deviceService.getServerToken());

  if (!token) {
    throw new Error(COMPANION_PAIRING_TOKEN_REQUIRED_MESSAGE);
  }

  return token;
};

const deviceService = {
  async getCompanionSetupError(
    options: {
      requireToken?: boolean;
      validateToken?: boolean;
      serverIp?: string;
      deviceId?: string | null;
    } = {}
  ): Promise<string | null> {
    const requireToken = options.requireToken ?? true;
    const deviceId = options.deviceId?.trim() || null;
    const [serverIp, token] = await Promise.all([
      options.serverIp ? Promise.resolve(options.serverIp) : this.getServerAddress(),
      // Fall back to the legacy shared token so an unmigrated setup still
      // reports itself as paired.
      deviceId
        ? getDeviceToken(deviceId).then((value) => value ?? this.getServerToken())
        : this.getServerToken(),
    ]);

    if (!normalizeStoredValue(serverIp)) {
      return COMPANION_SERVER_IP_REQUIRED_MESSAGE;
    }

    if (requireToken && !normalizeStoredValue(token)) {
      return COMPANION_PAIRING_TOKEN_REQUIRED_MESSAGE;
    }

    if (options.validateToken && requireToken) {
      try {
        await this.checkPairing(serverIp ?? undefined, deviceId);
      } catch (error) {
        return normalizeCompanionRequestError(
          error,
          'Unable to verify the pairing token with the companion.'
        ).message;
      }
    }

    return null;
  },

  async getServerAddress(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(SERVER_IP_KEY);
    } catch (error) {
      console.error('Error getting server address:', error);
      return null;
    }
  },

  async setServerAddress(ip: string): Promise<void> {
    try {
      await this.setServerConnection(ip);
    } catch (error) {
      console.error('Error setting server address:', error);
      throw error;
    }
  },

  async getServerPort(): Promise<number | null> {
    return getStoredServerPort();
  },

  async setServerPort(port: number | null | undefined): Promise<void> {
    try {
      await persistNumberSetting(SERVER_PORT_KEY, normalizeDiscoveredPort(port, DEFAULT_API_PORT));
    } catch (error) {
      console.error('Error setting companion port:', error);
      throw error;
    }
  },

  async setServerConnection(ip: string, port?: number | null): Promise<void> {
    const trimmedIp = ip.trim();
    const currentIp = normalizeStoredValue(await this.getServerAddress());
    const currentPort = await this.getServerPort();
    const resolvedPort =
      port !== null && port !== undefined
        ? normalizeDiscoveredPort(port, DEFAULT_API_PORT)
        : normalizeDiscoveredPort(currentIp === trimmedIp ? currentPort : null, DEFAULT_API_PORT);

    try {
      const updates: Promise<void>[] = [
        persistStringSetting(SERVER_IP_KEY, trimmedIp),
        persistNumberSetting(SERVER_PORT_KEY, resolvedPort),
      ];
      if (currentIp !== trimmedIp) {
        const currentFingerprint = await readStoredTlsFingerprint();
        if (currentFingerprint) {
          updates.push(persistTlsFingerprint(null));
        }
      }
      await Promise.all(updates);
    } catch (error) {
      console.error('Error setting companion connection:', error);
      throw error;
    }
  },

  async getServerTlsFingerprint(): Promise<string | null> {
    try {
      return await readStoredTlsFingerprint();
    } catch (error) {
      console.error('Error getting companion TLS fingerprint:', error);
      return null;
    }
  },

  async setServerTlsFingerprint(
    fingerprint: string | null | undefined
  ): Promise<void> {
    try {
      await persistTlsFingerprint(fingerprint);
    } catch (error) {
      console.error('Error setting companion TLS fingerprint:', error);
      throw error;
    }
  },

  async getServerToken(): Promise<string | null> {
    try {
      return await readOrMigrateServerToken();
    } catch (error) {
      console.error('Error getting pairing token:', error);
      return null;
    }
  },

  async setServerToken(token: string): Promise<void> {
    try {
      if (!(await SecureStore.isAvailableAsync())) {
        throw new Error('Secure credential storage is unavailable on this device.');
      }

      const trimmedToken = token.trim();
      if (!trimmedToken) {
        await Promise.all([
          SecureStore.deleteItemAsync(SECURE_SERVER_TOKEN_KEY, SECURE_SERVER_TOKEN_OPTIONS),
          AsyncStorage.removeItem(SERVER_TOKEN_KEY),
        ]);
        return;
      }

      await SecureStore.setItemAsync(
        SECURE_SERVER_TOKEN_KEY,
        trimmedToken,
        SECURE_SERVER_TOKEN_OPTIONS
      );
      await AsyncStorage.removeItem(SERVER_TOKEN_KEY);
    } catch (error) {
      console.error('Error setting pairing token:', error);
      throw error;
    }
  },

  async getDevices(): Promise<Device[]> {
    try {
      const devices = await AsyncStorage.getItem('devices');
      if (!devices) {
        return [];
      }

      const parsedDevices = JSON.parse(devices);
      if (!Array.isArray(parsedDevices)) {
        return [];
      }

      const normalized = parsedDevices.map((device) => normalizeDevice(device));
      return this.migrateLegacyCompanionCredentials(normalized);
    } catch (error) {
      console.error('Error getting devices:', error);
      return [];
    }
  },

  // Adopts the pre-multi-device globals onto the one computer they belonged
  // to, matched by IP. Runs at most once: the legacy keys are cleared after a
  // successful adoption, and a no-op when there is nothing to migrate.
  //
  // Deliberately conservative -- if the old IP matches no saved computer we
  // leave the globals alone rather than guess, and `resolveTargetEndpoint`
  // keeps falling back to them.
  async migrateLegacyCompanionCredentials(devices: Device[]): Promise<Device[]> {
    try {
      const legacyIp = normalizeStoredValue(await AsyncStorage.getItem(SERVER_IP_KEY));
      if (!legacyIp) {
        return devices;
      }

      const target = devices.find((device) => device.ip === legacyIp);
      if (!target) {
        return devices;
      }

      const [{ token, fingerprint }, legacyPort] = await Promise.all([
        readLegacyCredentials(),
        getStoredServerPort(),
      ]);

      if (!token) {
        return devices;
      }

      // A stored fingerprint means the legacy port was the TLS one.
      const migrated: Device = {
        ...target,
        apiPort: fingerprint ? target.apiPort ?? DEFAULT_API_PORT : legacyPort ?? DEFAULT_API_PORT,
        tlsPort: fingerprint ? legacyPort ?? target.tlsPort ?? null : target.tlsPort ?? null,
      };

      await setDeviceToken(target.id, token);
      if (fingerprint) {
        await setDeviceTlsFingerprint(target.id, fingerprint);
      }

      const nextDevices = devices.map((device) => (device.id === target.id ? migrated : device));
      await AsyncStorage.setItem('devices', JSON.stringify(nextDevices));

      // Only now is it safe to drop the originals; a crash before this point
      // just replays the migration next launch.
      await clearLegacyCredentials();
      await AsyncStorage.multiRemove([SERVER_IP_KEY, SERVER_PORT_KEY]);

      return nextDevices;
    } catch (error) {
      console.warn('Could not migrate the legacy companion credentials:', error);
      return devices;
    }
  },

  // Completes pairing for one computer in a single call: store its connection
  // details and QR token, swap that for a per-device token where the companion
  // supports it, then wait for the desktop approval.
  //
  // Every step degrades instead of aborting. The previous flow gave up the
  // moment enrollment threw -- it only fell back to the legacy activation when
  // enrollment returned null (a 404) -- so one transient 429 ("another pairing
  // request is already waiting") or a 403 from the pre-logon service left the
  // token saved but the pairing unfinished, with no reason shown.
  async pairDeviceFromQr(
    deviceId: string,
    options: {
      ip: string;
      token: string;
      tlsFingerprint?: string | null;
      apiPort?: number | null;
      tlsPort?: number | null;
      phoneName?: string | null;
      timeoutMs?: number;
    }
  ): Promise<{
    status: 'approved' | 'denied' | 'timeout' | 'unsupported' | 'failed';
    detail: string | null;
  }> {
    const timeoutMs = options.timeoutMs ?? 45000;
    const fingerprint = normalizeTlsFingerprint(options.tlsFingerprint);

    // Persist the connection first so every later call resolves to this
    // computer, not whichever one was paired last.
    await this.setDeviceCompanionConnection(deviceId, {
      ip: options.ip,
      apiPort: options.apiPort ?? null,
      tlsPort: options.tlsPort ?? null,
    });
    await setDeviceTlsFingerprint(deviceId, fingerprint);
    await setDeviceToken(deviceId, options.token);

    let enrollment: { deviceId: string; deviceToken: string } | null = null;
    let enrollmentError: string | null = null;

    // One retry: a pending prompt from an earlier scan makes the companion
    // answer 429 until it clears.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        enrollment = await this.enrollDevice(options.ip, options.phoneName, deviceId);
        enrollmentError = null;
        break;
      } catch (error) {
        enrollmentError = error instanceof Error ? error.message : 'Enrollment failed.';
        const isBusy = isAxiosError(error) && error.response?.status === 429;
        if (!isBusy || attempt === 1) {
          break;
        }
        await wait(3000);
      }
    }

    try {
      if (enrollment) {
        const approval = await this.waitForPairingApproval(options.ip, {
          timeoutMs,
          deviceId: enrollment.deviceId,
          localDeviceId: deviceId,
        });

        if (approval === 'approved') {
          // Only now replace the shared QR token: if this write happened
          // earlier and approval never came, the device would be left holding
          // a token the companion has not activated.
          await setDeviceToken(deviceId, enrollment.deviceToken);
        }

        return { status: approval, detail: null };
      }

      // No enrollment -- either an older companion (404) or a failure we are
      // deliberately not treating as fatal. The shared-token activation still
      // gets remote controls switched on.
      await this.activatePairedControls(options.ip, options.token, deviceId);
      const approval = await this.waitForPairingApproval(options.ip, {
        timeoutMs,
        localDeviceId: deviceId,
      });

      return { status: approval, detail: enrollmentError };
    } catch (error) {
      const detail = error instanceof Error ? error.message : null;
      return { status: 'failed', detail: detail ?? enrollmentError };
    }
  },

  async getDeviceCompanionToken(deviceId: string): Promise<string | null> {
    return getDeviceToken(deviceId);
  },

  async setDeviceCompanionToken(deviceId: string, token: string | null): Promise<void> {
    await setDeviceToken(deviceId, token);
  },

  async setDeviceCompanionTlsFingerprint(
    deviceId: string,
    fingerprint: string | null
  ): Promise<void> {
    await setDeviceTlsFingerprint(deviceId, fingerprint);
  },

  async getDeviceCompanionTlsFingerprint(deviceId: string): Promise<string | null> {
    return getDeviceTlsFingerprint(deviceId);
  },

  // Saves one computer's connection details without touching any other.
  async setDeviceCompanionConnection(
    deviceId: string,
    connection: { ip?: string; apiPort?: number | null; tlsPort?: number | null }
  ): Promise<Device | null> {
    const devices = await this.getDevices();
    const target = devices.find((device) => device.id === deviceId);
    if (!target) {
      return null;
    }

    const updated: Device = {
      ...target,
      ip: connection.ip?.trim() || target.ip,
      apiPort: connection.apiPort ?? target.apiPort,
      tlsPort: connection.tlsPort === undefined ? target.tlsPort : connection.tlsPort,
    };

    await this.saveDevices(
      devices.map((device) => (device.id === deviceId ? updated : device))
    );
    return updated;
  },

  async clearDeviceCompanionCredentials(deviceId: string): Promise<void> {
    await clearDeviceCredentials(deviceId);
  },

  async saveDevices(devices: Device[]): Promise<void> {
    try {
      const normalizedDevices = devices.map((device) => normalizeDevice(device));

      // Deleting a computer happens by filtering this list, in more than one
      // screen. Pruning here means no caller has to remember to clear the
      // secrets, and a removed computer never leaves a usable token behind.
      const previousRaw = await AsyncStorage.getItem('devices');
      const survivingIds = new Set(normalizedDevices.map((device) => device.id));
      let removedIds: string[] = [];
      try {
        const previous = previousRaw ? JSON.parse(previousRaw) : [];
        if (Array.isArray(previous)) {
          removedIds = previous
            .filter((entry) => isRecord(entry) && typeof entry.id === 'string')
            .map((entry) => (entry as { id: string }).id)
            .filter((id) => !survivingIds.has(id));
        }
      } catch {
        // Unreadable previous list: nothing reliable to prune.
      }

      await AsyncStorage.setItem('devices', JSON.stringify(normalizedDevices));
      syncDevicesToWidgetStorage(normalizedDevices);

      await Promise.all(
        removedIds.map((id) =>
          clearDeviceCredentials(id).catch((error) => {
            console.warn('Could not clear credentials for a removed device:', error);
          })
        )
      );
    } catch (error) {
      console.error('Error saving devices:', error);
      throw error;
    }
  },

  async syncWidgetData(): Promise<void> {
    try {
      const devices = await this.getDevices();
      syncDevicesToWidgetStorage(devices);
    } catch (error) {
      console.error('Error syncing widget data:', error);
    }
  },

  async getCompanionHealth(serverIp?: string): Promise<any> {
    const {
      ip: targetIp,
      port: targetPort,
      tlsFingerprint,
    } = await resolveTargetEndpoint(serverIp);
    const response = await requestCompanion<any>({
      ip: targetIp,
      port: targetPort,
      path: '/v1/health',
      timeoutMs: COMPANION_HEALTH_TIMEOUT_MS,
      tlsFingerprint,
      headers: {
        'Cache-Control': 'no-cache',
      },
    });

    return response.data;
  },

  async getCompanionInfo(serverIp?: string): Promise<any> {
    const {
      ip: targetIp,
      port: targetPort,
      tlsFingerprint,
    } = await resolveTargetEndpoint(serverIp);
    const token = normalizeStoredValue(await this.getServerToken());
    try {
      const response = await requestCompanion<any>({
        ip: targetIp,
        port: targetPort,
        path: '/v1/info',
        timeoutMs: COMPANION_HEALTH_TIMEOUT_MS,
        tlsFingerprint,
        headers: {
          'Cache-Control': 'no-cache',
          ...(token ? { [AUTH_HEADER]: token } : {}),
        },
      });

      return response.data;
    } catch (error) {
      throw normalizeCompanionRequestError(error, 'Unable to load companion info.');
    }
  },

  async discoverCompanion(): Promise<CompanionDiscoveryInfo | null> {
    const discoveries = await this.discoverCompanions();
    const firstDiscovery = discoveries[0] ?? null;

    if (firstDiscovery) {
      await this.setServerConnection(firstDiscovery.serverIp, firstDiscovery.apiPort);
    }

    return firstDiscovery;
  },

  async discoverCompanions(): Promise<CompanionDiscoveryInfo[]> {
    const storedIp = normalizeStoredValue(await this.getServerAddress());
    const storedPort = await this.getServerPort();
    const firstAttempt = await discoverCompanionsOnce(storedIp, storedPort);
    if (firstAttempt.length > 0) {
      return firstAttempt;
    }

    await wait(DISCOVERY_RETRY_DELAY_MS);
    return discoverCompanionsOnce(storedIp, storedPort);
  },

  async discoverCompanionServer(): Promise<string | null> {
    const discovery = await this.discoverCompanion();
    return discovery?.serverIp ?? null;
  },

  async checkPairing(serverIp?: string, localDeviceId?: string | null): Promise<any> {
    const {
      ip: targetIp,
      port: targetPort,
      tlsFingerprint,
    } = await resolveTargetEndpoint(serverIp, null, localDeviceId);
    const token = await requireServerToken(localDeviceId);
    const cacheKey = `${targetIp}:${targetPort}:${tlsFingerprint ?? 'http'}:${token}`;
    const cachedResult = pairingValidationCache.get(cacheKey);

    if (cachedResult && cachedResult.expiresAt > Date.now()) {
      return cachedResult.data;
    }

    try {
      const response = await requestCompanion<any>({
        ip: targetIp,
        port: targetPort,
        path: '/v1/pairing/check',
        timeoutMs: COMPANION_PAIRING_TIMEOUT_MS,
        tlsFingerprint,
        headers: buildAuthHeaders(token),
      });

      pairingValidationCache.set(cacheKey, {
        expiresAt: Date.now() + PAIRING_CACHE_TTL_MS,
        data: response.data,
      });
      return response.data;
    } catch (error) {
      pairingValidationCache.delete(cacheKey);
      throw normalizeCompanionRequestError(error, 'Unable to verify the pairing token with the companion.');
    }
  },

  async getPairingStatus(
    serverIp?: string,
    deviceId?: string | null,
    localDeviceId?: string | null
  ): Promise<{
    approval: 'idle' | 'pending' | 'approved' | 'denied' | '';
    allowInputCommands: boolean;
    allowPowerCommands: boolean;
  } | null> {
    const {
      ip: targetIp,
      port: targetPort,
      tlsFingerprint,
    } = await resolveTargetEndpoint(serverIp, null, localDeviceId);
    const token = await requireServerToken(localDeviceId);
    const trimmedDeviceId = deviceId?.trim();
    const statusPath = trimmedDeviceId
      ? `/v1/pairing/status?device_id=${encodeURIComponent(trimmedDeviceId)}`
      : '/v1/pairing/status';

    try {
      const response = await requestCompanion<any>({
        ip: targetIp,
        port: targetPort,
        path: statusPath,
        timeoutMs: COMPANION_PAIRING_TIMEOUT_MS,
        tlsFingerprint,
        headers: buildAuthHeaders(token),
      });

      const data = response.data?.data;
      if (!isRecord(data)) {
        return null;
      }

      const approval = typeof data.approval === 'string' ? data.approval : '';
      return {
        approval: approval as 'idle' | 'pending' | 'approved' | 'denied' | '',
        allowInputCommands: data.allow_input_commands === true,
        allowPowerCommands: data.allow_power_commands === true,
      };
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        // Older companion without /v1/pairing/status.
        return null;
      }
      throw normalizeCompanionRequestError(error, 'Unable to check the pairing status with the companion.');
    }
  },

  async waitForPairingApproval(
    serverIp?: string,
    options: {
      timeoutMs?: number;
      intervalMs?: number;
      deviceId?: string | null;
      localDeviceId?: string | null;
    } = {}
  ): Promise<'approved' | 'denied' | 'timeout' | 'unsupported'> {
    const timeoutMs = options.timeoutMs ?? 45000;
    const intervalMs = options.intervalMs ?? 2000;
    const deviceId = options.deviceId?.trim() || null;
    const localDeviceId = options.localDeviceId?.trim() || null;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const status = await this.getPairingStatus(serverIp, deviceId, localDeviceId);

      if (!status) {
        return 'unsupported';
      }

      // The capability-flag shortcut only applies to the legacy global
      // state: with a device_id, flags being on says nothing about whether
      // THIS enrollment was approved.
      const approved = deviceId
        ? status.approval === 'approved'
        : status.approval === 'approved' || status.allowInputCommands || status.allowPowerCommands;

      if (approved) {
        return 'approved';
      }

      if (status.approval === 'denied') {
        return 'denied';
      }

      if (Date.now() + intervalMs > deadline) {
        return 'timeout';
      }

      await wait(intervalMs);
    }
  },

  /**
   * Requests a per-device token (protocol v3). Returns null when the
   * companion predates enrollment, so callers can fall back to the shared
   * QR token flow.
   */
  async enrollDevice(
    serverIp?: string,
    deviceName?: string | null,
    localDeviceId?: string | null
  ): Promise<{ deviceId: string; deviceToken: string } | null> {
    const {
      ip: targetIp,
      port: targetPort,
      tlsFingerprint,
    } = await resolveTargetEndpoint(serverIp, null, localDeviceId);
    const token = await requireServerToken(localDeviceId);

    try {
      const response = await requestCompanion<any>({
        ip: targetIp,
        port: targetPort,
        path: '/v1/pairing/enroll',
        method: 'POST',
        data: { device_name: deviceName?.trim() || null },
        timeoutMs: 5000,
        tlsFingerprint,
        headers: buildAuthHeaders(token),
      });

      const data = response.data?.data;
      const deviceId = isRecord(data) ? toCandidateString(data.device_id) : null;
      const deviceToken = isRecord(data) ? toCandidateString(data.device_token) : null;

      return deviceId && deviceToken ? { deviceId, deviceToken } : null;
    } catch (error) {
      if (isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 405)) {
        // Older companion without per-device enrollment.
        return null;
      }
      throw normalizeCompanionRequestError(error, 'Unable to start pairing with the companion.');
    }
  },

  async activatePairedControls(
    serverIp?: string,
    tokenOverride?: string | null,
    localDeviceId?: string | null
  ): Promise<any> {
    const {
      ip: targetIp,
      port: targetPort,
      tlsFingerprint,
    } = await resolveTargetEndpoint(serverIp, null, localDeviceId);
    const token = normalizeStoredValue(tokenOverride) ?? await requireServerToken(localDeviceId);
    try {
      const response = await requestCompanion<any>({
        ip: targetIp,
        port: targetPort,
        path: '/v1/pairing/activate',
        method: 'POST',
        data: {},
        timeoutMs: 5000,
        tlsFingerprint,
        headers: buildAuthHeaders(token),
      });

      return response.data;
    } catch (error) {
      throw normalizeCompanionRequestError(error, 'Unable to enable remote controls for this paired computer.');
    }
  },

  async checkDeviceStatus(deviceIp: string, localDeviceId?: string | null): Promise<boolean> {
    try {
      const { port: targetPort, tlsFingerprint } = await resolveTargetEndpoint(
        deviceIp,
        null,
        localDeviceId
      );
      const response = await requestCompanion<any>({
        ip: deviceIp,
        port: targetPort,
        path: '/v1/health',
        timeoutMs: DEVICE_STATUS_TIMEOUT_MS,
        tlsFingerprint,
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      return response.data?.ok === true && response.data?.data?.status === 'online';
    } catch (error) {
      console.log('Error checking device status:', error);
      return false;
    }
  },

  async sendWakeRequest(
    mac: string,
    serverIp?: string,
    options: WakeRequestOptions = {},
    localDeviceId?: string | null
  ): Promise<any> {
    const {
      ip: targetIp,
      port: targetPort,
      tlsFingerprint,
    } = await resolveTargetEndpoint(serverIp, null, localDeviceId);
    const token = await requireServerToken(localDeviceId);
    try {
      const response = await requestCompanion<any>({
        ip: targetIp,
        port: targetPort,
        path: '/v1/wake',
        method: 'POST',
        data: {
          mac,
          broadcast: options.wakeAddress?.trim() || undefined,
          port: sanitizeWakePort(options.wakePort),
        },
        headers: buildAuthHeaders(token),
        timeoutMs: 5000,
        tlsFingerprint,
      });

      return response.data;
    } catch (error) {
      throw normalizeCompanionRequestError(error, 'Wake request failed.');
    }
  },

  async sendCommandTo(
    targetIp: string | null | undefined,
    command: string,
    params: CommandParams = {},
    deviceId?: string | null
  ): Promise<any> {
    const {
      ip: serverIp,
      port: serverPort,
      tlsFingerprint,
    } = await resolveTargetEndpoint(targetIp, null, deviceId);

    if (command === 'get_status') {
      return this.getCompanionInfo(serverIp);
    }

    if (command === 'wake') {
      return this.sendWakeRequest(String(params.mac ?? ''), serverIp, {
        wakeAddress: String(params.wakeAddress ?? ''),
        wakePort: params.wakePort,
      });
    }

    const token = await requireServerToken(deviceId);

    try {
      const payload = mapLegacyCommand(command, params);
      const response = await requestCompanion<any>({
        ip: serverIp,
        port: serverPort,
        path: '/v1/command',
        method: 'POST',
        data: payload,
        headers: buildAuthHeaders(token),
        timeoutMs: 5000,
        tlsFingerprint,
      });

      return response.data;
    } catch (error) {
      throw normalizeCompanionRequestError(error, `Unable to send the ${command} command.`);
    }
  },

  async sendCommand(command: string, params: CommandParams = {}): Promise<any> {
    return this.sendCommandTo(undefined, command, params);
  },

  async sendMouseMove(deviceId: string, deviceIp: string, dx: number, dy: number): Promise<any> {
    return this.sendCommandTo(deviceIp, 'mouse_move', { dx, dy }, deviceId);
  },

  async sendMouseClick(deviceId: string, deviceIp: string, button: MouseButton): Promise<any> {
    return this.sendCommandTo(deviceIp, 'mouse_click', { button }, deviceId);
  },

  async sendMouseButtonDown(deviceId: string, deviceIp: string, button: MouseButton): Promise<any> {
    return this.sendCommandTo(deviceIp, 'mouse_button', { button, action: 'down' }, deviceId);
  },

  async sendMouseButtonUp(deviceId: string, deviceIp: string, button: MouseButton): Promise<any> {
    return this.sendCommandTo(deviceIp, 'mouse_button', { button, action: 'up' }, deviceId);
  },

  async sendScroll(deviceId: string, deviceIp: string, amount: number): Promise<any> {
    return this.sendCommandTo(deviceIp, 'mouse_scroll', { amount }, deviceId);
  },

  async sendKeyboardInput(deviceId: string, deviceIp: string, text: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'text_input', { text }, deviceId);
  },

  async sendSpecialKey(deviceId: string, deviceIp: string, key: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'key_press', { key }, deviceId);
  },

  async sendMediaPlayPause(deviceId: string, deviceIp: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'media_play_pause', {}, deviceId);
  },

  async sendMediaNext(deviceId: string, deviceIp: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'media_next', {}, deviceId);
  },

  async sendMediaPrevious(deviceId: string, deviceIp: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'media_prev', {}, deviceId);
  },

  async sendVolumeUp(deviceId: string, deviceIp: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'volume_up', {}, deviceId);
  },

  async sendVolumeDown(deviceId: string, deviceIp: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'volume_down', {}, deviceId);
  },

  async sendVolumeMute(deviceId: string, deviceIp: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'volume_mute', {}, deviceId);
  },

  async sendShutdown(deviceId: string, deviceIp: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'shutdown', {}, deviceId);
  },

  async sendRestart(deviceId: string, deviceIp: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'restart', {}, deviceId);
  },

  async sendSleep(deviceId: string, deviceIp: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'sleep', {}, deviceId);
  },

  async sendLogoff(deviceId: string, deviceIp: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'logoff', {}, deviceId);
  },

  async sendLock(deviceId: string, deviceIp: string): Promise<any> {
    return this.sendCommandTo(deviceIp, 'lock', {}, deviceId);
  },

  // Asks the companion to raise the Windows Ctrl+Alt+Delete security screen.
  //
  // Unlike the other commands this never throws: every path -- including an
  // offline computer or a rejected token -- resolves to a
  // `SecurityScreenOutcome`, so the caller has exactly one thing to render and
  // cannot accidentally treat "no exception" as "it worked". It talks to
  // `requestCompanion` directly rather than through `sendCommandTo` because
  // the HTTP status is part of the answer here, and `sendCommandTo` folds it
  // into a generic Error.
  async sendSecurityScreen(
    deviceId: string,
    deviceIp: string,
    options: { fallback?: SecurityScreenFallback } = {}
  ): Promise<SecurityScreenOutcome> {
    const fallback: SecurityScreenFallback = options.fallback === 'lock' ? 'lock' : 'none';

    let endpoint: { ip: string; port: number; tlsFingerprint: string | null };
    let token: string;
    try {
      endpoint = await resolveTargetEndpoint(deviceIp, null, deviceId);
      token = await requireServerToken(deviceId);
    } catch (error) {
      // No stored IP or no pairing token: the phone is not paired with a
      // computer it can command, which is an authorization problem, not a
      // failed execution.
      return {
        status: 'unauthorized',
        action: 'none',
        fallbackUsed: false,
        detail: toSecurityScreenDetail(error instanceof Error ? error.message : null),
      };
    }

    try {
      const response = await requestCompanion<any>({
        ip: endpoint.ip,
        port: endpoint.port,
        path: '/v1/command',
        method: 'POST',
        data: mapLegacyCommand('security_screen', { fallback }),
        headers: buildAuthHeaders(token),
        timeoutMs: SECURITY_SCREEN_TIMEOUT_MS,
        tlsFingerprint: endpoint.tlsFingerprint,
      });

      return parseSecurityScreenPayload(response.data);
    } catch (error) {
      return classifySecurityScreenError(error);
    }
  },

  async wakeMachine(device: Pick<Device, 'mac' | 'ip' | 'wakeAddress' | 'wakePort'> & { id?: string }): Promise<any> {
    const mac = device.mac.trim();
    if (!mac) {
      throw new Error('MAC address is required for wake operation');
    }

    const wakePort = sanitizeWakePort(device.wakePort);
    const wakeAddresses = buildWakeAddresses(device);

    const sentWakeAddresses: string[] = [];
    let directWakeError: unknown = null;

    for (const wakeAddress of wakeAddresses) {
      try {
        await sendWakeOnLanPacket(mac, wakeAddress, wakePort);
        sentWakeAddresses.push(wakeAddress);
      } catch (error) {
        directWakeError = error;
        console.warn(`Direct Wake-on-LAN failed for ${wakeAddress}:${wakePort}:`, error);
      }
    }

    if (sentWakeAddresses.length > 0) {
      return {
        ok: true,
        message: `Wake-on-LAN packet sent directly from the mobile app to ${sentWakeAddresses.join(', ')} on port ${wakePort}.`,
        wakeAddresses: sentWakeAddresses,
        wakePort,
      };
    }

    console.warn('Direct Wake-on-LAN failed for all candidate broadcast addresses, falling back to companion relay:', directWakeError);
    return this.sendWakeRequest(
      mac,
      undefined,
      { wakeAddress: wakeAddresses[0] || device.ip.trim(), wakePort },
      device.id
    );
  },
};

export default deviceService;
