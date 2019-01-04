const webpack = require('jetpack/webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const devMode = true;
const productionMode = !devMode;

module.exports = {
  port: 2209,
  head: '',
  webpack: (config, options) => {
    // unshift to run before other loaders, since
    // we're overriding the preconfigured svg loader
    config.module.rules[0].oneOf.unshift({
      test: /\.less$/,
      use: [
        { loader: devMode ? 'style-loader' : MiniCssExtractPlugin.loader },
        { loader: 'css-loader',       // Treat url() in css as an import
          options: { sourceMap: devMode }},
        { loader: 'less-loader',      // Compile less to CSS
          options: { sourceMap: devMode }},
      ]
    });

    config.plugins.push(new webpack.DefinePlugin({'PRODUCTION': productionMode}));

    return config;
  }
};
