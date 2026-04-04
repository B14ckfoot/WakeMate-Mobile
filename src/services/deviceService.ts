import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { awake } from 'react-native-wake-on-lan';
import { Device } from '../types/device';
import { getSuggestedWakeAddress, normalizeDevice, sanitizeWakePort } from '../utils/deviceNetwork';

const SERVER_IP_KEY = 'serverIp';
const SERVER_TOKEN_KEY = 'serverToken';
const API_PORT = 7777;
const AUTH_HEADER = 'x-wakemate-token';
const COMPANION_SERVER_IP_REQUIRED_MESSAGE = 'Companion server IP not set. Add it in Settings before using remote controls.';
const COMPANION_PAIRING_TOKEN_REQUIRED_MESSAGE = 'Pairing token not set. Add the api_token from wakemate.config.json in Settings.';

type CommandParams = Record<string, any>;
type MouseButton = 'left' | 'right' | 'middle';
type ScrollDirection = 'up' | 'down';
type WakeRequestOptions = {
  wakeAddress?: string;
  wakePort?: number;
};

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

const buildBaseUrl = (ip: string) => `http://${ip}:${API_PORT}`;

const normalizeStoredValue = (value: string | null | undefined): string | null => {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : null;
};

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
  async getCompanionSetupError(options: { requireToken?: boolean } = {}): Promise<string | null> {
    const requireToken = options.requireToken ?? true;
    const [serverIp, token] = await Promise.all([
      this.getServerAddress(),
      this.getServerToken(),
    ]);

    if (!normalizeStoredValue(serverIp)) {
      return COMPANION_SERVER_IP_REQUIRED_MESSAGE;
    }

    if (requireToken && !normalizeStoredValue(token)) {
      return COMPANION_PAIRING_TOKEN_REQUIRED_MESSAGE;
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
    } catch (error) {
      console.error('Error saving devices:', error);
      throw error;
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
    const response = await axios.get(`${buildBaseUrl(targetIp)}/v1/info`, {
      timeout: 3000,
      headers: {
        'Cache-Control': 'no-cache',
      },
    });

    return response.data;
  },

  async discoverCompanionServer(): Promise<string | null> {
    const storedIp = await this.getServerAddress();

    if (storedIp?.trim() && await isReachableCompanionServer(storedIp.trim())) {
      return storedIp.trim();
    }

    for (const subnet of DISCOVERY_SUBNETS) {
      const foundIp = await scanSubnetForCompanion(subnet);

      if (foundIp) {
        await this.setServerAddress(foundIp);
        return foundIp;
      }
    }

    return null;
  },

  async checkPairing(serverIp?: string): Promise<any> {
    const targetIp = await resolveTargetIp(serverIp);
    const token = await requireServerToken();

    const response = await axios.get(`${buildBaseUrl(targetIp)}/v1/pairing/check`, {
      timeout: 3000,
      headers: buildAuthHeaders(token),
    });

    return response.data;
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

    const payload = mapLegacyCommand(command, params);
    const response = await axios.post(`${buildBaseUrl(serverIp)}/v1/command`, payload, {
      headers: buildAuthHeaders(token),
      timeout: 5000,
    });

    return response.data;
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
    const wakeAddress = device.wakeAddress?.trim() || getSuggestedWakeAddress(device.ip) || device.ip.trim();

    try {
      await awake(mac, wakePort);
      return {
        ok: true,
        message: `Wake-on-LAN packet sent directly from the mobile app on port ${wakePort}.`,
      };
    } catch (error) {
      console.warn('Direct Wake-on-LAN failed, falling back to companion relay:', error);
      return this.sendWakeRequest(mac, undefined, { wakeAddress, wakePort });
    }
  },
};

export default deviceService;
