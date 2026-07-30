const fs = require('node:fs');
const path = require('node:path');
const {
  createRunOncePlugin,
  withDangerousMod,
} = require('@expo/config-plugins');

const pluginName = 'with-xcode-cloud-scripts';
const pluginVersion = '1.0.0';

const withXcodeCloudScripts = (config) =>
  withDangerousMod(config, [
    'ios',
    async (configWithScripts) => {
      const source = path.join(
        configWithScripts.modRequest.projectRoot,
        'templates',
        'ios',
        'ci_scripts',
        'ci_post_clone.sh'
      );
      const destination = path.join(
        configWithScripts.modRequest.platformProjectRoot,
        'ci_scripts',
        'ci_post_clone.sh'
      );

      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.copyFile(source, destination);
      await fs.promises.chmod(destination, 0o755);

      return configWithScripts;
    },
  ]);

module.exports = createRunOncePlugin(
  withXcodeCloudScripts,
  pluginName,
  pluginVersion
);
