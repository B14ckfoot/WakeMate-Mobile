const { createRunOncePlugin, withXcodeProject } = require('@expo/config-plugins');

const pluginName = 'with-quoted-react-native-bundle-script';
const pluginVersion = '1.0.0';

const FIXED_BUNDLE_SCRIPT = `if [[ -f "$PODS_ROOT/../.xcode.env" ]]; then
  source "$PODS_ROOT/../.xcode.env"
fi
if [[ -f "$PODS_ROOT/../.xcode.env.local" ]]; then
  source "$PODS_ROOT/../.xcode.env.local"
fi

# The project root by default is one level up from the ios directory
export PROJECT_ROOT="$PROJECT_DIR"/..

if [[ "$CONFIGURATION" = *Debug* ]]; then
  export SKIP_BUNDLING=1
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

const withQuotedReactNativeBundleScript = (config) =>
  withXcodeProject(config, (configWithProject) => {
    const shellPhases = configWithProject.modResults.hash.project.objects.PBXShellScriptBuildPhase ?? {};

    for (const [key, phase] of Object.entries(shellPhases)) {
      if (key.endsWith('_comment') || !phase) {
        continue;
      }

      const phaseName = typeof phase.name === 'string' ? phase.name.replaceAll('"', '') : '';
      if (phaseName !== 'Bundle React Native code and images') {
        continue;
      }

      phase.shellScript = JSON.stringify(FIXED_BUNDLE_SCRIPT);
    }

    return configWithProject;
  });

module.exports = createRunOncePlugin(
  withQuotedReactNativeBundleScript,
  pluginName,
  pluginVersion
);
