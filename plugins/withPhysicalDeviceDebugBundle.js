const {
  createRunOncePlugin,
  withAppDelegate,
  withXcodeProject,
} = require('@expo/config-plugins');

const pluginName = 'with-physical-device-debug-bundle';
const pluginVersion = '1.1.0';

const DEFAULT_DEBUG_BUNDLE_URL = `#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else`;

const DEVICE_DEBUG_BUNDLE_URL = `#if DEBUG
    #if targetEnvironment(simulator)
      return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
    #else
      return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
        ?? RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
    #endif
#else`;

const APP_DELEGATE_CLASS_ANCHOR = '@UIApplicationMain';
const PHYSICAL_DEBUG_WINDOW_CLASS = `#if DEBUG && os(iOS) && !targetEnvironment(simulator)
private final class WakeMatePhysicalDebugWindow: UIWindow {
  override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
    if motion == .motionShake {
      return
    }

    super.motionEnded(motion, with: event)
  }
}
#endif

@UIApplicationMain`;

const DEFAULT_WINDOW_CREATION = '    window = UIWindow(frame: UIScreen.main.bounds)';
const PHYSICAL_DEBUG_WINDOW_CREATION = `#if DEBUG && os(iOS) && !targetEnvironment(simulator)
    window = WakeMatePhysicalDebugWindow(frame: UIScreen.main.bounds)
#else
    window = UIWindow(frame: UIScreen.main.bounds)
#endif`;

const FIXED_BUNDLE_SCRIPT = `if [[ -f "$PODS_ROOT/../.xcode.env" ]]; then
  source "$PODS_ROOT/../.xcode.env"
fi
if [[ -f "$PODS_ROOT/../.xcode.env.local" ]]; then
  source "$PODS_ROOT/../.xcode.env.local"
fi

# The project root by default is one level up from the ios directory
export PROJECT_ROOT="$PROJECT_DIR"/..

if [[ "$CONFIGURATION" = *Debug* && "$PLATFORM_NAME" == *simulator ]]; then
  export SKIP_BUNDLING=1
elif [[ "$CONFIGURATION" = *Debug* ]]; then
  # Physical-device debug builds need an embedded production bundle because
  # Expo devtools sockets are unavailable once the app is running from
  # main.jsbundle instead of Metro.
  export CONFIGURATION="Release"
  export NODE_ENV="production"
fi
if [[ -z "$ENTRY_FILE" ]]; then
  # Set the entry JS file using the bundler's entry resolution.
  export ENTRY_FILE="$("$NODE_BINARY" -e "require('expo/scripts/resolveAppEntry')" "$PROJECT_ROOT" ios absolute | tail -n 1)"
fi

if [[ -z "$CLI_PATH" ]]; then
  # Use Expo CLI
  export CLI_PATH="$("$NODE_BINARY" --print "require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] })")"
fi
if [[ -z "$BUNDLE_COMMAND" ]]; then
  # Default Expo CLI command for bundling
  export BUNDLE_COMMAND="export:embed"
fi

# Source .xcode.env.updates if it exists to allow
# SKIP_BUNDLING to be unset if needed
if [[ -f "$PODS_ROOT/../.xcode.env.updates" ]]; then
  source "$PODS_ROOT/../.xcode.env.updates"
fi
# Source local changes to allow overrides
# if needed
if [[ -f "$PODS_ROOT/../.xcode.env.local" ]]; then
  source "$PODS_ROOT/../.xcode.env.local"
fi

export RN_XCODE_SCRIPT_PATH="$("$NODE_BINARY" --print "require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'")"
/bin/sh "$RN_XCODE_SCRIPT_PATH"

`;

const withPhysicalDeviceDebugBundle = (config) => {
  config = withAppDelegate(config, (configWithAppDelegate) => {
    if (configWithAppDelegate.modResults.language !== 'swift') {
      throw new Error('withPhysicalDeviceDebugBundle: expected a Swift AppDelegate');
    }

    let { contents } = configWithAppDelegate.modResults;
    if (!contents.includes(DEVICE_DEBUG_BUNDLE_URL)) {
      if (!contents.includes(DEFAULT_DEBUG_BUNDLE_URL)) {
        throw new Error(
          'withPhysicalDeviceDebugBundle: could not find the generated bundleURL implementation'
        );
      }

      contents = contents.replace(DEFAULT_DEBUG_BUNDLE_URL, DEVICE_DEBUG_BUNDLE_URL);
    }

    // Physical-device Debug builds run an embedded production JS bundle, so
    // Metro cannot service React Native's shake menu. Swallow only that shake
    // gesture; simulator Debug and every Release build keep their normal
    // behavior.
    if (!contents.includes(PHYSICAL_DEBUG_WINDOW_CLASS)) {
      if (!contents.includes(APP_DELEGATE_CLASS_ANCHOR)) {
        throw new Error(
          'withPhysicalDeviceDebugBundle: could not find the AppDelegate class anchor'
        );
      }
      contents = contents.replace(APP_DELEGATE_CLASS_ANCHOR, PHYSICAL_DEBUG_WINDOW_CLASS);
    }

    if (!contents.includes(PHYSICAL_DEBUG_WINDOW_CREATION)) {
      if (!contents.includes(DEFAULT_WINDOW_CREATION)) {
        throw new Error(
          'withPhysicalDeviceDebugBundle: could not find the generated UIWindow creation'
        );
      }
      contents = contents.replace(DEFAULT_WINDOW_CREATION, PHYSICAL_DEBUG_WINDOW_CREATION);
    }

    configWithAppDelegate.modResults.contents = contents;
    return configWithAppDelegate;
  });

  return withXcodeProject(config, (configWithProject) => {
    // React Native's Xcode bundling script writes build artifacts like ip.txt
    // into the built app during device debug builds, which is blocked when
    // user script sandboxing is enabled.
    configWithProject.modResults.updateBuildProperty(
      'ENABLE_USER_SCRIPT_SANDBOXING',
      'NO'
    );

    const shellPhases =
      configWithProject.modResults.hash.project.objects
        .PBXShellScriptBuildPhase ?? {};
    let updatedBundlePhase = false;

    for (const [key, phase] of Object.entries(shellPhases)) {
      if (key.endsWith('_comment') || !phase) {
        continue;
      }

      const phaseName =
        typeof phase.name === 'string' ? phase.name.replaceAll('"', '') : '';
      if (phaseName !== 'Bundle React Native code and images') {
        continue;
      }

      phase.shellScript = JSON.stringify(FIXED_BUNDLE_SCRIPT);
      updatedBundlePhase = true;
      break;
    }

    if (!updatedBundlePhase) {
      throw new Error(
        'withPhysicalDeviceDebugBundle: could not find the React Native bundle phase'
      );
    }

    return configWithProject;
  });
};

module.exports = createRunOncePlugin(
  withPhysicalDeviceDebugBundle,
  pluginName,
  pluginVersion
);
