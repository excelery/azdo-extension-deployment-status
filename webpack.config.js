const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");

// One entry per contribution. The manifests' `uri` fields assume the
// dist/<Entry>/<Entry>.{js,html} convention produced by output.filename plus
// the CopyWebpackPlugin pattern below -- change one and you must change both.
module.exports = (env, argv) => ({
  target: "web",
  output: {
    filename: "[name]/[name].js",
    publicPath: "/dist/",
  },
  entry: {
    DeploymentsGroup: "./src/WorkItemGroup/DeploymentsGroup.tsx",
    PipelineSettings: "./src/PipelineSettings/PipelineSettings.tsx",
    PipelineSettingsPanel: "./src/PipelineSettings/PipelineSettingsPanel.tsx",
  },
  // Inline maps in dev for stepping in devtools; a separate .map in production
  // so the shipped .vsix isn't bloated with embedded source.
  devtool: argv.mode === "production" ? "source-map" : "inline-source-map",
  devServer: {
    server: { type: "https" },
    port: 3000,
    devMiddleware: { writeToDisk: true },
    static: { directory: __dirname, watch: false },
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
    modules: [path.resolve("./src"), "node_modules"],
    alias: {
      // Without this (and the matching `overrides` in package.json) you end up
      // with two copies of the SDK and SDK.init() never resolves.
      "azure-devops-extension-sdk": path.resolve("node_modules/azure-devops-extension-sdk"),
    },
  },
  stats: { warnings: true, errorDetails: true },
  module: {
    rules: [
      { test: /\.tsx?$/, use: "ts-loader" },
      {
        test: /\.scss$/,
        use: [
          "style-loader",
          "css-loader",
          // Required for Azure DevOps light/dark theming.
          "azure-devops-ui/buildScripts/css-variables-loader",
          { loader: "sass-loader", options: { api: "modern", implementation: require("sass") } },
        ],
      },
      { test: /\.css$/, use: ["style-loader", "css-loader"] },
      { test: /\.(png|woff|woff2|eot|ttf|svg)$/, type: "asset/inline" },
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [{ from: "**/*.html", to: "[name]/[name].html", context: "src" }],
    }),
  ],
});
