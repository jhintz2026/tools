const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

// Externalize all node_modules for main/preload (they run in Node.js, no need to bundle)
const nodeExternals = {};
const nodeModules = require('fs').readdirSync(path.resolve(__dirname, 'node_modules'))
  .filter(mod => mod !== '.package-lock.json')
  .forEach(mod => { nodeExternals[mod] = `commonjs ${mod}`; });

module.exports = [
  // Main process
  {
    mode: 'development',
    entry: './src/main/main.ts',
    target: 'electron-main',
    externals: nodeExternals,
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
    externals: nodeExternals,
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
