const {
  createRunOncePlugin,
  withPodfile,
  withXcodeProject,
} = require('@expo/config-plugins');
const {
  mergeContents,
} = require('@expo/config-plugins/build/utils/generateCode');

const pluginName = 'with-ios-build-settings';
const pluginVersion = '1.0.0';
const generatedTag = 'wakemate-pod-build-settings';
const appProductType = 'com.apple.product-type.application';
const firstPartyPodPrefix = 'Wakemate';
const nullabilityFlags = '-Xcc -Wno-nullability-completeness';

const POD_BUILD_SETTINGS = `    minimum_ios_version = Gem::Version.new(
      podfile_properties['ios.deploymentTarget'] || '15.1'
    )

    installer.pods_project.targets.each do |pod_target|
      pod_target.build_configurations.each do |build_configuration|
        settings = build_configuration.build_settings
        declared_version = settings['IPHONEOS_DEPLOYMENT_TARGET']

        if declared_version &&
           Gem::Version.correct?(declared_version) &&
           Gem::Version.new(declared_version) < minimum_ios_version
          settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_ios_version.to_s
        end

        wakemate_owned = pod_target.name.start_with?('${firstPartyPodPrefix}')
        if wakemate_owned
          swift_flags = settings['OTHER_SWIFT_FLAGS'] || '$(inherited)'
          swift_flags = swift_flags.join(' ') if swift_flags.is_a?(Array)
          unless swift_flags.include?('-Wno-nullability-completeness')
            settings['OTHER_SWIFT_FLAGS'] =
              "#{swift_flags} -Xcc -Wno-nullability-completeness"
          end
          next
        end

        settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = 'YES'
        settings['SWIFT_SUPPRESS_WARNINGS'] = 'YES'
        libtool_flags = settings['OTHER_LIBTOOLFLAGS'] || '$(inherited)'
        libtool_flags = libtool_flags.join(' ') if libtool_flags.is_a?(Array)
        unless libtool_flags.include?('-no_warning_for_no_symbols')
          settings['OTHER_LIBTOOLFLAGS'] =
            "#{libtool_flags} -no_warning_for_no_symbols"
        end
      end
    end`;

const normalize = (value) => String(value ?? '').replaceAll('"', '');

const appendNullabilityFlags = (value) => {
  const current = normalize(value) || '$(inherited)';
  return current.includes(nullabilityFlags)
    ? value
    : `"${current} ${nullabilityFlags}"`;
};

/**
 * Keeps Xcode output useful: warnings remain enabled for WakeMATE code, while
 * warnings originating in dependency targets and dependency headers are
 * suppressed. Obsolete Pod deployment targets are raised to the app minimum.
 */
const withIosBuildSettings = (config) => {
  config = withPodfile(config, (configWithPodfile) => {
    const result = mergeContents({
      src: configWithPodfile.modResults.contents,
      newSrc: POD_BUILD_SETTINGS,
      tag: generatedTag,
      anchor: /^\s*:ccache_enabled => ccache_enabled\?\(podfile_properties\),\s*$/,
      offset: 2,
      comment: '    #',
    });

    configWithPodfile.modResults.contents = result.contents;
    return configWithPodfile;
  });

  return withXcodeProject(config, (configWithProject) => {
    const project = configWithProject.modResults;
    const objects = project.hash.project.objects;
    const appTarget = Object.entries(objects.PBXNativeTarget ?? {}).find(
      ([key, target]) =>
        !key.endsWith('_comment') &&
        target &&
        normalize(target.productType) === appProductType
    )?.[1];

    if (!appTarget) {
      throw new Error('withIosBuildSettings: could not find the app target');
    }

    const configurationList =
      (objects.XCConfigurationList ?? {})[appTarget.buildConfigurationList];
    if (!configurationList?.buildConfigurations?.length) {
      throw new Error('withIosBuildSettings: app target has no build configurations');
    }

    for (const entry of configurationList.buildConfigurations) {
      const buildConfiguration =
        (objects.XCBuildConfiguration ?? {})[entry.value];
      if (!buildConfiguration?.buildSettings) {
        throw new Error(
          `withIosBuildSettings: missing build settings for ${entry.comment ?? entry.value}`
        );
      }

      buildConfiguration.buildSettings.OTHER_SWIFT_FLAGS =
        appendNullabilityFlags(
          buildConfiguration.buildSettings.OTHER_SWIFT_FLAGS
        );
    }

    return configWithProject;
  });
};

module.exports = createRunOncePlugin(
  withIosBuildSettings,
  pluginName,
  pluginVersion
);
