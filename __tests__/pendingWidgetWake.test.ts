// Covers the handoff the Control Center button uses when it cannot send the
// magic packet itself. The value is written by Swift
// (targets/widget/WakeMateWakeIntent.swift); these tests pin the contract the
// two sides share, and make sure a stale or malformed value can never fire an
// unexpected wake.

import { ExtensionStorage } from '@bacons/apple-targets';

import { consumePendingWidgetWake } from '../src/widget/pendingWidgetWake';

const storageInstance = (ExtensionStorage as unknown as jest.Mock).mock.results[0]
  ?.value as { get: jest.Mock; remove: jest.Mock };

beforeEach(() => {
  storageInstance.get.mockReset();
  storageInstance.remove.mockReset();
});

const pending = (deviceId: string, ageMs = 0) =>
  JSON.stringify({ deviceId, requestedAt: Date.now() - ageMs });

it('returns a fresh request and clears it so it fires exactly once', () => {
  storageInstance.get.mockReturnValue(pending('device-1'));

  expect(consumePendingWidgetWake()).toEqual({
    deviceId: 'device-1',
    requestedAt: expect.any(Number),
  });
  expect(storageInstance.remove).toHaveBeenCalledWith('wakemate.pendingWake');
});

it('ignores a request older than the expiry window', () => {
  storageInstance.get.mockReturnValue(pending('device-1', 5 * 60 * 1000));

  expect(consumePendingWidgetWake()).toBeNull();
  // Still cleared, so it cannot linger and fire on some later launch.
  expect(storageInstance.remove).toHaveBeenCalled();
});

it('returns nothing when no request is waiting', () => {
  storageInstance.get.mockReturnValue(null);

  expect(consumePendingWidgetWake()).toBeNull();
  expect(storageInstance.remove).not.toHaveBeenCalled();
});

it.each([
  ['not json', 'not json at all'],
  ['missing deviceId', JSON.stringify({ requestedAt: Date.now() })],
  ['empty deviceId', JSON.stringify({ deviceId: '   ', requestedAt: Date.now() })],
  ['missing timestamp', JSON.stringify({ deviceId: 'device-1' })],
])('discards a malformed request (%s) instead of acting on it', (_label, raw) => {
  storageInstance.get.mockReturnValue(raw);

  expect(consumePendingWidgetWake()).toBeNull();
  // Cleared regardless, so a wedged value cannot be retried forever.
  expect(storageInstance.remove).toHaveBeenCalled();
});

it('survives a storage read that throws', () => {
  storageInstance.get.mockImplementation(() => {
    throw new Error('app group unavailable');
  });

  expect(consumePendingWidgetWake()).toBeNull();
});
