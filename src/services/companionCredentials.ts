import * as SecureStore from 'expo-secure-store';
import { normalizeTlsFingerprint } from './companionTransport';

// Per-computer companion secrets.
//
// These used to be four app-wide singletons (`serverIp`, `serverPort`, one
// token, one TLS fingerprint), which is why pairing a second computer
// overwrote the first. They are now keyed by device id, so every saved
// computer carries its own credentials.
//
// Only the secrets live here. The IP and ports live on the `Device` record in
// AsyncStorage, because they are not sensitive and the widget's app group
// needs to read them.

const TOKEN_PREFIX = 'wakemate.companion.token.v2.';
const FINGERPRINT_PREFIX = 'wakemate.companion.tlsFingerprint.v2.';

// The pre-multi-device keys. Read once during migration, then deleted.
export const LEGACY_TOKEN_KEY = 'wakemate.companion.token.v1';
export const LEGACY_FINGERPRINT_KEY = 'wakemate.companion.tlsFingerprint.v1';

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// SecureStore keys allow only alphanumerics, `.`, `-` and `_`. Device ids are
// generated locally, but a hostile or hand-edited id must not be able to
// collide with another device's key, so anything else is escaped rather than
// stripped.
const encodeDeviceId = (deviceId: string): string =>
  Array.from(deviceId.trim())
    .map((character) =>
      /[A-Za-z0-9._-]/.test(character)
        ? character
        : `-${character.codePointAt(0)?.toString(16) ?? '0'}-`
    )
    .join('');

const tokenKey = (deviceId: string): string => `${TOKEN_PREFIX}${encodeDeviceId(deviceId)}`;
const fingerprintKey = (deviceId: string): string =>
  `${FINGERPRINT_PREFIX}${encodeDeviceId(deviceId)}`;

const assertSecureStoreAvailable = async (): Promise<void> => {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error('Secure credential storage is unavailable on this device.');
  }
};

const readSecure = async (key: string): Promise<string | null> => {
  if (!(await SecureStore.isAvailableAsync())) {
    return null;
  }

  const value = await SecureStore.getItemAsync(key, SECURE_OPTIONS);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const deleteSecure = async (key: string): Promise<void> => {
  if (!(await SecureStore.isAvailableAsync())) {
    return;
  }

  await SecureStore.deleteItemAsync(key, SECURE_OPTIONS);
};

export const getDeviceToken = async (deviceId: string): Promise<string | null> => {
  if (!deviceId.trim()) {
    return null;
  }

  return readSecure(tokenKey(deviceId));
};

export const setDeviceToken = async (
  deviceId: string,
  token: string | null | undefined
): Promise<void> => {
  if (!deviceId.trim()) {
    throw new Error('A device is required before a pairing token can be saved.');
  }

  await assertSecureStoreAvailable();

  const trimmed = token?.trim() ?? '';
  if (!trimmed) {
    await deleteSecure(tokenKey(deviceId));
    return;
  }

  await SecureStore.setItemAsync(tokenKey(deviceId), trimmed, SECURE_OPTIONS);
};

export const getDeviceTlsFingerprint = async (deviceId: string): Promise<string | null> => {
  if (!deviceId.trim()) {
    return null;
  }

  const stored = await readSecure(fingerprintKey(deviceId));
  const fingerprint = normalizeTlsFingerprint(stored);

  // A stored value that no longer parses is worse than none: it would silently
  // downgrade the connection to plain HTTP on the next request.
  if (stored && !fingerprint) {
    await deleteSecure(fingerprintKey(deviceId));
  }

  return fingerprint;
};

export const setDeviceTlsFingerprint = async (
  deviceId: string,
  fingerprint: string | null | undefined
): Promise<void> => {
  if (!deviceId.trim()) {
    throw new Error('A device is required before a TLS fingerprint can be saved.');
  }

  await assertSecureStoreAvailable();

  const trimmed = fingerprint?.trim() ?? '';
  if (!trimmed) {
    await deleteSecure(fingerprintKey(deviceId));
    return;
  }

  const normalized = normalizeTlsFingerprint(trimmed);
  if (!normalized) {
    throw new Error('The pairing QR code contained an invalid TLS fingerprint.');
  }

  await SecureStore.setItemAsync(fingerprintKey(deviceId), normalized, SECURE_OPTIONS);
};

/** Drops every secret for one computer, for unpairing or deletion. */
export const clearDeviceCredentials = async (deviceId: string): Promise<void> => {
  if (!deviceId.trim()) {
    return;
  }

  await Promise.all([deleteSecure(tokenKey(deviceId)), deleteSecure(fingerprintKey(deviceId))]);
};

/** Reads the pre-multi-device secrets so they can be adopted by one device. */
export const readLegacyCredentials = async (): Promise<{
  token: string | null;
  fingerprint: string | null;
}> => {
  const [token, storedFingerprint] = await Promise.all([
    readSecure(LEGACY_TOKEN_KEY),
    readSecure(LEGACY_FINGERPRINT_KEY),
  ]);

  return { token, fingerprint: normalizeTlsFingerprint(storedFingerprint) };
};

export const clearLegacyCredentials = async (): Promise<void> => {
  await Promise.all([deleteSecure(LEGACY_TOKEN_KEY), deleteSecure(LEGACY_FINGERPRINT_KEY)]);
};
