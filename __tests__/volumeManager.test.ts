// `react-native-volume-manager` throws from its own module scope when the
// native side isn't linked (Expo Go, simulator, or a binary built before the
// dependency was added). A static import of it crashed the whole Control
// screen at load. These tests pin the guard that keeps an optional feature
// from taking the screen down.

describe('when the native module is missing', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native-volume-manager', () => {
      throw new Error("The package 'react-native-volume-manager' doesn't seem to be linked.");
    });
  });

  it('reports itself unavailable instead of throwing on import', () => {
    const volumeManager = require('../src/native/volumeManager');

    expect(volumeManager.isHardwareVolumeRemoteAvailable()).toBe(false);
  });

  it('throws only when the feature is actually used', () => {
    const { requireHardwareVolumeManager } = require('../src/native/volumeManager');

    // Deferred to here so the Control screen's existing try/catch reports it
    // as "Volume button remote unavailable" rather than a red screen.
    expect(() => requireHardwareVolumeManager()).toThrow(/aren't available in this build/i);
  });

  it('treats restoring the volume HUD as a no-op', () => {
    const { restoreNativeVolumeUi } = require('../src/native/volumeManager');

    // Runs on every teardown, including when the feature was never enabled.
    expect(() => restoreNativeVolumeUi()).not.toThrow();
  });
});

describe('when the native module is present', () => {
  const showNativeVolumeUI = jest.fn(async () => undefined);

  beforeEach(() => {
    jest.resetModules();
    showNativeVolumeUI.mockClear();
    jest.doMock('react-native-volume-manager', () => ({
      VolumeManager: {
        showNativeVolumeUI,
        getVolume: jest.fn(async () => ({ volume: 0.5 })),
        setVolume: jest.fn(async () => undefined),
        addVolumeListener: jest.fn(() => ({ remove: jest.fn() })),
      },
    }));
  });

  it('reports itself available', () => {
    const { isHardwareVolumeRemoteAvailable } = require('../src/native/volumeManager');

    expect(isHardwareVolumeRemoteAvailable()).toBe(true);
  });

  it('hands back the real module', () => {
    const { requireHardwareVolumeManager } = require('../src/native/volumeManager');

    expect(typeof requireHardwareVolumeManager().getVolume).toBe('function');
  });

  it('restores the volume HUD through the real module', () => {
    const { restoreNativeVolumeUi } = require('../src/native/volumeManager');

    restoreNativeVolumeUi();

    expect(showNativeVolumeUI).toHaveBeenCalledWith({ enabled: true });
  });
});
