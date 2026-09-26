/**
 * Bundled entry for openclaw-fork compatibility.
 *
 * Standard openclaw loads the plugin via `index.ts` (export default register).
 * openclaw-fork expects `defineBundledChannelEntry` format.
 *
 * Usage in package.json exports:
 *   "./bundled" → this file
 */

import { defineBundledChannelEntry, loadBundledEntryExportSync } from "openclaw/plugin-sdk/channel-entry-contract";

// .mjs 在源码模式由 SDK 回退到 .mts，编译包中则加载同目录的真实 .mjs。
const sidecar = './bundled-channel.mjs';

export default defineBundledChannelEntry({
  id: "dingtalk-connector",
  name: "DingTalk",
  description:
    "DingTalk (钉钉) channel connector — Stream mode with AI Card streaming",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: sidecar,
    exportName: "dingtalkPlugin",
  },
  runtime: {
    specifier: sidecar,
    exportName: "setDingtalkRuntime",
  },
  registerFull(api) {
    const register = loadBundledEntryExportSync<(loadedApi: typeof api) => void>(import.meta.url, {
      specifier: sidecar, exportName: 'registerDingtalkFull',
    });
    register(api);
  },
});
