// Guarded access to `react-native-volume-manager`.
//
// That package throws from its own module scope when its native side is not
// linked into the running binary -- which is the normal state in Expo Go, on a
// simulator, and in any build made before the dependency was added. A static
// `import` therefore took the entire Control screen down at load time, even
// though hardware volume buttons are an optional extra that the screen already
// knows how to live without.
//
// Resolving it lazily moves that failure to the moment the feature is actually
// used, where the existing "Volume button remote unavailable" handling can
// deal with it.

export type HardwareVolumeManager = {
  setVolume(
    value: number,
    options?: { playSound?: boolean; showUI?: boolean }
  ): Promise<void>;
  showNativeVolumeUI(options: { enabled: boolean }): Promise<void>;
  getVolume(): Promise<{ volume: number }>;
  addVolumeListener(
    listener: (result: { volume: number }) => void
  ): { remove: () => void };
};

export const HARDWARE_VOLUME_UNAVAILABLE_MESSAGE =
  "Hardware volume buttons aren't available in this build.";

// `undefined` means "not looked up yet"; `null` means "looked up and missing".
let resolvedManager: HardwareVolumeManager | null | undefined;

const resolveVolumeManager = (): HardwareVolumeManager | null => {
  if (resolvedManager !== undefined) {
    return resolvedManager;
  }

  try {
    // Deliberately `require` rather than `import`: this call is what needs to
    // be catchable.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nativeModule = require('react-native-volume-manager');
    resolvedManager = (nativeModule?.VolumeManager as HardwareVolumeManager) ?? null;
  } catch {
    resolvedManager = null;
  }

  return resolvedManager;
};

export const isHardwareVolumeRemoteAvailable = (): boolean =>
  resolveVolumeManager() !== null;

/**
 * Throws when the native module is missing, so callers already wrapped in a
 * try/catch report it the same way as any other failure to start the remote.
 */
export const requireHardwareVolumeManager = (): HardwareVolumeManager => {
  const manager = resolveVolumeManager();

  if (!manager) {
    throw new Error(HARDWARE_VOLUME_UNAVAILABLE_MESSAGE);
  }

  return manager;
};

/**
 * Best-effort restore of the system volume HUD. Used on teardown paths, where
 * an unavailable module is not worth surfacing -- there is nothing to restore
 * if we never suppressed it.
 */
export const restoreNativeVolumeUi = (): void => {
  const manager = resolveVolumeManager();

  if (!manager) {
    return;
  }

  void manager.showNativeVolumeUI({ enabled: true }).catch(() => {});
};
