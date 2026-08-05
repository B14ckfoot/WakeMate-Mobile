// The widget extension resolves which computer to wake from app-group state:
// the device this widget was configured with, else the favorite chosen here,
// else the first computer that was added. These tests pin the app half of that
// contract -- the Swift half lives in
// targets/widget/_shared/WakeMateShared.swift (`WakeMateSharedStore.resolve`).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ExtensionStorage } from '@bacons/apple-targets';

import {
  getFavoriteDeviceId,
  reconcileFavoriteDevice,
  resolveWidgetDevice,
  setFavoriteDeviceId,
} from '../src/services/favoriteDevice';
import { Device } from '../src/types/device';

const storageInstance = (ExtensionStorage as unknown as jest.Mock).mock.results[0]
  ?.value as { set: jest.Mock; remove: jest.Mock };

const FAVORITE_KEY = 'wakemate.favoriteDeviceId';

const device = (id: string, name: string): Device => ({
  id,
  name,
  mac: '00:11:22:33:44:55',
  ip: '192.168.1.20',
  wakeAddress: '192.168.1.255',
  wakePort: 9,
  status: 'offline',
  type: 'wifi',
  platform: 'windows',
  apiPort: 7777,
  tlsPort: null,
});

const FIRST_PC = device('first-pc', 'Zulu Tower');
const SECOND_PC = device('second-pc', 'Alpha Laptop');

beforeEach(async () => {
  await AsyncStorage.clear();
  storageInstance.set.mockClear();
  storageInstance.remove.mockClear();
});

it('mirrors a chosen favorite into the app group so the widget can read it', async () => {
  await expect(setFavoriteDeviceId(SECOND_PC.id)).resolves.toBe(SECOND_PC.id);

  expect(storageInstance.set).toHaveBeenCalledWith(FAVORITE_KEY, SECOND_PC.id);
  await expect(getFavoriteDeviceId()).resolves.toBe(SECOND_PC.id);
});

it('clears the mirrored key when the favorite is removed', async () => {
  await setFavoriteDeviceId(FIRST_PC.id);
  storageInstance.set.mockClear();

  await expect(setFavoriteDeviceId(null)).resolves.toBeNull();

  // An absent key is what "no favorite" has to look like to the extension.
  expect(storageInstance.remove).toHaveBeenCalledWith(FAVORITE_KEY);
  expect(storageInstance.set).not.toHaveBeenCalled();
  await expect(getFavoriteDeviceId()).resolves.toBeNull();
});

it('treats a blank stored value as no favorite at all', async () => {
  await AsyncStorage.setItem(FAVORITE_KEY, '   ');

  await expect(getFavoriteDeviceId()).resolves.toBeNull();
});

describe('resolveWidgetDevice', () => {
  it('prefers the favorite over the first saved computer', () => {
    expect(resolveWidgetDevice([FIRST_PC, SECOND_PC], SECOND_PC.id)).toBe(SECOND_PC);
  });

  it('falls back to the first computer that was added, not the first by name', () => {
    expect(resolveWidgetDevice([FIRST_PC, SECOND_PC], null)).toBe(FIRST_PC);
  });

  it('falls back when the favorite points at a computer that is gone', () => {
    expect(resolveWidgetDevice([FIRST_PC], SECOND_PC.id)).toBe(FIRST_PC);
  });

  it('resolves to nothing when no computers are saved', () => {
    expect(resolveWidgetDevice([], SECOND_PC.id)).toBeNull();
  });
});

describe('reconcileFavoriteDevice', () => {
  it('drops a favorite whose computer was deleted', async () => {
    await setFavoriteDeviceId(SECOND_PC.id);
    storageInstance.set.mockClear();

    await expect(reconcileFavoriteDevice([FIRST_PC])).resolves.toBeNull();

    expect(storageInstance.remove).toHaveBeenCalledWith(FAVORITE_KEY);
    await expect(getFavoriteDeviceId()).resolves.toBeNull();
  });

  it('keeps and re-mirrors a favorite that is still saved', async () => {
    await setFavoriteDeviceId(SECOND_PC.id);
    storageInstance.set.mockClear();

    await expect(reconcileFavoriteDevice([FIRST_PC, SECOND_PC])).resolves.toBe(SECOND_PC.id);

    expect(storageInstance.set).toHaveBeenCalledWith(FAVORITE_KEY, SECOND_PC.id);
  });
});
