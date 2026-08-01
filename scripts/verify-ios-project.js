const fs = require('node:fs');
const path = require('node:path');
const xcode = require('xcode');
const plist = require('@expo/plist').default;
const appConfig = require('../app.json');

const root = path.resolve(__dirname, '..');
const appName = appConfig.expo.name;
const appBundleIdentifier = appConfig.expo.ios.bundleIdentifier;
const appVersion = String(appConfig.expo.version);
const appBuildNumber = String(appConfig.expo.ios.buildNumber);
const projectFile = path.join(root, 'ios', `${appName}.xcodeproj`, 'project.pbxproj');
const podfile = path.join(root, 'ios', 'Podfile');
const podfilePropertiesFile = path.join(root, 'ios', 'Podfile.properties.json');
const podsProjectFile = path.join(
  root,
  'ios',
  'Pods',
  'Pods.xcodeproj',
  'project.pbxproj'
);
const firstPartyPodPrefix = 'Wakemate';
const nullabilityWarningFlag = '-Wno-nullability-completeness';

const REQUIRED_SETTINGS = {
  SUPPORTED_PLATFORMS: 'iphoneos iphonesimulator',
  SUPPORTS_MACCATALYST: 'NO',
  SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD: 'NO',
  SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD: 'NO',
};

const EXPECTED_TARGETS = [
  {
    label: 'app',
    bundleIdentifier: appBundleIdentifier,
    productType: 'com.apple.product-type.application',
  },
  {
    label: 'widget',
    bundleIdentifier: `${appBundleIdentifier}.widget`,
    productType: 'com.apple.product-type.app-extension',
  },
];

const fail = (message) => {
  throw new Error(`iOS project verification failed: ${message}`);
};

const normalize = (value) => {
  const text = String(value ?? '').trim();
  return text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
};

const compareVersions = (left, right) => {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
};

if (!fs.existsSync(projectFile)) {
  fail(`missing ${path.relative(root, projectFile)}; run an iOS prebuild first`);
}

const project = xcode.project(projectFile);
project.parseSync();

const objects = project.hash.project.objects;
const buildConfigurations = objects.XCBuildConfiguration ?? {};
const configurationLists = objects.XCConfigurationList ?? {};
const nativeTargets = objects.PBXNativeTarget ?? {};

const getConfigurations = (configurationListId, owner) => {
  const configurationList = configurationLists[configurationListId];
  if (!configurationList?.buildConfigurations?.length) {
    fail(`${owner} has no build configurations`);
  }

  return configurationList.buildConfigurations.map(({ value, comment }) => {
    const configuration = buildConfigurations[value];
    if (!configuration?.buildSettings) {
      fail(`${owner} ${comment ?? value} has no build settings`);
    }
    return configuration;
  });
};

const projectConfigurationListId =
  project.getFirstProject().firstProject.buildConfigurationList;
const projectConfigurations = getConfigurations(projectConfigurationListId, 'project');
const projectSettingsByName = new Map(
  projectConfigurations.map((configuration) => [
    normalize(configuration.name),
    configuration.buildSettings,
  ])
);

for (const expectedTarget of EXPECTED_TARGETS) {
  const target = Object.entries(nativeTargets)
    .filter(([key, value]) => !key.endsWith('_comment') && value)
    .map(([, value]) => value)
    .find((candidate) => {
      if (normalize(candidate.productType) !== expectedTarget.productType) {
        return false;
      }

      return getConfigurations(
        candidate.buildConfigurationList,
        `${expectedTarget.label} target`
      ).some(
        (configuration) =>
          normalize(configuration.buildSettings.PRODUCT_BUNDLE_IDENTIFIER) ===
          expectedTarget.bundleIdentifier
      );
    });

  if (!target) {
    fail(`missing ${expectedTarget.label} target (${expectedTarget.bundleIdentifier})`);
  }

  const targetConfigurations = getConfigurations(
    target.buildConfigurationList,
    `${expectedTarget.label} target`
  );
  const configurationNames = targetConfigurations
    .map((configuration) => normalize(configuration.name))
    .sort();

  if (configurationNames.join(',') !== 'Debug,Release') {
    fail(
      `${expectedTarget.label} target configurations are ${configurationNames.join(', ') || 'empty'}`
    );
  }

  for (const configuration of targetConfigurations) {
    const configurationName = normalize(configuration.name);
    const effectiveSettings = {
      ...(projectSettingsByName.get(configurationName) ?? {}),
      ...configuration.buildSettings,
    };

    for (const [setting, expectedValue] of Object.entries(REQUIRED_SETTINGS)) {
      const actualValue = normalize(effectiveSettings[setting]);
      if (actualValue !== expectedValue) {
        fail(
          `${expectedTarget.label} ${configurationName} has ${setting}=${actualValue || '<unset>'}; expected ${expectedValue}`
        );
      }
    }

    for (const [setting, expectedValue] of [
      ['MARKETING_VERSION', appVersion],
      ['CURRENT_PROJECT_VERSION', appBuildNumber],
    ]) {
      const actualValue = normalize(effectiveSettings[setting]);
      if (actualValue !== expectedValue) {
        fail(
          `${expectedTarget.label} ${configurationName} has ${setting}=${actualValue || '<unset>'}; expected ${expectedValue} from app.json`
        );
      }
    }

    if (
      expectedTarget.label === 'app' &&
      !normalize(configuration.buildSettings.OTHER_SWIFT_FLAGS).includes(
        nullabilityWarningFlag
      )
    ) {
      fail(
        `app ${configurationName} does not suppress dependency-header nullability warnings`
      );
    }
  }
}

