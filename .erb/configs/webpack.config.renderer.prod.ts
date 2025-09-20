/**
 * Build config for electron renderer process
 */
import { TanStackRouterWebpack } from '@tanstack/router-plugin/webpack'
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import path from 'path'
import TerserPlugin from 'terser-webpack-plugin'
import webpack from 'webpack'
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import { merge } from 'webpack-merge'
import JavaScriptObfuscator from 'webpack-obfuscator'
import checkNodeEnv from '../scripts/check-node-env.js'
import baseConfig from './webpack.config.base.ts'
import webpackPaths from './webpack.paths.ts'

checkNodeEnv('production')

const configuration: webpack.Configuration = {
  devtool: false,

  mode: 'production',

  target: ['web', 'electron-renderer'],

  entry: [path.join(webpackPaths.srcRendererPath, 'index.tsx')],

  output: {
    path: webpackPaths.distRendererPath,
    publicPath: process.env.CHATBOX_BUILD_PLATFORM === 'web' ? '/' : './',
    filename: 'assets/js/[name].[contenthash].js', // JS文件放在assets/js目录下
    library: {
      type: 'umd',
    },
  },

  module: {
    rules: [
      {
        test: /\.s?(a|c)ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              modules: true,
              sourceMap: true,
              importLoaders: 1,
            },
          },
          'sass-loader',
        ],
        include: /\.module\.s?(c|a)ss$/,
      },
      {
        test: /\.s?(a|c)ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          'sass-loader',
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                config: false,
                plugins: [
                  'tailwindcss/nesting',
                  'tailwindcss',
                  'autoprefixer',
                  'postcss-preset-mantine',
                  [
                    'postcss-simple-vars',
                    {
                      variables: {
                        'mantine-breakpoint-xs': '36em',
                        'mantine-breakpoint-sm': '48em',
                        'mantine-breakpoint-md': '62em',
                        'mantine-breakpoint-lg': '75em',
                        'mantine-breakpoint-xl': '88em',
                      },
                    },
                  ],
                ],
              },
            },
          },
        ],
        exclude: /\.module\.s?(c|a)ss$/,
        sideEffects: true,
      },
      // Fonts
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/fonts/[name].[hash][ext]', // 字体资源放在assets/fonts目录下
        },
      },
      // Images
      {
        test: /\.(png|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/images/[name].[hash][ext]', // 图片资源放在assets/images目录下
        },
      },
      // SVG
      {
        test: /\.svg$/,
        use: [
          {
            loader: '@svgr/webpack',
            options: {
              prettier: false,
              svgo: false,
              svgoConfig: {
                plugins: [{ removeViewBox: false }],
              },
              titleProp: true,
              ref: true,
            },
          },
          'file-loader',
        ],
      },
    ],
  },

  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin(), new CssMinimizerPlugin()],
  },

  plugins: [
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
      NODE_ENV: 'production',
      DEBUG_PROD: false,
    }),

    TanStackRouterWebpack({
      target: 'react',
      autoCodeSplitting: process.env.CHATBOX_BUILD_PLATFORM === 'web' ? true : false,
      routesDirectory: './src/renderer/routes',
      generatedRouteTree: './src/renderer/routeTree.gen.ts',
    }),

    new MiniCssExtractPlugin({
      filename: '[name].[contenthash].css', // CSS文件放在assets/css目录下 - 又不放了，因为这样会导致非web端的字体文件引用路径出错
    }),

    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE === 'true' ? 'server' : 'disabled',
      analyzerPort: 8889,
    }),

    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: path.join(
        webpackPaths.srcRendererPath,
        process.env.CHATBOX_BUILD_PLATFORM === 'web' ? 'index.web.ejs' : 'index.ejs'
      ),
      minify: {
        collapseWhitespace: true,
        removeAttributeQuotes: true,
        removeComments: true,
      },
      isBrowser: false,
      isDevelopment: false,
      favicon: path.join(webpackPaths.srcRendererPath, 'favicon.ico'),
    }),

    new webpack.DefinePlugin({
      'process.type': '"renderer"',
    }),   
  ],
}

export default merge(baseConfig, configuration)
