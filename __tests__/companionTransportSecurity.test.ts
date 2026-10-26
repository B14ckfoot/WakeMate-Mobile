import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

import { requestPinnedHttps } from '../modules/wakemate-tls';
import {
  requestCompanion,
  SECURE_PAIRING_REQUIRED_MESSAGE,
  SECURE_STORAGE_UNAVAILABLE_MESSAGE,
} from '../src/services/companionTransport';
import deviceService from '../src/services/deviceService';
import { Device } from '../src/types/device';

jest.mock('../modules/wakemate-tls', () => ({ requestPinnedHttps: jest.fn() }));

const httpRequest = axios.request as jest.Mock;
const pinnedRequest = requestPinnedHttps as jest.Mock;
const pin = 'ab'.repeat(32);
const pinKey = 'wakemate.companion.tlsFingerprint.v2.pc-secure';
const device: Device = {
  id: 'pc-secure', name: 'Desk PC', ip: '10.0.0.19', mac: '00:11:22:33:44:55',
  wakeAddress: '10.0.0.255', wakePort: 9, apiPort: 7777, tlsPort: 7778,
  status: 'offline', type: 'wifi', platform: 'windows',
};

beforeEach(async () => {
  httpRequest.mockReset();
  pinnedRequest.mockReset().mockResolvedValue({ status: 200, headers: {}, body: '{"ok":true}' });
  (SecureStore.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  await AsyncStorage.clear();
  await deviceService.clearDeviceCompanionCredentials(device.id);
  await deviceService.setServerToken('');
  await deviceService.setServerTlsFingerprint(null);
  await deviceService.saveDevices([device]);
  await deviceService.setDeviceCompanionToken(device.id, 'approved-device-token');
});

const expectNoNetwork = () => {
  expect(httpRequest).not.toHaveBeenCalled();
  expect(pinnedRequest).not.toHaveBeenCalled();
};

describe('transport security boundary', () => {
  it.each([undefined, null, '', 'broken-pin'])('never sends credentials with pin %s', async (tlsFingerprint) => {
    await expect(requestCompanion({
      ip: device.ip, port: 7777, path: '/v1/command', method: 'POST',
      headers: { 'x-wakemate-token': 'approved-device-token' }, timeoutMs: 1000, tlsFingerprint,
    })).rejects.toThrow(SECURE_PAIRING_REQUIRED_MESSAGE);
    expectNoNetwork();
  });

  it('permits only the unauthenticated public HTTP health probe', async () => {
    httpRequest.mockResolvedValue({ status: 200, headers: {}, data: { ok: true } });
    await requestCompanion({ ip: device.ip, port: 7777, path: '/v1/health', timeoutMs: 1000 });
    expect(httpRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://10.0.0.19:7777/v1/health', headers: {},
    }));
    expect(pinnedRequest).not.toHaveBeenCalled();
  });

  it.each(['X-WakeMate-Token', 'Authorization', 'Cookie'])('does not send %s through a public probe', async (header) => {
    await expect(requestCompanion({
      ip: device.ip, port: 7777, path: '/v1/health', timeoutMs: 1000,
      headers: { [header]: 'secret' },
    })).rejects.toThrow(SECURE_PAIRING_REQUIRED_MESSAGE);
    expectNoNetwork();
  });

  it('rejects an invalid public-probe pin instead of treating it as absent', async () => {
    await expect(requestCompanion({
      ip: device.ip, port: 7777, path: '/v1/health', timeoutMs: 1000, tlsFingerprint: 'invalid',
    })).rejects.toThrow(SECURE_PAIRING_REQUIRED_MESSAGE);
    expectNoNetwork();
  });

  it('does not expose another endpoint through the public HTTP exception', async () => {
    await expect(requestCompanion({
      ip: device.ip, port: 7777, path: '/v1/info', timeoutMs: 1000,
    })).rejects.toThrow(SECURE_PAIRING_REQUIRED_MESSAGE);
    expectNoNetwork();
  });

  it('sends a normalized valid pin and credentials only through native HTTPS', async () => {
    await requestCompanion({
      ip: device.ip, port: 7778, path: '/v1/command', method: 'POST',
      headers: { 'x-wakemate-token': 'secret' }, data: { type: 'media', action: 'mute' },
      timeoutMs: 1000, tlsFingerprint: `sha256:${'AB:'.repeat(31)}AB`,
    });
    expect(pinnedRequest).toHaveBeenCalledWith(
      'https://10.0.0.19:7778/v1/command', 'POST',
      { 'x-wakemate-token': 'secret', 'Content-Type': 'application/json' },
      '{"type":"media","action":"mute"}', pin, 1000
    );
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('never retries a certificate mismatch through HTTP', async () => {
    pinnedRequest.mockRejectedValue(new Error('certificate fingerprint mismatch'));
    await expect(requestCompanion({
      ip: device.ip, port: 7778, path: '/v1/pairing/check', timeoutMs: 1000,
      headers: { 'x-wakemate-token': 'secret' }, tlsFingerprint: pin,
    })).rejects.toThrow('certificate fingerprint mismatch');
    expect(httpRequest).not.toHaveBeenCalled();
    expect(pinnedRequest).toHaveBeenCalledTimes(1);
  });
});

describe('stored identity and address changes', () => {
  it('requires re-pairing when an approved device loses its pin', async () => {
    await expect(deviceService.sendSleep(device.id, device.ip)).rejects.toThrow(SECURE_PAIRING_REQUIRED_MESSAGE);
    expectNoNetwork();
  });

  it('preserves a corrupt stored pin and blocks authenticated requests', async () => {
    await SecureStore.setItemAsync(pinKey, 'corrupted-certificate-pin');
    await expect(deviceService.sendSleep(device.id, device.ip)).rejects.toThrow(SECURE_PAIRING_REQUIRED_MESSAGE);
    expect(await SecureStore.getItemAsync(pinKey)).toBe('corrupted-certificate-pin');
    expectNoNetwork();
  });

  it('reports unavailable secure storage without attempting a request', async () => {
    (SecureStore.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    await expect(deviceService.sendSleep(device.id, device.ip)).rejects.toThrow(SECURE_STORAGE_UNAVAILABLE_MESSAGE);
    expectNoNetwork();
  });

  it('reports a keychain read failure without erasing or replacing its pin', async () => {
    await deviceService.setDeviceCompanionTlsFingerprint(device.id, pin);
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Keychain is locked'));
    await expect(deviceService.sendSleep(device.id, device.ip)).rejects.toThrow(SECURE_STORAGE_UNAVAILABLE_MESSAGE);
    expect(await SecureStore.getItemAsync(pinKey)).toBe(pin);
    expectNoNetwork();
  });

  it('keeps the saved computer pin and TLS port when a caller overrides its IP', async () => {
    await deviceService.setDeviceCompanionTlsFingerprint(device.id, pin);
    await deviceService.sendSleep(device.id, '10.0.0.42');
    expect(pinnedRequest).toHaveBeenCalledWith(
      'https://10.0.0.42:7778/v1/command', 'POST', expect.any(Object), expect.any(String), pin, 5000
    );
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('preserves a global pin across saved and explicit address changes', async () => {
    await deviceService.setServerConnection(device.ip, 7443);
    await deviceService.setServerTlsFingerprint(pin);
    await deviceService.setServerToken('unmigrated-token');
    await deviceService.setServerAddress('10.0.0.42');
    await deviceService.checkPairing('10.0.0.77');
    expect(await deviceService.getServerTlsFingerprint()).toBe(pin);
    expect(pinnedRequest).toHaveBeenCalledWith(
      'https://10.0.0.77:7443/v1/pairing/check', 'GET', expect.any(Object), null, pin, expect.any(Number)
    );
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('rejects invalid QR security before changing saved credentials', async () => {
    await deviceService.setDeviceCompanionTlsFingerprint(device.id, pin);
    const result = await deviceService.pairDeviceFromQr(device.id, {
      ip: '10.0.0.42', token: 'legacy-qr-token', apiPort: 7777,
    });
    expect(result).toEqual({ status: 'failed', detail: SECURE_PAIRING_REQUIRED_MESSAGE });
    expect(await deviceService.getDeviceCompanionToken(device.id)).toBe('approved-device-token');
    expect(await deviceService.getDeviceCompanionTlsFingerprint(device.id)).toBe(pin);
    expectNoNetwork();
  });

  it('does not borrow a global credential for an unpaired saved computer', async () => {
    await deviceService.setDeviceCompanionTlsFingerprint(device.id, pin);
    await deviceService.setDeviceCompanionToken(device.id, '');
    await deviceService.setServerToken('another-computer-token');
    await expect(deviceService.sendSleep(device.id, device.ip)).rejects.toThrow('Pairing token not set');
    expectNoNetwork();
  });

  it('preserves device identity in the generic status and relay commands', async () => {
    await deviceService.setDeviceCompanionTlsFingerprint(device.id, pin);
    await deviceService.sendCommandTo(device.ip, 'get_status', {}, device.id);
    await deviceService.sendCommandTo(device.ip, 'wake', { mac: device.mac }, device.id);
    expect(pinnedRequest.mock.calls.map((call) => call[0])).toEqual([
      'https://10.0.0.19:7778/v1/info', 'https://10.0.0.19:7778/v1/wake',
    ]);
    for (const call of pinnedRequest.mock.calls) {
      expect(call[2]['x-wakemate-token']).toBe('approved-device-token');
      expect(call[4]).toBe(pin);
    }
    expect(httpRequest).not.toHaveBeenCalled();
  });
});
