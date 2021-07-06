const path = require('path');
const AwsSamPlugin = require("aws-sam-webpack-plugin");

const awsSamPlugin = new AwsSamPlugin({vscodeDebug: false});

const common = {
  // Resolve .js extensions
  resolve: {
    extensions: [".js"]
  },

  // Target node
  target: "node",

  // Set the webpack mode
  mode: process.env.NODE_ENV || "production",

  // Add the TypeScript loader
  module: {
    rules: [
      { test: /\.jsx?$/, exclude: /node_modules/, loader: "babel-loader" }
    ]
  }
};

module.exports = [
  {
    entry: awsSamPlugin.entry(),

    // Write the output to the .aws-sam/build folder
    output: {
      filename: (chunkData) => awsSamPlugin.filename(chunkData),
      libraryTarget: "commonjs2",
      path: path.resolve(".")
    },

    // Add the AWS SAM Webpack plugin
    plugins: [awsSamPlugin],

    ...common
  }
];
