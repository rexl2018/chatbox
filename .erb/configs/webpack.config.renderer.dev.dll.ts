/**
 * Builds the DLL for development electron renderer process
 */

import webpack from 'webpack';
import path from 'path';
import { merge } from 'webpack-merge';
import baseConfig from './webpack.config.base.ts';
import webpackPaths from './webpack.paths.ts';
import fs from 'fs';
import { fileURLToPath } from 'url';
import checkNodeEnv from '../scripts/check-node-env.js';
import rendererConfig from './webpack.config.renderer.dev.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
const dependencies = packageJson.dependencies || {};

checkNodeEnv('development');

const EXCLUDE_MODULES = new Set([
  '@capacitor/android', // native platform package, not a JS runtime module
  '@capacitor/ios', // native platform package, not a JS runtime module
  '@modelcontextprotocol/sdk', // avoid `Package path . is not exported from package` error
  '@mastra/core',
  '@mastra/rag',
  '@libsql/client',
  'capacitor-stream-http', // local file dependency
]);

const dist = webpackPaths.dllPath;

const configuration: webpack.Configuration = {
  context: webpackPaths.rootPath,

  devtool: 'eval',

  mode: 'development',

  target: 'electron-renderer',

  externals: ['fsevents', 'crypto-browserify'],

  /**
   * Use `module` from `webpack.config.renderer.dev.js`
   */
  module: rendererConfig.module,

  entry: {
    renderer: Object.keys(dependencies || {}).filter(
      (dependency) => !EXCLUDE_MODULES.has(dependency)
    ),
  },

  output: {
    path: dist,
    filename: '[name].dev.dll.js',
    library: {
      name: 'renderer',
      type: 'var',
    },
  },

  plugins: [
    new webpack.DllPlugin({
      path: path.join(dist, '[name].json'),
      name: '[name]',
    }),

    /**
     * Create global constants which can be configured at compile time.
     *
     * Useful for allowing different behaviour between development builds and
     * release builds
     *
     * NODE_ENV should be production so that modules do not perform certain
     * development checks
     */
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development',
    }),

    new webpack.LoaderOptionsPlugin({
      debug: true,
      options: {
        context: webpackPaths.srcPath,
        output: {
          path: webpackPaths.dllPath,
        },
      },
    }),
  ],
};

export default merge(baseConfig, configuration);
