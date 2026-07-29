// The point of these tests is the bug the user hit: pairing a second computer
// used to overwrite the first, because the companion IP, port, token and TLS
// fingerprint were four app-wide singletons. Credentials are now per device,
// so each saved computer must keep its own.

import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

import deviceService from '../src/services/deviceService';
import { Device } from '../src/types/device';

const mockedRequest = axios.request as unknown as jest.Mock;

const PC_A: Device = {
  id: 'pc-a',
  name: 'HOMELAB',
  mac: '2C:F0:5D:59:89:44',
  ip: '10.0.0.19',
  wakeAddress: '10.0.0.255',
  wakePort: 9,
  status: 'online',
  type: 'wifi',
  platform: 'windows',
  apiPort: 7777,
  tlsPort: null,
};

const PC_B: Device = {
  ...PC_A,
  id: 'pc-b',
  name: 'STUDIO',
  mac: 'AA:BB:CC:DD:EE:FF',
  ip: '10.0.0.42',
};

const ok = (data: unknown = { ok: true, message: 'ok' }) => ({ status: 200, headers: {}, data });

beforeEach(async () => {
  mockedRequest.mockReset();
  mockedRequest.mockResolvedValue(ok());
  await AsyncStorage.clear();
  await deviceService.saveDevices([PC_A, PC_B]);
  await deviceService.setDeviceCompanionToken('pc-a', 'token-a');
  await deviceService.setDeviceCompanionToken('pc-b', 'token-b');
});

afterEach(async () => {
  await deviceService.clearDeviceCompanionCredentials('pc-a');
  await deviceService.clearDeviceCompanionCredentials('pc-b');
});

describe('keeping two computers independent', () => {
  it('sends each command to its own computer with its own token', async () => {
    await deviceService.sendMouseClick('pc-a', PC_A.ip, 'left');
    const callA = mockedRequest.mock.calls[0][0];

    await deviceService.sendMouseClick('pc-b', PC_B.ip, 'left');
    const callB = mockedRequest.mock.calls[1][0];

    expect(callA.url).toContain(PC_A.ip);
    expect(callA.headers['x-wakemate-token']).toBe('token-a');
    expect(callB.url).toContain(PC_B.ip);
    expect(callB.headers['x-wakemate-token']).toBe('token-b');
  });

  it('pairing a second computer leaves the first one intact', async () => {
    // This is the reported bug, as a test.
    await deviceService.pairDeviceFromQr('pc-b', {
      ip: PC_B.ip,
      token: 'fresh-token-b',
      apiPort: 7777,
    });

    expect(await deviceService.getDeviceCompanionToken('pc-a')).toBe('token-a');
    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBe('fresh-token-b');

    const devices = await deviceService.getDevices();
    expect(devices.find((device) => device.id === 'pc-a')?.ip).toBe(PC_A.ip);
    expect(devices.find((device) => device.id === 'pc-b')?.ip).toBe(PC_B.ip);
  });

  it('uses each computer’s own port', async () => {
    await deviceService.setDeviceCompanionConnection('pc-b', { apiPort: 8888 });

    await deviceService.sendSleep('pc-a', PC_A.ip);
    expect(mockedRequest.mock.calls[0][0].url).toContain(':7777');

    await deviceService.sendSleep('pc-b', PC_B.ip);
    expect(mockedRequest.mock.calls[1][0].url).toContain(':8888');
  });

  it('deleting a computer clears its credentials but not the other’s', async () => {
    await deviceService.saveDevices([PC_A]);

    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBeNull();
    expect(await deviceService.getDeviceCompanionToken('pc-a')).toBe('token-a');
  });

  it('reports an unpaired computer without borrowing another’s token', async () => {
    await deviceService.clearDeviceCompanionCredentials('pc-b');

    const outcome = await deviceService.sendSecurityScreen('pc-b', PC_B.ip);

    expect(outcome.status).toBe('unauthorized');
  });
});

