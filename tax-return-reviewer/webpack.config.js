const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = [
  // Main process
  {
    mode: 'development',
    entry: './src/main/main.ts',
    target: 'electron-main',
    module: {
      rules: [{
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      }],
    },
    resolve: { extensions: ['.ts', '.js'] },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'main.js',
    },
  },
  // Preload
  {
    mode: 'development',
    entry: './src/main/preload.ts',
    target: 'electron-preload',
    module: {
      rules: [{
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      }],
    },
    resolve: { extensions: ['.ts', '.js'] },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'preload.js',
    },
  },
  // Renderer process
  {
    mode: 'development',
    entry: './src/renderer/index.tsx',
    target: 'electron-renderer',
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'renderer.js',
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/renderer/index.html',
      }),
    ],
  },
];
