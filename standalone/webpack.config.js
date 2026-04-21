/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './client.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/public'),
    filename: 'bundle.js',
    publicPath: '/',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    // Force resolution from standalone node_modules first
    modules: [path.resolve(__dirname, 'node_modules'), 'node_modules'],
    alias: {
      // Force react and react-dom to use standalone versions
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom'),
      // Map @opensearch/datemath to @elastic/datemath (OUI peer dependency)
      '@opensearch/datemath': path.resolve(__dirname, 'node_modules/@elastic/datemath'),
      // Map @elastic/eui to @opensearch-project/oui so shared components resolve correctly
      '@elastic/eui': path.resolve(__dirname, 'node_modules/@opensearch-project/oui'),
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'tsconfig.json'),
            transpileOnly: true, // Skip type checking during build
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.scss$/,
        use: ['style-loader', 'css-loader', 'sass-loader'],
      },
      {
        test: /\.svg$/,
        type: 'asset/source',
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
    }),
  ],
  devServer: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:5603',
    },
    historyApiFallback: true,
    client: {
      overlay: {
        runtimeErrors: (error) => {
          if (error.message === 'ResizeObserver loop completed with undelivered notifications.') {
            return false;
          }
          if (error.message === 'ResizeObserver loop limit exceeded') {
            return false;
          }
          return true;
        },
      },
    },
  },
};
