/**
 * Bundled entry for openclaw-fork compatibility.
 *
 * Standard openclaw loads the plugin via `index.ts` (export default register).
 * openclaw-fork expects `defineBundledChannelEntry` format.
 *
 * Usage in package.json exports:
 *   "./bundled" → this file
 */

import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "dingtalk-connector",
  name: "DingTalk",
  description:
    "DingTalk (钉钉) channel connector — Stream mode with AI Card streaming",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./index.ts",
    exportName: "dingtalkPlugin",
  },
  runtime: {
    specifier: "./index.ts",
    exportName: "setDingtalkRuntime",
  },
  async registerFull(api) {
    const { registerGatewayMethods } = await import("./src/gateway-methods.ts");
    registerGatewayMethods(api);
  },
});
