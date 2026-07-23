const { createRunOncePlugin, withXcodeProject } = require('@expo/config-plugins');

const pluginName = 'with-ios-only-widget';
const pluginVersion = '1.0.0';
const widgetTargetName = 'WakeMateWidgets';

const withIosOnlyWidget = (config) =>
  withXcodeProject(config, (configWithProject) => {
    const project = configWithProject.modResults;
    const objects = project.hash.project.objects;
    const nativeTargets = objects.PBXNativeTarget ?? {};

    const widgetTargetEntry = Object.entries(nativeTargets).find(
      ([key, target]) =>
        !key.endsWith('_comment') &&
        target &&
        (target.name === widgetTargetName || target.productName === widgetTargetName)
    );

    if (!widgetTargetEntry) {
      throw new Error(`Could not find the ${widgetTargetName} Xcode target`);
    }

    const [widgetTargetId, widgetTarget] = widgetTargetEntry;

    // @bacons/apple-targets does not currently emit SUPPORTED_PLATFORMS for
    // widget targets. Newer Xcode versions can consequently infer macOS.
    project.updateBuildProperty(
      'SUPPORTED_PLATFORMS',
      '"iphoneos iphonesimulator"',
      undefined,
      widgetTargetName
    );
    project.updateBuildProperty('SUPPORTS_MACCATALYST', 'NO', undefined, widgetTargetName);
    project.updateBuildProperty(
      'SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD',
      'NO',
      undefined,
      widgetTargetName
    );

    // Match Xcode's Platforms filter for the target dependency and the
    // embedded extension product so neither participates in a macOS build.
    for (const [key, dependency] of Object.entries(objects.PBXTargetDependency ?? {})) {
      if (!key.endsWith('_comment') && dependency?.target === widgetTargetId) {
        dependency.platformFilter = 'ios';
      }
    }

    for (const [key, buildFile] of Object.entries(objects.PBXBuildFile ?? {})) {
      if (
        !key.endsWith('_comment') &&
        buildFile?.fileRef === widgetTarget.productReference
      ) {
        buildFile.platformFilter = 'ios';
      }
    }

    return configWithProject;
  });

module.exports = createRunOncePlugin(withIosOnlyWidget, pluginName, pluginVersion);
