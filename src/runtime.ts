import { createPluginRuntimeStore } from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk";

const { setRuntime: setDingtalkRuntime, getRuntime: getDingtalkRuntime } =
  createPluginRuntimeStore<PluginRuntime>("DingTalk runtime not initialized");

export { getDingtalkRuntime, setDingtalkRuntime };
