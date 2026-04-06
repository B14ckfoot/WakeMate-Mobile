import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import dgram from 'react-native-udp';
import { sendWakeOnLanPacket } from '../native/wakeOnLan';
import { Device } from '../types/device';
import {
  getSuggestedWakeAddress,
  isValidIpAddress,
  isValidMacAddress,
  normalizeDevice,
  normalizeMacAddress,
  sanitizeWakePort,
} from '../utils/deviceNetwork';
import { syncDevicesToWidgetStorage } from '../widget/widgetSharedStorage';

const SERVER_IP_KEY = 'serverIp';
const SERVER_TOKEN_KEY = 'serverToken';
const API_PORT = 7777;
const AUTH_HEADER = 'x-wakemate-token';
const GLOBAL_BROADCAST_ADDRESS = '255.255.255.255';
const COMPANION_SERVER_IP_REQUIRED_MESSAGE = 'Companion server IP not set. Add it in Settings before using remote controls.';
const COMPANION_PAIRING_TOKEN_REQUIRED_MESSAGE = 'Pairing token not set. Add the api_token from wakemate.config.json in Settings.';
const COMPANION_PAIRING_TOKEN_REJECTED_MESSAGE = 'Pairing token was rejected by the companion. Update the api_token in Settings before using remote controls.';

type CommandParams = Record<string, any>;
type MouseButton = 'left' | 'right' | 'middle';
type ScrollDirection = 'up' | 'down';
type WakeRequestOptions = {
  wakeAddress?: string;
  wakePort?: number;
};
type CompanionDiscoveryInfo = {
  serverIp: string;
  deviceName: string;
  macAddress: string | null;
  apiPort: number;
  version: string | null;
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
const DISCOVERY_TIMEOUT_MS = 1000;
const DISCOVERY_BATCH_SIZE = 20;
const UDP_DISCOVERY_PORT = 41234;
const UDP_DISCOVERY_MESSAGE = 'wakemate:discover';
const UDP_DISCOVERY_TIMEOUT_MS = 1500;

const buildBaseUrl = (ip: string) => `http://${ip}:${API_PORT}`;

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

const parseDiscoveryResponse = (payload: unknown): CompanionDiscoveryInfo | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const deviceName = toCandidateString(payload.device_name) ?? toCandidateString(payload.deviceName);
  const localIp = toCandidateString(payload.local_ip) ?? toCandidateString(payload.localIp);
  const macAddressValue = toCandidateString(payload.mac_address) ?? toCandidateString(payload.macAddress);
  const version = toCandidateString(payload.version);
  const rawApiPort = Number(payload.api_port ?? payload.apiPort ?? API_PORT);

  if (!deviceName || !localIp || !isValidIpAddress(localIp)) {
    return null;
  }

  return {
    serverIp: localIp,
    deviceName,
    macAddress: macAddressValue && isValidMacAddress(macAddressValue) ? normalizeMacAddress(macAddressValue) : null,
    apiPort: Number.isInteger(rawApiPort) && rawApiPort > 0 && rawApiPort <= 65535 ? rawApiPort : API_PORT,
    version,
  };
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

const discoverCompanionViaUdp = async (): Promise<CompanionDiscoveryInfo | null> =>
  new Promise((resolve) => {
    let socket: ReturnType<typeof dgram.createSocket> | null = null;
    let settled = false;

    const finish = (result: CompanionDiscoveryInfo | null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      closeDiscoverySocket(socket);
      resolve(result);
    };

    const timeoutId = setTimeout(() => finish(null), UDP_DISCOVERY_TIMEOUT_MS);

    try {
      socket = dgram.createSocket({ type: 'udp4' });
    } catch (error) {
      console.warn('UDP discovery unavailable, falling back to HTTP scan:', error);
      finish(null);
      return;
    }

    socket.once('error', () => finish(null));
    socket.once('message', (message: { toString: (encoding?: string) => string }) => {
      try {
        const parsed = parseDiscoveryResponse(JSON.parse(message.toString('utf8')));
        finish(parsed);
      } catch {
        finish(null);
      }
    });

    socket.once('listening', () => {
      try {
        socket.setBroadcast(true);
        socket.send(
          UDP_DISCOVERY_MESSAGE,
          undefined,
          undefined,
          UDP_DISCOVERY_PORT,
          GLOBAL_BROADCAST_ADDRESS,
          (error?: Error) => {
            if (error) {
              finish(null);
            }
          }
        );
      } catch {
        finish(null);
      }
    });

    try {
      socket.bind(0, '0.0.0.0');
    } catch {
      finish(null);
    }
  });

const persistStringSetting = async (key: string, value: string): Promise<void> => {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    await AsyncStorage.removeItem(key);
    return;
  }

  await AsyncStorage.setItem(key, trimmedValue);
};

