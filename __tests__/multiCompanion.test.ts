// The point of these tests is the bug the user hit: pairing a second computer
// used to overwrite the first, because the companion IP, port, token and TLS
// fingerprint were four app-wide singletons. Credentials are now per device,
// so each saved computer must keep its own.

import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

import deviceService, { PAIRING_APPROVAL_TIMEOUT_MS } from '../src/services/deviceService';
import {
  getPendingDeviceEnrollment,
  setPendingDeviceEnrollment,
} from '../src/services/companionCredentials';
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

const PC_C: Device = {
  ...PC_A,
  id: 'pc-c',
  name: 'EDITING',
  mac: '11:22:33:44:55:66',
  ip: '10.0.0.77',
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

  it('merges slow status results without undoing a newer add or delete', async () => {
    // A health poll began with A + B. Before it returned, B was deleted and C
    // was added. Applying the stale result must update A only.
    await deviceService.saveDevices([PC_A, PC_C]);

    const merged = await deviceService.updateDeviceStatuses([
      { id: 'pc-a', status: 'offline' },
      { id: 'pc-b', status: 'online' },
    ]);

    expect(merged.map((device) => device.id)).toEqual(['pc-a', 'pc-c']);
    expect(merged.find((device) => device.id === 'pc-a')?.status).toBe('offline');
    expect(merged.find((device) => device.id === 'pc-c')?.name).toBe('EDITING');
    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBeNull();
  });

  it('reports an unpaired computer without borrowing another’s token', async () => {
    await deviceService.clearDeviceCompanionCredentials('pc-b');

    const outcome = await deviceService.sendSecurityScreen('pc-b', PC_B.ip);

    expect(outcome.status).toBe('unauthorized');
  });
});

