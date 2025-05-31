const path = require('path');
const webpack = require('webpack');

module.exports = {
  target: 'node',
  mode: 'production',

  entry: './src/extension.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },

  devtool: 'source-map',

  externals: {
    vscode: 'commonjs vscode',
    level: 'commonjs level'
  },

  resolve: {
    extensions: ['.js'],
  },

  module: {
    rules: [],
  },

  plugins: [
    new webpack.BannerPlugin({
      banner: '"use strict";',
      raw: true,
      entryOnly: true,
    }),
  ],
};
