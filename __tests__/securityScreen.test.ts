// Covers the phone half of the Windows Security (Ctrl+Alt+Delete) command,
// end to end: real deviceService, real command mapping, real transport, with
// only the HTTP call itself stubbed. The point is that no combination of
// companion reply, HTTP status, or network failure can make the app report
// success when the security screen did not open.

import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

import deviceService, { isSecureAttentionCombo } from '../src/services/deviceService';

const mockedRequest = axios.request as unknown as jest.Mock;

const SERVER_IP = '10.0.0.19';
const PAIRING_TOKEN = 'test-pairing-token';

// Shapes the companion's `/v1/command` reply for the security screen.
const companionReply = (
  ok: boolean,
  data: Record<string, unknown> | null,
  message = 'security screen'
) => ({
  status: 200,
  headers: {},
  data: data === null ? { ok, message } : { ok, message, data },
});

const axiosFailure = (status: number | undefined, data?: unknown, code?: string) => {
  const error = new Error(
    status === undefined ? 'Network Error' : `Request failed with status code ${status}`
  ) as Error & { isAxiosError: boolean; code?: string; response?: unknown };
  error.isAxiosError = true;
  if (code) {
    error.code = code;
  }
  if (status !== undefined) {
    error.response = { status, data, config: { url: '' } };
  }
  return error;
};

beforeEach(async () => {
  mockedRequest.mockReset();
  await AsyncStorage.clear();
  await AsyncStorage.setItem('serverIp', SERVER_IP);
  await SecureStore.deleteItemAsync('wakemate.companion.token.v1');
  await deviceService.setServerToken(PAIRING_TOKEN);
});

describe('sending the security-screen command', () => {
  it('posts the allowlisted command with the pairing token and the chosen fallback', async () => {
    mockedRequest.mockResolvedValue(
      companionReply(true, {
        status: 'success',
        action: 'secure_attention_sequence',
        fallback_used: false,
        detail: 'Windows accepted the Secure Attention Sequence',
      })
    );

    await deviceService.sendSecurityScreen('device-1', SERVER_IP, { fallback: 'lock' });

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const call = mockedRequest.mock.calls[0][0];

    expect(call.url).toBe(`http://${SERVER_IP}:7777/v1/command`);
    expect(call.method).toBe('POST');
    expect(call.data).toEqual({ type: 'security_screen', fallback: 'lock' });
    expect(call.headers['x-wakemate-token']).toBe(PAIRING_TOKEN);
    // Long enough to survive a switch to the Windows secure desktop.
    expect(call.timeout).toBeGreaterThanOrEqual(10000);
  });

  it('defaults to a fallback that touches nothing when none is asked for', async () => {
    mockedRequest.mockResolvedValue(
      companionReply(false, { status: 'permission_required', action: 'none', fallback_used: false })
    );

    await deviceService.sendSecurityScreen('device-1', SERVER_IP);

    expect(mockedRequest.mock.calls[0][0].data).toEqual({
      type: 'security_screen',
      fallback: 'none',
    });
  });

  it('reports the real security screen when Windows opened it', async () => {
    mockedRequest.mockResolvedValue(
      companionReply(true, {
        status: 'success',
        action: 'secure_attention_sequence',
        fallback_used: false,
        detail: 'Windows accepted the Secure Attention Sequence',
      })
    );

    const outcome = await deviceService.sendSecurityScreen('device-1', SERVER_IP, {
      fallback: 'lock',
    });

    expect(outcome.status).toBe('success');
    expect(outcome.action).toBe('secure_attention_sequence');
    expect(outcome.fallbackUsed).toBe(false);
  });

  it('distinguishes a lock fallback from the real thing', async () => {
    mockedRequest.mockResolvedValue(
      companionReply(true, {
        status: 'success',
        action: 'lock',
        fallback_used: true,
        detail: 'Windows policy is off on this computer',
      })
    );

    const outcome = await deviceService.sendSecurityScreen('device-1', SERVER_IP, {
      fallback: 'lock',
    });

    expect(outcome.status).toBe('success');
    expect(outcome.action).toBe('lock');
    // The UI relies on this to say "locked instead" rather than "opened".
    expect(outcome.fallbackUsed).toBe(true);
  });

  it.each([
    ['permission_required'],
    ['unsupported'],
    ['execution_failed'],
  ])('passes through the companion status %s', async (status) => {
    mockedRequest.mockResolvedValue(
      companionReply(false, { status, action: 'none', fallback_used: false, detail: 'nope' })
    );

    const outcome = await deviceService.sendSecurityScreen('device-1', SERVER_IP);

    expect(outcome.status).toBe(status);
    expect(outcome.action).toBe('none');
  });
});

describe('never reporting a success the companion did not confirm', () => {
  it('treats a 200 with no structured payload as a failure', async () => {
    // An older companion answers `{ok:true,message:"key press sent"}` with no
    // `data`. That must not read as "the security screen opened".
    mockedRequest.mockResolvedValue(companionReply(true, null, 'key press sent'));

    const outcome = await deviceService.sendSecurityScreen('device-1', SERVER_IP);

    expect(outcome.status).toBe('execution_failed');
    expect(outcome.action).toBe('none');
  });

  it('rejects an unrecognised status rather than trusting it', async () => {
    mockedRequest.mockResolvedValue(
      companionReply(true, { status: 'totally_fine', action: 'secure_attention_sequence' })
    );

    const outcome = await deviceService.sendSecurityScreen('device-1', SERVER_IP);

    expect(outcome.status).toBe('execution_failed');
  });

  it('does not inherit an unknown action', async () => {
    mockedRequest.mockResolvedValue(
      companionReply(true, { status: 'success', action: 'reformat_disk', fallback_used: false })
    );

    const outcome = await deviceService.sendSecurityScreen('device-1', SERVER_IP);

    expect(outcome.action).toBe('none');
  });
});

