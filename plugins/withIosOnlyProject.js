const { createRunOncePlugin, withXcodeProject } = require('@expo/config-plugins');

const pluginName = 'with-ios-only-project';
const pluginVersion = '1.0.0';

const IOS_ONLY_SETTINGS = {
  SUPPORTED_PLATFORMS: '"iphoneos iphonesimulator"',
  SUPPORTS_MACCATALYST: 'NO',
  SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD: 'NO',
  SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD: 'NO',
};

/**
 * Pins the whole Xcode project to iOS at the project configuration level.
 * Targets created later by @bacons/apple-targets inherit these values, so the
 * settings survive both clean and incremental prebuilds.
 */
const withIosOnlyProject = (config) =>
  withXcodeProject(config, (configWithProject) => {
    const project = configWithProject.modResults;
    const objects = project.hash.project.objects;
    const configurationListId =
      project.getFirstProject().firstProject.buildConfigurationList;
    const configurationList =
      (objects.XCConfigurationList ?? {})[configurationListId];

    if (!configurationList) {
      throw new Error(
        'withIosOnlyProject: Xcode project has no build configuration list'
      );
    }

    const buildConfigurations = configurationList.buildConfigurations ?? [];
    if (buildConfigurations.length === 0) {
      throw new Error('withIosOnlyProject: Xcode project has no build configurations');
    }

    for (const entry of buildConfigurations) {
      const buildConfiguration =
        (objects.XCBuildConfiguration ?? {})[entry.value];

      if (!buildConfiguration?.buildSettings) {
        throw new Error(
          `withIosOnlyProject: missing build settings for ${entry.comment ?? entry.value}`
        );
      }

      Object.assign(buildConfiguration.buildSettings, IOS_ONLY_SETTINGS);
    }

    return configWithProject;
  });

module.exports = createRunOncePlugin(withIosOnlyProject, pluginName, pluginVersion);
