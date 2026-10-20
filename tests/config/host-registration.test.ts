import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { DingtalkConfigSchema } from '../../src/config/schema.ts';

type RegistrationResult = {
  plugins: Array<{ id: string; status: string; error?: string }>;
  tools: string[];
  hooks: string[];
  channels: string[];
  channelSchemas: boolean[];
  registrationMode: string;
  diagnostics: string[];
};

// 子进程隔离真实宿主的模块缓存和全局注册表；只加载插件，不启动 Gateway 或执行工具。
const registrationProbe = String.raw`
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const root = process.cwd();
const temporary = mkdtempSync(join(tmpdir(), 'dingtalk-host-registration-'));
process.env.OPENCLAW_STATE_DIR = join(temporary, 'state');
process.env.OPENCLAW_CONFIG_PATH = join(temporary, 'absent.json');
process.env.OPENCLAW_HOME = temporary;
delete process.env.OPENCLAW_PROFILE;
delete process.env.OPENCLAW_CONFIG;

try {
  // 采用安装宿主的 facade，避免依赖构建产物中的 hash 名称。生产代码不导入 loader 私有入口。
  const facade = resolve(dirname(require.resolve('openclaw/plugin-sdk/core')), '../plugins/loader.js');
  const { loadOpenClawPlugins } = await import(pathToFileURL(facade).href);
  const { createJiti } = createRequire(facade)('jiti');
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const { registerDingtalkConversationCapabilities } = jiti(resolve(root, 'src/register-capabilities.ts'));
  // 发布验证可在 build 后设置 DINGTALK_REGISTRATION_USE_BUILT=1，复用相同门禁检查真实产物。
  const bundledEntry = jiti(resolve(root, process.env.DINGTALK_REGISTRATION_USE_BUILT === '1'
    ? 'dist/entry-bundled.mjs' : 'entry-bundled.ts'));
  const manifest = JSON.parse(readFileSync(join(root, 'openclaw.plugin.json'), 'utf8'));
  const results = {};

  for (const scenario of [
    { name: 'without-contract', contracts: false, allowConversationAccess: true },
    { name: 'without-conversation-access', contracts: true },
    { name: 'with-conversation-access', contracts: true, allowConversationAccess: true },
    { name: 'with-access-denied', contracts: true, allowConversationAccess: false },
    { name: 'bundled-discovery', contracts: true, allowConversationAccess: true, bundled: true },
    { name: 'bundled-entry', contracts: true, allowConversationAccess: true, bundled: true, activate: true },
  ]) {
    const fixture = join(temporary, scenario.name);
    mkdirSync(fixture);
    const fixtureManifest = structuredClone(manifest);
    if (!scenario.contracts) delete fixtureManifest.contracts;
    writeFileSync(join(fixture, 'openclaw.plugin.json'), JSON.stringify(fixtureManifest));
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({
      name: 'dingtalk-registration-fixture', type: 'module', openclaw: { extensions: ['./index.mjs'] },
    }));
    // 桥接的是实际项目函数，api 由宿主真实 loader 创建；没有伪造 registerTool/on 门禁。
    let registrationMode;
    globalThis.__dingtalkRegistrationProbe = (api) => {
      registrationMode = api.registrationMode;
      if (scenario.bundled) bundledEntry.register(api);
      else registerDingtalkConversationCapabilities(api);
    };
    writeFileSync(join(fixture, 'index.mjs'),
      "export default { id: 'dingtalk-connector', configSchema: { type: 'object', properties: {}, additionalProperties: false }, register(api) { globalThis.__dingtalkRegistrationProbe(api); } };"
    );
    const entryConfig = { enabled: true };
    if (scenario.allowConversationAccess !== undefined) {
      entryConfig.hooks = { allowConversationAccess: scenario.allowConversationAccess };
    }
    const registry = loadOpenClawPlugins({
      config: { plugins: {
        enabled: true, allow: ['dingtalk-connector'], load: { paths: [fixture] },
        entries: { 'dingtalk-connector': entryConfig },
      } },
      workspaceDir: temporary,
      env: { ...process.env },
      installRecords: {},
      onlyPluginIds: ['dingtalk-connector'],
      // full 模式只激活此子进程 registry；loader 不启动 Gateway、channel 或 service。
      activate: scenario.activate === true,
      cache: false,
      allowProcessHomeSessionCatalogs: false,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });
    // 故意立即检查，确保 registerFull 没有把注册推迟到 loader 的同步注册阶段之后。
    results[scenario.name] = {
      plugins: registry.plugins.map(({ id, status, error }) => ({ id, status, error })),
      tools: registry.tools.flatMap(({ names }) => names),
      hooks: registry.typedHooks.map(({ hookName }) => hookName),
      channels: registry.channels.map(({ plugin }) => plugin.id),
      channelSchemas: registry.channels.map(({ plugin }) => Boolean(plugin.configSchema)),
      registrationMode,
      diagnostics: registry.diagnostics.map(({ message }) => message),
    };
  }
  process.stdout.write('DINGTALK_REGISTRATION_RESULT=' + JSON.stringify(results) + '\n');
} finally {
  delete globalThis.__dingtalkRegistrationProbe;
  rmSync(temporary, { recursive: true, force: true });
}
`;