describe('classifying transport failures', () => {
  it('reports an unreachable computer as offline', async () => {
    mockedRequest.mockRejectedValue(axiosFailure(undefined));

    const outcome = await deviceService.sendSecurityScreen('device-1', SERVER_IP);

    expect(outcome.status).toBe('offline');
  });

  it('reports a slow companion as a timeout', async () => {
    mockedRequest.mockRejectedValue(axiosFailure(undefined, undefined, 'ECONNABORTED'));

    const outcome = await deviceService.sendSecurityScreen('device-1', SERVER_IP);

    expect(outcome.status).toBe('timeout');
  });

  it('reports a rejected token as unauthorized', async () => {
    mockedRequest.mockRejectedValue(axiosFailure(401, { ok: false, message: 'unauthorized' }));

    const outcome = await deviceService.sendSecurityScreen('device-1', SERVER_IP);

    expect(outcome.status).toBe('unauthorized');
  });

  it('reports disabled power commands as permission_required', async () => {
    mockedRequest.mockRejectedValue(
      axiosFailure(403, { ok: false, message: 'power commands are disabled in the config' })
    );

    const outcome = await deviceService.sendSecurityScreen('device-1', SERVER_IP);

    expect(outcome.status).toBe('permission_required');
    expect(outcome.detail).toContain('power commands are disabled');
  });

  it('reports an unpaired phone as unauthorized without calling the companion', async () => {
    await deviceService.setServerToken('');

    const outcome = await deviceService.sendSecurityScreen('device-1', SERVER_IP);

    expect(outcome.status).toBe('unauthorized');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('caps companion-supplied detail instead of trusting its length', async () => {
    mockedRequest.mockResolvedValue(
      companionReply(false, {
        status: 'permission_required',
        action: 'none',
        fallback_used: false,
        detail: 'x'.repeat(5000),
      })
    );

    const outcome = await deviceService.sendSecurityScreen('device-1', SERVER_IP);

    expect(outcome.detail?.length).toBeLessThanOrEqual(240);
  });
});

describe('refusing Ctrl+Alt+Delete as a keystroke', () => {
  it('recognises the sequence in any order or spelling', () => {
    for (const combo of [
      'ctrl+alt+delete',
      'control+alt+del',
      'CTRL+Alt+Delete',
      'delete+ctrl+alt',
      ' ctrl + alt + delete ',
    ]) {
      expect(isSecureAttentionCombo(combo)).toBe(true);
    }
  });

  it('leaves ordinary shortcuts alone', () => {
    for (const combo of [
      'ctrl+c',
      'alt+tab',
      'ctrl+alt+t',
      'ctrl+shift+delete',
      'alt+delete',
      'win+d',
    ]) {
      expect(isSecureAttentionCombo(combo)).toBe(false);
    }
  });

  it('never puts the sequence on the wire as a key press', async () => {
    await expect(
      deviceService.sendSpecialKey('device-1', SERVER_IP, 'ctrl+alt+delete')
    ).rejects.toThrow(/cannot be sent as a keystroke/i);

    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('still sends the shortcuts that do work', async () => {
    mockedRequest.mockResolvedValue({ status: 200, headers: {}, data: { ok: true, message: 'key press sent: ctrl+c' } });

    await deviceService.sendSpecialKey('device-1', SERVER_IP, 'ctrl+c');

    expect(mockedRequest.mock.calls[0][0].data).toEqual({ type: 'key_press', key: 'ctrl+c' });
  });
});

describe('leaving the other remote controls untouched', () => {
  it.each([
    ['sendSleep', { type: 'system', action: 'sleep' }],
    ['sendRestart', { type: 'system', action: 'restart' }],
    ['sendShutdown', { type: 'system', action: 'shutdown' }],
    ['sendLogoff', { type: 'system', action: 'logoff' }],
    ['sendLock', { type: 'system', action: 'lock' }],
    ['sendMediaPlayPause', { type: 'media', action: 'play_pause' }],
    ['sendVolumeMute', { type: 'media', action: 'mute' }],
  ])('%s still sends its established payload', async (method, payload) => {
    mockedRequest.mockResolvedValue({ status: 200, headers: {}, data: { ok: true, message: 'ok' } });

    await (deviceService as any)[method]('device-1', SERVER_IP);

    expect(mockedRequest.mock.calls[0][0].data).toEqual(payload);
  });

  it('still sends mouse movement unchanged', async () => {
    mockedRequest.mockResolvedValue({ status: 200, headers: {}, data: { ok: true, message: 'ok' } });

    await deviceService.sendMouseMove('device-1', SERVER_IP, 12, -8);

    expect(mockedRequest.mock.calls[0][0].data).toEqual({
      type: 'mouse_move',
      delta_x: 12,
      delta_y: -8,
    });
  });
});
