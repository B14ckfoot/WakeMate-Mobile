const { createRunOncePlugin, withXcodeProject } = require('@expo/config-plugins');

const pluginName = 'with-ios-only-app-target';
const pluginVersion = '1.0.0';

const APP_PRODUCT_TYPE = 'com.apple.product-type.application';

const IOS_ONLY_SETTINGS = {
  SUPPORTED_PLATFORMS: '"iphoneos iphonesimulator"',
  SUPPORTS_MACCATALYST: 'NO',
  SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD: 'NO',
};

/**
 * Pins the *main app* target to iOS.
 *
 * Scope note -- there are deliberately two owners of these settings:
 *
 *   - The widget extension gets them from the patched @bacons/apple-targets
 *     (see patches/@bacons+apple-targets+4.0.6.patch). It has to come from
 *     there, because that plugin deletes and recreates the widget target's
 *     build configuration list on every prebuild, discarding anything a
 *     config plugin wrote beforehand.
 *   - The main app target gets them here. apple-targets never touches the app
 *     target's configuration list, so a config plugin is reliable for it.
 *
 * A now-deleted plugin tried to own the widget settings from here too, and
 * could not: on an incremental prebuild its values were overwritten, and on a
 * clean prebuild it threw outright, because the classic `ios.xcodeproj` mod
 * runs before apple-targets has created the widget target.
 *
 * Without this, the app target has no platform constraint at all, so Xcode is
 * free to offer a "Mac (Designed for iPhone)" variant -- which would embed the
 * iOS-only widget and reintroduce the platform mismatch this exists to stop.
 */
const withIosOnlyAppTarget = (config) =>
  withXcodeProject(config, (configWithProject) => {
    const project = configWithProject.modResults;
    const objects = project.hash.project.objects;
    const nativeTargets = objects.PBXNativeTarget ?? {};

    // Found by product type rather than by name: `expo prebuild --clean`
    // renames the project from the app name, so a hardcoded name goes stale.
    const appTargetEntry = Object.entries(nativeTargets).find(
      ([key, target]) =>
        !key.endsWith('_comment') &&
        target &&
        String(target.productType ?? '').replace(/"/g, '') === APP_PRODUCT_TYPE
    );

    if (!appTargetEntry) {
      throw new Error('withIosOnlyAppTarget: could not find the main app target');
    }

    const configurationListId = appTargetEntry[1].buildConfigurationList;
    const configurationList = (objects.XCConfigurationList ?? {})[configurationListId];

    if (!configurationList) {
      throw new Error('withIosOnlyAppTarget: app target has no build configuration list');
    }

    // Every configuration, so Debug and Release stay in step.
    for (const entry of configurationList.buildConfigurations ?? []) {
      const buildConfiguration = (objects.XCBuildConfiguration ?? {})[entry.value];

      if (buildConfiguration?.buildSettings) {
        Object.assign(buildConfiguration.buildSettings, IOS_ONLY_SETTINGS);
      }
    }

    return configWithProject;
  });

module.exports = createRunOncePlugin(withIosOnlyAppTarget, pluginName, pluginVersion);