describe('completing pairing in one scan', () => {
  it('falls back to the legacy activation when enrollment fails', async () => {
    // Previously any non-404 enrollment error aborted pairing outright and the
    // user was told to "finish it in Settings".
    const busy = new Error('busy') as Error & { isAxiosError: boolean; response: unknown };
    busy.isAxiosError = true;
    busy.response = { status: 429, data: { ok: false, message: 'already waiting' } };

    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.path ?? config.url).includes('/v1/pairing/enroll')) {
        throw busy;
      }
      if (String(config.url).includes('/v1/pairing/status')) {
        return ok({ ok: true, data: { approval: 'approved', allow_input_commands: true } });
      }
      return ok();
    });

    const result = await deviceService.pairDeviceFromQr('pc-b', {
      ip: PC_B.ip,
      token: 'qr-token',
      timeoutMs: 5000,
    });

    expect(result.status).toBe('approved');
    const activated = mockedRequest.mock.calls.some((call) =>
      String(call[0].url).includes('/v1/pairing/activate')
    );
    expect(activated).toBe(true);
  });

  it('keeps the QR token when approval never arrives, rather than a half-swapped one', async () => {
    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.url).includes('/v1/pairing/enroll')) {
        return ok({ ok: true, data: { device_id: 'enroll-1', device_token: 'per-device-token' } });
      }
      if (String(config.url).includes('/v1/pairing/status')) {
        return ok({ ok: true, data: { approval: 'pending', allow_input_commands: false } });
      }
      return ok();
    });

    const result = await deviceService.pairDeviceFromQr('pc-b', {
      ip: PC_B.ip,
      token: 'qr-token',
      timeoutMs: 10,
    });

    expect(result.status).toBe('timeout');
    // The per-device token is only adopted on approval.
    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBe('qr-token');
  });

  it('adopts the per-device token once the desktop approves', async () => {
    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.url).includes('/v1/pairing/enroll')) {
        return ok({ ok: true, data: { device_id: 'enroll-1', device_token: 'per-device-token' } });
      }
      if (String(config.url).includes('/v1/pairing/status')) {
        return ok({ ok: true, data: { approval: 'approved', allow_input_commands: true } });
      }
      return ok();
    });

    const result = await deviceService.pairDeviceFromQr('pc-b', {
      ip: PC_B.ip,
      token: 'qr-token',
      timeoutMs: 5000,
    });

    expect(result.status).toBe('approved');
    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBe('per-device-token');
  });

  it('stores the scanned ports against that computer only', async () => {
    await deviceService.pairDeviceFromQr('pc-b', {
      ip: PC_B.ip,
      token: 'qr-token',
      apiPort: 7777,
      tlsPort: 7443,
      timeoutMs: 10,
    });

    const devices = await deviceService.getDevices();
    expect(devices.find((device) => device.id === 'pc-b')?.tlsPort).toBe(7443);
    expect(devices.find((device) => device.id === 'pc-a')?.tlsPort).toBeNull();
  });
});

describe('migrating a single-companion setup', () => {
  it('adopts the old global credentials onto the computer they belonged to', async () => {
    await deviceService.clearDeviceCompanionCredentials('pc-a');
    await deviceService.clearDeviceCompanionCredentials('pc-b');
    await AsyncStorage.setItem('serverIp', PC_A.ip);
    await AsyncStorage.setItem('serverPort', '7777');
    await deviceService.setServerToken('legacy-token');

    const devices = await deviceService.getDevices();

    expect(devices).toHaveLength(2);
    expect(await deviceService.getDeviceCompanionToken('pc-a')).toBe('legacy-token');
    // The other computer must not inherit it.
    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBeNull();
    // Globals are cleared so they cannot be adopted twice.
    expect(await AsyncStorage.getItem('serverIp')).toBeNull();
  });

  it('leaves the globals alone when no saved computer matches', async () => {
    await AsyncStorage.setItem('serverIp', '192.168.99.99');
    await deviceService.setServerToken('legacy-token');

    await deviceService.getDevices();

    expect(await AsyncStorage.getItem('serverIp')).toBe('192.168.99.99');
  });
});