const appInfoPlistFile = path.join(root, 'ios', appName, 'Info.plist');
const appInfoPlist = plist.parse(fs.readFileSync(appInfoPlistFile, 'utf8'));
if (String(appInfoPlist.CFBundleShortVersionString) !== appVersion) {
  fail(
    `app Info.plist version is ${appInfoPlist.CFBundleShortVersionString}; expected ${appVersion} from app.json`
  );
}
if (String(appInfoPlist.CFBundleVersion) !== appBuildNumber) {
  fail(
    `app Info.plist build is ${appInfoPlist.CFBundleVersion}; expected ${appBuildNumber} from app.json`
  );
}

const appDelegateFile = path.join(root, 'ios', appName, 'AppDelegate.swift');
const appDelegate = fs.readFileSync(appDelegateFile, 'utf8');
if (
  !appDelegate.includes('#if targetEnvironment(simulator)') ||
  !appDelegate.includes('Bundle.main.url(forResource: "main", withExtension: "jsbundle")')
) {
  fail('AppDelegate does not select the embedded bundle for physical-device Debug builds');
}

const bundlePhase = Object.entries(objects.PBXShellScriptBuildPhase ?? {})
  .filter(([key, value]) => !key.endsWith('_comment') && value)
  .map(([, value]) => value)
  .find(
    (phase) => normalize(phase.name) === 'Bundle React Native code and images'
  );

if (!bundlePhase?.shellScript) {
  fail('missing the React Native bundle build phase');
}

const bundleScript = JSON.parse(bundlePhase.shellScript);
for (const requiredSnippet of [
  '"$PLATFORM_NAME" == *simulator',
  'export SKIP_BUNDLING=1',
  'export CONFIGURATION="Release"',
  'export NODE_ENV="production"',
]) {
  if (!bundleScript.includes(requiredSnippet)) {
    fail(`React Native bundle build phase is missing: ${requiredSnippet}`);
  }
}

if (!fs.existsSync(podfile)) {
  fail('missing ios/Podfile; run an iOS prebuild first');
}

const podfileContents = fs.readFileSync(podfile, 'utf8');
for (const requiredSnippet of [
  '@generated begin wakemate-pod-build-settings',
  "settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = 'YES'",
  "settings['SWIFT_SUPPRESS_WARNINGS'] = 'YES'",
  '-no_warning_for_no_symbols',
  `pod_target.name.start_with?('${firstPartyPodPrefix}')`,
]) {
  if (!podfileContents.includes(requiredSnippet)) {
    fail(`Podfile is missing: ${requiredSnippet}`);
  }
}

if (fs.existsSync(podsProjectFile)) {
  const podfileProperties = fs.existsSync(podfilePropertiesFile)
    ? JSON.parse(fs.readFileSync(podfilePropertiesFile, 'utf8'))
    : {};
  const minimumIosVersion = podfileProperties['ios.deploymentTarget'] ?? '15.1';
  const podsProject = xcode.project(podsProjectFile);
  podsProject.parseSync();

  const podsObjects = podsProject.hash.project.objects;
  const podTargets = podsObjects.PBXNativeTarget ?? {};
  const podConfigurationLists = podsObjects.XCConfigurationList ?? {};
  const podBuildConfigurations = podsObjects.XCBuildConfiguration ?? {};
  let firstPartyConfigurations = 0;
  let thirdPartyConfigurations = 0;

  for (const [key, target] of Object.entries(podTargets)) {
    if (key.endsWith('_comment') || !target) {
      continue;
    }

    const targetName = normalize(target.name);
    const isFirstParty = targetName.startsWith(firstPartyPodPrefix);
    const configurationList = podConfigurationLists[target.buildConfigurationList];

    if (!configurationList?.buildConfigurations?.length) {
      fail(`Pod target ${targetName || key} has no build configurations`);
    }

    for (const entry of configurationList.buildConfigurations) {
      const configuration = podBuildConfigurations[entry.value];
      if (!configuration?.buildSettings) {
        fail(`Pod target ${targetName || key} has invalid build settings`);
      }

      const settings = configuration.buildSettings;
      const deploymentTarget = normalize(settings.IPHONEOS_DEPLOYMENT_TARGET);
      if (
        /^\d+(?:\.\d+)*$/.test(deploymentTarget) &&
        compareVersions(deploymentTarget, minimumIosVersion) < 0
      ) {
        fail(
          `Pod target ${targetName} uses iOS ${deploymentTarget}; expected at least ${minimumIosVersion}`
        );
      }

      if (isFirstParty) {
        firstPartyConfigurations += 1;
        if (
          normalize(settings.GCC_WARN_INHIBIT_ALL_WARNINGS) === 'YES' ||
          normalize(settings.SWIFT_SUPPRESS_WARNINGS) === 'YES'
        ) {
          fail(`Pod target ${targetName} unexpectedly suppresses WakeMATE warnings`);
        }
        if (
          !normalize(settings.OTHER_SWIFT_FLAGS).includes(
            nullabilityWarningFlag
          )
        ) {
          fail(
            `Pod target ${targetName} does not suppress dependency-header nullability warnings`
          );
        }
      } else {
        thirdPartyConfigurations += 1;
        if (
          normalize(settings.GCC_WARN_INHIBIT_ALL_WARNINGS) !== 'YES' ||
          normalize(settings.SWIFT_SUPPRESS_WARNINGS) !== 'YES' ||
          !normalize(settings.OTHER_LIBTOOLFLAGS).includes(
            '-no_warning_for_no_symbols'
          )
        ) {
          fail(`third-party Pod target ${targetName} still emits compiler warnings`);
        }
      }
    }
  }

  if (firstPartyConfigurations === 0 || thirdPartyConfigurations === 0) {
    fail('Pods project does not contain the expected first- and third-party targets');
  }
}

console.log(
  'Verified iOS-only targets, release metadata, device Debug bundling, and native warning settings.'
);
