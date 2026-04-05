/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => {
  const appGroups =
    config.ios?.entitlements?.['com.apple.security.application-groups'] ??
    [`group.${config.ios?.bundleIdentifier}`];

  return {
    type: 'widget',
    name: 'WakeMateWidgets',
    displayName: 'WakeMATE',
    bundleIdentifier: '.widget',
    deploymentTarget: '18.0',
    icon: '../../assets/images/icon.png',
    colors: {
      $accent: '#3ad27a',
      $widgetBackground: '#11131b',
    },
    entitlements: {
      'com.apple.security.application-groups': appGroups,
    },
  };
};