const chunkArray = <T,>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const isReachableCompanionServer = async (ip: string): Promise<boolean> => {
  try {
    const response = await axios.get(`${buildBaseUrl(ip)}/v1/health`, {
      timeout: DISCOVERY_TIMEOUT_MS,
      headers: {
        'Cache-Control': 'no-cache',
      },
    });

    return response.data?.ok === true && response.data?.data?.status === 'online';
  } catch {
    return false;
  }
};

const scanSubnetForCompanion = async (subnet: string): Promise<string | null> => {
  const remainingHosts = Array.from({ length: 254 }, (_, index) => index + 1).filter(
    (host) => !PRIORITY_HOSTS.includes(host)
  );
  const hostOrder = [...PRIORITY_HOSTS, ...remainingHosts];

  for (const batch of chunkArray(hostOrder, DISCOVERY_BATCH_SIZE)) {
    const results = await Promise.all(
      batch.map(async (host) => {
        const ip = `${subnet}${host}`;
        const reachable = await isReachableCompanionServer(ip);
        return reachable ? ip : null;
      })
    );

    const foundIp = results.find((ip): ip is string => Boolean(ip));
    if (foundIp) {
      return foundIp;
    }
  }

  return null;
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

const isAuthFailureStatus = (status: number | undefined): boolean => status === 401 || status === 403;

const normalizeCompanionRequestError = (error: unknown, fallbackMessage: string): Error => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;

    if (isAuthFailureStatus(status)) {
      return new Error(COMPANION_PAIRING_TOKEN_REJECTED_MESSAGE);
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
    case 'key_press':
      return {
        type: 'key_press',
        key: String(params.key ?? ''),
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

const resolveTargetIp = async (explicitIp?: string | null): Promise<string> => {
  const storedIp = normalizeStoredValue(await deviceService.getServerAddress());
  const candidate = normalizeStoredValue(explicitIp) ?? storedIp;

  if (!candidate) {
    throw new Error(COMPANION_SERVER_IP_REQUIRED_MESSAGE);
  }

  return candidate;
};

const requireServerToken = async (): Promise<string> => {
  const token = normalizeStoredValue(await deviceService.getServerToken());

  if (!token) {
    throw new Error(COMPANION_PAIRING_TOKEN_REQUIRED_MESSAGE);
  }

  return token;
};

const deviceService = {
  async getCompanionSetupError(options: { requireToken?: boolean; validateToken?: boolean; serverIp?: string } = {}): Promise<string | null> {
    const requireToken = options.requireToken ?? true;
    const [serverIp, token] = await Promise.all([
      options.serverIp ? Promise.resolve(options.serverIp) : this.getServerAddress(),
      this.getServerToken(),
    ]);

    if (!normalizeStoredValue(serverIp)) {
      return COMPANION_SERVER_IP_REQUIRED_MESSAGE;
    }

    if (requireToken && !normalizeStoredValue(token)) {
      return COMPANION_PAIRING_TOKEN_REQUIRED_MESSAGE;
    }

    if (options.validateToken && requireToken) {
      try {
        await this.checkPairing(serverIp ?? undefined);
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
      await persistStringSetting(SERVER_IP_KEY, ip);
    } catch (error) {
      console.error('Error setting server address:', error);
      throw error;
    }
  },

  async getServerToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(SERVER_TOKEN_KEY);
    } catch (error) {
      console.error('Error getting pairing token:', error);
      return null;
    }
  },

  async setServerToken(token: string): Promise<void> {
    try {
      await persistStringSetting(SERVER_TOKEN_KEY, token);
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

      return parsedDevices.map((device) => normalizeDevice(device));
    } catch (error) {
      console.error('Error getting devices:', error);
      return [];
    }
  },

  async saveDevices(devices: Device[]): Promise<void> {
    try {
      const normalizedDevices = devices.map((device) => normalizeDevice(device));
      await AsyncStorage.setItem('devices', JSON.stringify(normalizedDevices));
      syncDevicesToWidgetStorage(normalizedDevices);
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
    const targetIp = await resolveTargetIp(serverIp);
    const response = await axios.get(`${buildBaseUrl(targetIp)}/v1/health`, {
      timeout: 3000,
      headers: {
        'Cache-Control': 'no-cache',
      },
    });

    return response.data;
  },

  async getCompanionInfo(serverIp?: string): Promise<any> {
    const targetIp = await resolveTargetIp(serverIp);
    const token = normalizeStoredValue(await this.getServerToken());
    try {
      const response = await axios.get(`${buildBaseUrl(targetIp)}/v1/info`, {
        timeout: 3000,
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
    const udpDiscovery = await discoverCompanionViaUdp();
    if (udpDiscovery) {
      await this.setServerAddress(udpDiscovery.serverIp);
      return udpDiscovery;
    }

    const storedIp = await this.getServerAddress();

    if (storedIp?.trim() && await isReachableCompanionServer(storedIp.trim())) {
      return {
        serverIp: storedIp.trim(),
        deviceName: `WakeMATE ${storedIp.trim()}`,
        macAddress: null,
        apiPort: API_PORT,
        version: null,
      };
    }

    for (const subnet of DISCOVERY_SUBNETS) {
      const foundIp = await scanSubnetForCompanion(subnet);

      if (foundIp) {
        await this.setServerAddress(foundIp);
        return {
          serverIp: foundIp,
          deviceName: `WakeMATE ${foundIp}`,
          macAddress: null,
          apiPort: API_PORT,
          version: null,
        };
      }
    }

    return null;
  },

  async discoverCompanionServer(): Promise<string | null> {
    const discovery = await this.discoverCompanion();
    return discovery?.serverIp ?? null;
  },

  async checkPairing(serverIp?: string): Promise<any> {
    const targetIp = await resolveTargetIp(serverIp);
    const token = await requireServerToken();
    try {
      const response = await axios.get(`${buildBaseUrl(targetIp)}/v1/pairing/check`, {
        timeout: 3000,
        headers: buildAuthHeaders(token),
      });

      return response.data;
    } catch (error) {
      throw normalizeCompanionRequestError(error, 'Unable to verify the pairing token with the companion.');
    }
  },

  async checkDeviceStatus(deviceIp: string): Promise<boolean> {
    try {
      const response = await axios.get(`${buildBaseUrl(deviceIp)}/v1/health`, {
        timeout: 3000,
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

  async sendWakeRequest(mac: string, serverIp?: string, options: WakeRequestOptions = {}): Promise<any> {
    const targetIp = await resolveTargetIp(serverIp);
    const token = await requireServerToken();
    try {
      const response = await axios.post(
        `${buildBaseUrl(targetIp)}/v1/wake`,
        {
          mac,
          broadcast: options.wakeAddress?.trim() || undefined,
          port: sanitizeWakePort(options.wakePort),
        },
        {
          headers: buildAuthHeaders(token),
          timeout: 5000,
        }
      );

      return response.data;
    } catch (error) {
      throw normalizeCompanionRequestError(error, 'Wake request failed.');
    }
  },

  async sendCommandTo(targetIp: string | null | undefined, command: string, params: CommandParams = {}): Promise<any> {
    const serverIp = await resolveTargetIp(targetIp);

    if (command === 'get_status') {
      return this.getCompanionInfo(serverIp);
    }

    if (command === 'wake') {
      return this.sendWakeRequest(String(params.mac ?? ''), serverIp, {
        wakeAddress: String(params.wakeAddress ?? ''),
        wakePort: params.wakePort,
      });
    }

    const token = await requireServerToken();

    try {
      const payload = mapLegacyCommand(command, params);
      const response = await axios.post(`${buildBaseUrl(serverIp)}/v1/command`, payload, {
        headers: buildAuthHeaders(token),
        timeout: 5000,
      });

      return response.data;
    } catch (error) {
      throw normalizeCompanionRequestError(error, `Unable to send the ${command} command.`);
    }
  },

  async sendCommand(command: string, params: CommandParams = {}): Promise<any> {
    return this.sendCommandTo(undefined, command, params);
  },

  async sendMouseMove(_deviceId: string, _deviceIp: string, dx: number, dy: number): Promise<any> {
    return this.sendCommandTo(undefined, 'mouse_move', { dx, dy });
  },

  async sendMouseClick(_deviceId: string, _deviceIp: string, button: MouseButton): Promise<any> {
    return this.sendCommandTo(undefined, 'mouse_click', { button });
  },

  async sendScroll(_deviceId: string, _deviceIp: string, amount: number): Promise<any> {
    return this.sendCommandTo(undefined, 'mouse_scroll', { amount });
  },

  async sendKeyboardInput(_deviceId: string, _deviceIp: string, text: string): Promise<any> {
    return this.sendCommandTo(undefined, 'text_input', { text });
  },

  async sendSpecialKey(_deviceId: string, _deviceIp: string, key: string): Promise<any> {
    return this.sendCommandTo(undefined, 'key_press', { key });
  },

  async sendMediaPlayPause(_deviceId: string, _deviceIp: string): Promise<any> {
    return this.sendCommandTo(undefined, 'media_play_pause');
  },

  async sendMediaNext(_deviceId: string, _deviceIp: string): Promise<any> {
    return this.sendCommandTo(undefined, 'media_next');
  },

  async sendMediaPrevious(_deviceId: string, _deviceIp: string): Promise<any> {
    return this.sendCommandTo(undefined, 'media_prev');
  },

  async sendVolumeUp(_deviceId: string, _deviceIp: string): Promise<any> {
    return this.sendCommandTo(undefined, 'volume_up');
  },

  async sendVolumeDown(_deviceId: string, _deviceIp: string): Promise<any> {
    return this.sendCommandTo(undefined, 'volume_down');
  },

  async sendVolumeMute(_deviceId: string, _deviceIp: string): Promise<any> {
    return this.sendCommandTo(undefined, 'volume_mute');
  },

  async sendShutdown(_deviceId: string, _deviceIp: string): Promise<any> {
    return this.sendCommandTo(undefined, 'shutdown');
  },

  async sendRestart(_deviceId: string, _deviceIp: string): Promise<any> {
    return this.sendCommandTo(undefined, 'restart');
  },

  async sendSleep(_deviceId: string, _deviceIp: string): Promise<any> {
    return this.sendCommandTo(undefined, 'sleep');
  },

  async sendLogoff(_deviceId: string, _deviceIp: string): Promise<any> {
    return this.sendCommandTo(undefined, 'logoff');
  },

  async wakeMachine(device: Pick<Device, 'mac' | 'ip' | 'wakeAddress' | 'wakePort'>): Promise<any> {
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
    return this.sendWakeRequest(mac, undefined, { wakeAddress: wakeAddresses[0] || device.ip.trim(), wakePort });
  },
};

export default deviceService;