describe('completing pairing in one scan', () => {
  it('watches approval for the companion’s full enrollment lifetime', () => {
    expect(PAIRING_APPROVAL_TIMEOUT_MS).toBe(120_000);
  });

  it('performs a final approval poll at a non-aligned timeout boundary', async () => {
    let statusCalls = 0;
    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.url).includes('/v1/pairing/status')) {
        statusCalls += 1;
        return ok({
          ok: true,
          data: {
            approval: statusCalls === 3 ? 'approved' : 'pending',
            allow_input_commands: false,
          },
        });
      }
      return ok();
    });

    jest.useFakeTimers();
    try {
      const approval = deviceService.waitForPairingApproval(PC_B.ip, {
        timeoutMs: 5,
        intervalMs: 3,
        deviceId: 'enroll-boundary',
        localDeviceId: 'pc-b',
      });
      await jest.advanceTimersByTimeAsync(5);

      await expect(approval).resolves.toBe('approved');
      expect(statusCalls).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries a busy enrollment without falling into legacy activation', async () => {
    const busy = new Error('busy') as Error & { isAxiosError: boolean; response: unknown };
    busy.isAxiosError = true;
    busy.response = { status: 429, data: { ok: false, message: 'already waiting' } };

    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.path ?? config.url).includes('/v1/pairing/enroll')) {
        throw busy;
      }
      return ok();
    });

    jest.useFakeTimers();
    try {
      const pairing = deviceService.pairDeviceFromQr('pc-b', {
        ip: PC_B.ip,
        token: 'qr-token',
        timeoutMs: 5000,
      });
      await jest.advanceTimersByTimeAsync(3000);
      const result = await pairing;

      expect(result).toEqual({ status: 'failed', detail: 'already waiting' });
      const enrollCalls = mockedRequest.mock.calls.filter((call) =>
        String(call[0].url).includes('/v1/pairing/enroll')
      );
      expect(enrollCalls).toHaveLength(2);
      expect(
        mockedRequest.mock.calls.some((call) =>
          String(call[0].url).includes('/v1/pairing/activate')
        )
      ).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses legacy activation only when enrollment is actually unsupported', async () => {
    const unsupported = new Error('not found') as Error & {
      isAxiosError: boolean;
      response: unknown;
    };
    unsupported.isAxiosError = true;
    unsupported.response = { status: 404, data: { ok: false, message: 'not found' } };

    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.url).includes('/v1/pairing/enroll')) {
        throw unsupported;
      }
      if (String(config.url).includes('/v1/pairing/status')) {
        return ok({ ok: true, data: { approval: 'approved', allow_input_commands: true } });
      }
      return ok();
    });

    const result = await deviceService.pairDeviceFromQr('pc-b', {
      ip: PC_B.ip,
      token: 'legacy-token',
      timeoutMs: 5000,
    });

    expect(result.status).toBe('approved');
    expect(
      mockedRequest.mock.calls.some((call) =>
        String(call[0].url).includes('/v1/pairing/activate')
      )
    ).toBe(true);
  });

  it('rejects a malformed enrollment response instead of treating it as legacy', async () => {
    mockedRequest.mockResolvedValue(ok({ ok: true, data: { device_id: 'missing-token' } }));

    const result = await deviceService.pairDeviceFromQr('pc-b', {
      ip: PC_B.ip,
      token: 'qr-token',
      timeoutMs: 5000,
    });

    expect(result.status).toBe('failed');
    expect(result.detail).toContain('invalid enrollment response');
    expect(
      mockedRequest.mock.calls.some((call) =>
        String(call[0].url).includes('/v1/pairing/activate')
      )
    ).toBe(false);
  });

  it('keeps durable staging after a caller-shortened timeout', async () => {
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
    // Ten milliseconds is shorter than the Companion enrollment TTL, so a
    // later desktop approval is still possible and the staged token must live.
    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBe('qr-token');
    expect(await getPendingDeviceEnrollment('pc-b')).toEqual({
      enrollmentId: 'enroll-1',
      deviceToken: 'per-device-token',
    });

    const statusCalls = mockedRequest.mock.calls.filter((call) =>
      String(call[0].url).includes('/v1/pairing/status')
    );
    expect(statusCalls.length).toBeGreaterThan(0);
    expect(statusCalls[0][0].headers['x-wakemate-token']).toBe('qr-token');
  });

  it('clears inert staging after polling through the full enrollment lifetime', async () => {
    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.url).includes('/v1/pairing/enroll')) {
        return ok({ ok: true, data: { device_id: 'enroll-expired', device_token: 'expired-token' } });
      }
      if (String(config.url).includes('/v1/pairing/status')) {
        return ok({ ok: true, data: { approval: 'pending', allow_input_commands: false } });
      }
      return ok();
    });

    jest.useFakeTimers();
    try {
      const pairing = deviceService.pairDeviceFromQr('pc-b', {
        ip: PC_B.ip,
        token: 'qr-token',
      });
      await jest.advanceTimersByTimeAsync(PAIRING_APPROVAL_TIMEOUT_MS);
      const result = await pairing;

      expect(result.status).toBe('timeout');
      expect(await deviceService.getDeviceCompanionToken('pc-b')).toBe('qr-token');
      expect(await getPendingDeviceEnrollment('pc-b')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
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
    expect(await getPendingDeviceEnrollment('pc-b')).toBeNull();
  });

  it('discards a staged token after definite desktop denial and retains the QR token', async () => {
    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.url).includes('/v1/pairing/enroll')) {
        return ok({ ok: true, data: { device_id: 'enroll-denied', device_token: 'denied-token' } });
      }
      if (String(config.url).includes('/v1/pairing/status')) {
        return ok({ ok: true, data: { approval: 'denied', allow_input_commands: false } });
      }
      return ok();
    });

    const result = await deviceService.pairDeviceFromQr('pc-b', {
      ip: PC_B.ip,
      token: 'qr-token',
      timeoutMs: 5000,
    });

    expect(result.status).toBe('denied');
    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBe('qr-token');
    expect(await getPendingDeviceEnrollment('pc-b')).toBeNull();
  });

  it('keeps staging after an ambiguous status failure', async () => {
    const offline = new Error('network unavailable') as Error & {
      isAxiosError: boolean;
      response?: unknown;
    };
    offline.isAxiosError = true;

    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.url).includes('/v1/pairing/enroll')) {
        return ok({ ok: true, data: { device_id: 'enroll-offline', device_token: 'offline-token' } });
      }
      if (String(config.url).includes('/v1/pairing/status')) {
        throw offline;
      }
      return ok();
    });

    const result = await deviceService.pairDeviceFromQr('pc-b', {
      ip: PC_B.ip,
      token: 'qr-token',
      timeoutMs: 5000,
    });

    expect(result.status).toBe('failed');
    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBe('qr-token');
    expect(await getPendingDeviceEnrollment('pc-b')).toEqual({
      enrollmentId: 'enroll-offline',
      deviceToken: 'offline-token',
    });
  });

  it('recovers and promotes a staged token after a process interruption', async () => {
    // This is the durable state left if the OS terminates WakeMATE after the
    // enroll response but before the polling promise settles.
    await deviceService.setDeviceCompanionToken('pc-b', 'qr-token');
    await setPendingDeviceEnrollment('pc-b', {
      enrollmentId: 'enroll-recover',
      deviceToken: 'recovered-token',
    });

    mockedRequest.mockReset();
    mockedRequest.mockResolvedValue(ok({ ok: true, message: 'pairing token accepted' }));

    await deviceService.checkPairing(PC_B.ip, 'pc-b');

    expect(mockedRequest.mock.calls[0][0].headers['x-wakemate-token']).toBe('recovered-token');
    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBe('recovered-token');
    expect(await getPendingDeviceEnrollment('pc-b')).toBeNull();
  });

  it('recognizes staged credentials during setup validation after relaunch', async () => {
    await deviceService.setDeviceCompanionToken('pc-b', null);
    await setPendingDeviceEnrollment('pc-b', {
      enrollmentId: 'enroll-staged-only',
      deviceToken: 'staged-only-token',
    });

    await expect(
      deviceService.getCompanionSetupError({
        requireToken: true,
        serverIp: PC_B.ip,
        deviceId: 'pc-b',
      })
    ).resolves.toBeNull();
  });

  it('reports a resumed enrollment as pending without testing its staged token', async () => {
    await deviceService.setDeviceCompanionToken('pc-b', 'qr-token-pending-resume');
    await setPendingDeviceEnrollment('pc-b', {
      enrollmentId: 'enroll-pending-resume',
      deviceToken: 'staged-token-pending-resume',
    });
    mockedRequest.mockReset();
    mockedRequest.mockResolvedValue(ok({
      ok: true,
      data: {
        approval: 'pending',
        allow_input_commands: false,
        allow_power_commands: false,
      },
    }));

    const setupError = await deviceService.getCompanionSetupError({
      requireToken: true,
      validateToken: true,
      serverIp: PC_B.ip,
      deviceId: 'pc-b',
    });

    expect(setupError).toContain('waiting for approval');
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest.mock.calls[0][0].url).toContain(
      '/v1/pairing/status?device_id=enroll-pending-resume'
    );
    expect(mockedRequest.mock.calls[0][0].headers['x-wakemate-token']).toBe(
      'qr-token-pending-resume'
    );
    expect(await getPendingDeviceEnrollment('pc-b')).not.toBeNull();
  });

  it('promotes a resumed enrollment after the companion reports durable approval', async () => {
    await deviceService.setDeviceCompanionToken('pc-b', 'qr-token-approved-resume');
    await setPendingDeviceEnrollment('pc-b', {
      enrollmentId: 'enroll-approved-resume',
      deviceToken: 'staged-token-approved-resume',
    });
    mockedRequest.mockReset();
    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.url).includes('/v1/pairing/status')) {
        return ok({
          ok: true,
          data: {
            approval: 'approved',
            allow_input_commands: true,
            allow_power_commands: true,
          },
        });
      }
      return ok({ ok: true, message: 'pairing token accepted' });
    });

    await expect(deviceService.getCompanionSetupError({
      requireToken: true,
      validateToken: true,
      serverIp: PC_B.ip,
      deviceId: 'pc-b',
    })).resolves.toBeNull();

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest.mock.calls[0][0].url).toContain('/v1/pairing/status');
    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBe(
      'staged-token-approved-resume'
    );
    expect(await getPendingDeviceEnrollment('pc-b')).toBeNull();
  });

  it('recovers an approved staged token when the old QR status session is gone', async () => {
    await deviceService.setDeviceCompanionToken('pc-b', 'expired-qr-status-token');
    await setPendingDeviceEnrollment('pc-b', {
      enrollmentId: 'enroll-approved-before-restart',
      deviceToken: 'staged-token-after-restart',
    });
    const unauthorized = new Error('unauthorized') as Error & {
      isAxiosError: boolean;
      response: unknown;
    };
    unauthorized.isAxiosError = true;
    unauthorized.response = { status: 401, data: { ok: false, message: 'unauthorized' } };

    mockedRequest.mockReset();
    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.url).includes('/v1/pairing/status')) {
        throw unauthorized;
      }
      return ok({ ok: true, message: 'pairing token accepted' });
    });

    await expect(deviceService.getCompanionSetupError({
      requireToken: true,
      validateToken: true,
      serverIp: PC_B.ip,
      deviceId: 'pc-b',
    })).resolves.toBeNull();

    const checkCall = mockedRequest.mock.calls.find((call) =>
      String(call[0].url).includes('/v1/pairing/check')
    );
    expect(checkCall?.[0].headers['x-wakemate-token']).toBe('staged-token-after-restart');
    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBe('staged-token-after-restart');
    expect(await getPendingDeviceEnrollment('pc-b')).toBeNull();
  });

  it('clears a resumed enrollment after definite desktop denial', async () => {
    await deviceService.setDeviceCompanionToken('pc-b', 'qr-token-denied-resume');
    await setPendingDeviceEnrollment('pc-b', {
      enrollmentId: 'enroll-denied-resume',
      deviceToken: 'staged-token-denied-resume',
    });
    const unauthorized = new Error('unauthorized') as Error & {
      isAxiosError: boolean;
      response: unknown;
    };
    unauthorized.isAxiosError = true;
    unauthorized.response = { status: 401, data: { ok: false, message: 'unauthorized' } };

    mockedRequest.mockReset();
    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.url).includes('/v1/pairing/status')) {
        return ok({
          ok: true,
          data: {
            approval: 'denied',
            allow_input_commands: false,
            allow_power_commands: false,
          },
        });
      }
      if (String(config.url).includes('/v1/pairing/check')) {
        throw unauthorized;
      }
      if (String(config.url).includes('/v1/health')) {
        return ok({
          ok: true,
          data: { status: 'online', version: '0.2.3', protocol_version: 4 },
        });
      }
      return ok();
    });

    const setupError = await deviceService.getCompanionSetupError({
      requireToken: true,
      validateToken: true,
      serverIp: PC_B.ip,
      deviceId: 'pc-b',
    });

    expect(setupError).toContain('Pairing token was rejected');
    expect(await deviceService.getDeviceCompanionToken('pc-b')).toBe('qr-token-denied-resume');
    expect(await getPendingDeviceEnrollment('pc-b')).toBeNull();
  });

  it('identifies a reboot-unsafe companion instead of asking for repeated re-scans', async () => {
    await deviceService.setDeviceCompanionToken('pc-b', 'stale-v021-token');
    await setPendingDeviceEnrollment('pc-b', null);
    const unauthorized = new Error('unauthorized') as Error & {
      isAxiosError: boolean;
      response: unknown;
    };
    unauthorized.isAxiosError = true;
    unauthorized.response = { status: 401, data: { ok: false, message: 'unauthorized' } };

    mockedRequest.mockReset();
    mockedRequest.mockImplementation(async (config: any) => {
      if (String(config.url).includes('/v1/pairing/check')) {
        throw unauthorized;
      }
      if (String(config.url).includes('/v1/health')) {
        return ok({
          ok: true,
          data: { status: 'online', version: '0.2.1', protocol_version: 4 },
        });
      }
      return ok();
    });

    const setupError = await deviceService.getCompanionSetupError({
      requireToken: true,
      validateToken: true,
      serverIp: PC_B.ip,
      deviceId: 'pc-b',
    });

    expect(setupError).toContain('Companion 0.2.1');
    expect(setupError).toContain('Install Companion 0.2.3 or newer');
  });

  it('caches a rejected token briefly so background polling cannot cause lockout', async () => {
    await deviceService.setDeviceCompanionToken('pc-b', 'rejected-cache-token');
    await setPendingDeviceEnrollment('pc-b', null);
    const unauthorized = new Error('unauthorized') as Error & {
      isAxiosError: boolean;
      response: unknown;
    };
    unauthorized.isAxiosError = true;
    unauthorized.response = { status: 401, data: { ok: false, message: 'unauthorized' } };
    mockedRequest.mockReset();
    mockedRequest.mockRejectedValue(unauthorized);

    await expect(deviceService.checkPairing(PC_B.ip, 'pc-b')).rejects.toThrow(
      'Pairing token was rejected'
    );
    await expect(deviceService.checkPairing(PC_B.ip, 'pc-b')).rejects.toThrow(
      'Pairing token was rejected'
    );

    expect(mockedRequest).toHaveBeenCalledTimes(1);
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
