// Native modules that have no JS implementation under Jest. Each one is
// replaced with the package's own official mock where it ships one, so tests
// exercise the real app code rather than a reimplementation of it.

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// A tiny in-memory keychain, so tests can seed a pairing token the same way
// the app stores one.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    isAvailableAsync: jest.fn(async () => true),
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
  };
});

// axios' fetch adapter probes streams at import time, which crashes the
// jest-expo environment. The stub keeps `isAxiosError` behaving exactly as
// axios defines it (the `isAxiosError` flag), and lets tests drive
// `axios.request` to exercise the real transport code above it.
jest.mock('axios', () => {
  const request = jest.fn();
  const isAxiosError = (value) => Boolean(value) && value.isAxiosError === true;
  return {
    __esModule: true,
    default: { request, isAxiosError },
    request,
    isAxiosError,
  };
});

// UDP discovery and the pinned-TLS bridge are native; nothing under test
// reaches them, but they are imported at module scope.
jest.mock('react-native-udp', () => ({
  __esModule: true,
  default: { createSocket: jest.fn() },
}));

jest.mock('react-native-wake-on-lan', () => ({
  sendMagicPacket: jest.fn(),
}));

// The app-group bridge into the widget extension. One shared instance so tests
// can drive whatever the Control Center intent "wrote".
jest.mock('@bacons/apple-targets', () => {
  const instance = {
    set: jest.fn(),
    get: jest.fn(() => null),
    remove: jest.fn(),
  };
  const ExtensionStorage = jest.fn(() => instance);
  ExtensionStorage.reloadWidget = jest.fn();
  ExtensionStorage.reloadControls = jest.fn();
  return { ExtensionStorage };
});