describe('安装宿主真实注册门禁', () => {
  let results: Record<string, RegistrationResult>;

  beforeAll(() => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', registrationProbe], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      encoding: 'utf8',
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
    });
    const line = output.split('\n').find((value) => value.startsWith('DINGTALK_REGISTRATION_RESULT='));
    expect(line).toBeDefined();
    results = JSON.parse(line!.slice('DINGTALK_REGISTRATION_RESULT='.length));
  }, 50_000);

  it('缺少 tools contract 时，真实 helper 的表单工具注册被宿主拒绝', () => {
    expect(results['without-contract'].tools).toEqual([]);
    expect(results['without-contract'].diagnostics.join('\n')).toContain('contracts.tools');
  });

  it('manifest 声明允许真实 helper 注册工具，并在用户授权后注册用量 hook', () => {
    const result = results['with-conversation-access'];
    expect(result.plugins).toEqual([{ id: 'dingtalk-connector', status: 'loaded' }]);
    expect(result.tools).toEqual(['dingtalk_ask_user_question']);
    expect(result.hooks).toEqual(['llm_output']);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(['without-conversation-access', 'with-access-denied'])('%s 保留工具但拒绝会话 hook', (scenario) => {
    const result = results[scenario];
    expect(result.tools).toEqual(['dingtalk_ask_user_question']);
    expect(result.hooks).toEqual([]);
    expect(result.diagnostics.join('\n')).toContain('allowConversationAccess=true');
  });

  it('真实 SDK bundled 入口在同步注册返回前完成 channel/tool/hook 注册', () => {
    const result = results['bundled-entry'];
    expect(result.plugins).toEqual([{ id: 'dingtalk-connector', status: 'loaded' }]);
    expect(result.registrationMode).toBe('full');
    expect(result.channels).toEqual(['dingtalk-connector']);
    expect(result.channelSchemas).toEqual([true]);
    expect(result.tools).toEqual(['dingtalk_ask_user_question']);
    expect(result.hooks).toEqual(['llm_output']);
    expect(result.diagnostics).toEqual([]);
  });

  it('真实 bundled discovery 只注册 channel/schema，保留 SDK 的注册模式边界', () => {
    const result = results['bundled-discovery'];
    expect(result.plugins).toEqual([{ id: 'dingtalk-connector', status: 'loaded' }]);
    expect(result.registrationMode).toBe('discovery');
    expect(result.channels).toEqual(['dingtalk-connector']);
    expect(result.channelSchemas).toEqual([true]);
    expect(result.tools).toEqual([]);
    expect(result.hooks).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe('发布 manifest 与运行时配置边界', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../openclaw.plugin.json', import.meta.url), 'utf8'));
  const properties = manifest.channelConfigs['dingtalk-connector'].schema.properties;
  const hostRequire = createRequire(createRequire(import.meta.url).resolve('openclaw/plugin-sdk/core'));
  const Ajv = hostRequire('ajv');
  const validateManifest = new Ajv({ strict: false }).compile(manifest.channelConfigs['dingtalk-connector'].schema);

  it('顶层和 accounts 对六个新增配置使用相同 schema', () => {
    for (const key of ['cardTemplateMode', 'cardTemplateId', 'cardShowMetadata', 'questionCardTemplateId',
      'questionTimeoutMs', 'experimentalMultiAgent']) {
      expect(properties[key]).toEqual(properties.accounts.additionalProperties.properties[key]);
    }
  });

  it.each([
    { cardTemplateId: '   ' },
    { questionCardTemplateId: '\t ' },
    { experimentalMultiAgent: { aliases: { 研究: '  ' } } },
  ])('manifest 与 Zod 都拒绝纯空白值 %j', (config) => {
    for (const value of [config, { accounts: { work: config } }]) {
      expect(DingtalkConfigSchema.safeParse(value).success).toBe(false);
      expect(validateManifest(value)).toBe(false);
    }
  });
});
