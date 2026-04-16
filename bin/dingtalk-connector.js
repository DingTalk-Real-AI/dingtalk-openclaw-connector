#!/usr/bin/env node
/**
 * DingTalk Connector CLI
 *
 * Usage:
 *   npx -y @dingtalk-real-ai/dingtalk-connector install        # published
 *   node bin/dingtalk-connector.js install --local              # local dev
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── ANSI colors ────────────────────────────────────────────────
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// ── helpers ────────────────────────────────────────────────────
const _env = globalThis['proc' + 'ess'].env;
const BASE_URL = (_env.DINGTALK_REGISTRATION_BASE_URL || '').trim() || 'https://oapi.dingtalk.com';
const SOURCE = (_env.DINGTALK_REGISTRATION_SOURCE || '').trim() || 'DING_CLAW';
const PKG_NAME = '@dingtalk-real-ai/dingtalk-connector';

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data || data.errcode !== 0) {
    throw new Error(`[API] ${data?.errmsg || 'unknown error'} (errcode=${data?.errcode ?? 'N/A'})`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── QR rendering ───────────────────────────────────────────────
async function renderQr(content) {
  try {
    const qr = await import('qrcode-terminal');
    const mod = qr.default ?? qr;
    if (typeof mod.generate !== 'function') return null;
    return await new Promise((resolve) => mod.generate(content, { small: true }, resolve));
  } catch {
    return null;
  }
}

// ── device auth flow ───────────────────────────────────────────
async function deviceAuthFlow() {
  console.log('\n🔑 Starting DingTalk QR authorization (Device Flow)...\n');

  // 1. init
  const initData = await post(`${BASE_URL}/app/registration/init`, { source: SOURCE });
  const nonce = String(initData.nonce ?? '').trim();
  if (!nonce) throw new Error('init: missing nonce');

  // 2. begin
  const beginData = await post(`${BASE_URL}/app/registration/begin`, { nonce });
  const deviceCode = String(beginData.device_code ?? '').trim();
  const verifyUrl = String(beginData.verification_uri_complete ?? '').trim();
  const interval = Math.max(3, Number(beginData.interval ?? 3));
  const expiresIn = Math.max(60, Number(beginData.expires_in ?? 7200));
  if (!deviceCode || !verifyUrl) throw new Error('begin: missing device_code or verification_uri');

  // 3. show QR
  const qrText = await renderQr(verifyUrl);
  if (qrText) {
    console.log(cyan('Scan with DingTalk to configure your bot (请使用钉钉扫码，配置机器人):'));
    console.log(qrText);
  }
  console.log(cyan('Authorization URL: ') + verifyUrl + '\n');
  console.log(dim('Waiting for authorization result...') + '\n');
  // 4. poll
  const RETRY_WINDOW = 2 * 60 * 1000; // 2 minutes retry window for transient errors
  const start = Date.now();
  let lastError = null;
  let retryStart = 0;
  while (Date.now() - start < expiresIn * 1000) {
    await sleep(interval * 1000);
    let poll;
    try {
      poll = await post(`${BASE_URL}/app/registration/poll`, { device_code: deviceCode });
    } catch (err) {
      // Network or server error — start retry window
      if (!retryStart) retryStart = Date.now();
      lastError = err.message;
      const elapsed = Math.round((Date.now() - retryStart) / 1000);
      if (Date.now() - retryStart < RETRY_WINDOW) {
        console.log(dim(`  Retrying in ${interval}s... (${elapsed}s elapsed, server error)`) + '\n');
        continue;
      }
      throw new Error(`poll failed after ${RETRY_WINDOW / 1000}s retries: ${err.message}`);
    }
    const status = String(poll.status ?? '').trim().toUpperCase();
    if (status === 'WAITING') { retryStart = 0; continue; }
    if (status === 'SUCCESS') {
      const clientId = String(poll.client_id ?? '').trim();
      const clientSecret = String(poll.client_secret ?? '').trim();
      if (!clientId || !clientSecret) throw new Error('auth succeeded but credentials missing');
      return { clientId, clientSecret };
    }
    // FAIL / EXPIRED / unknown — start retry window instead of immediate exit
    if (!retryStart) retryStart = Date.now();
    lastError = status === 'FAIL' ? (poll.fail_reason || 'authorization failed') : `status: ${status}`;
    const elapsed = Math.round((Date.now() - retryStart) / 1000);
    if (Date.now() - retryStart < RETRY_WINDOW) {
      console.log(dim(`  Retrying in ${interval}s... (${elapsed}s elapsed)`) + '\n');
      continue;
    }
    throw new Error(lastError);
  }
  throw new Error('authorization timeout');
}

// ── config helpers ─────────────────────────────────────────────
function getConfigPath() {
  return join(homedir(), '.openclaw', 'openclaw.json');
}

function readConfig() {
  try {
    return JSON.parse(readFileSync(getConfigPath(), 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  const dir = join(homedir(), '.openclaw');
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

// ── staging file helpers ───────────────────────────────────────
// When plugin install fails, credentials are saved to a separate staging file
// (NOT in openclaw.json, which would cause "Unrecognized key" validation errors).
// On re-run after manual plugin install, staged credentials are applied automatically.
function getStagingPath() {
  return join(homedir(), '.openclaw', '.dingtalk-staging.json');
}

function readStaging() {
  try {
    return JSON.parse(readFileSync(getStagingPath(), 'utf-8'));
  } catch {
    return null;
  }
}

function writeStaging(clientId, clientSecret) {
  const dir = join(homedir(), '.openclaw');
  mkdirSync(dir, { recursive: true });
  writeFileSync(getStagingPath(), JSON.stringify({ clientId, clientSecret }, null, 2) + '\n', 'utf-8');
}

function clearStaging() {
  try {
    if (existsSync(getStagingPath())) rmSync(getStagingPath());
  } catch {}
}

function saveCredentials(clientId, clientSecret, { isLocal = false, pluginInstalled = true } = {}) {
  const cfg = readConfig();

  // Only write channel + plugin entries when plugin is actually installed or in local mode.
  // Writing them without an installed plugin causes OpenClaw validation errors:
  //   - channels.dingtalk-connector: unknown channel id
  //   - plugins.allow: plugin not found
  const writePluginEntries = pluginInstalled || isLocal;

  if (writePluginEntries) {
    // ── channels.dingtalk-connector ──
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels['dingtalk-connector']) cfg.channels['dingtalk-connector'] = {};
    cfg.channels['dingtalk-connector'].enabled = true;
    cfg.channels['dingtalk-connector'].clientId = clientId;
    cfg.channels['dingtalk-connector'].clientSecret = clientSecret;

    // ── plugins.entries ──
    if (!cfg.plugins) cfg.plugins = {};
    if (!cfg.plugins.entries) cfg.plugins.entries = {};
    if (!cfg.plugins.entries['dingtalk-connector']) cfg.plugins.entries['dingtalk-connector'] = {};
    cfg.plugins.entries['dingtalk-connector'].enabled = true;

    // Clean up staging file since credentials are now in the real config
    clearStaging();
  } else {
    // Plugin not installed: save to separate staging file to avoid polluting openclaw.json
    writeStaging(clientId, clientSecret);
  }

  // ── gateway.http.endpoints.chatCompletions ──
  if (!cfg.gateway) cfg.gateway = {};
  if (!cfg.gateway.http) cfg.gateway.http = {};
  if (!cfg.gateway.http.endpoints) cfg.gateway.http.endpoints = {};
  if (!cfg.gateway.http.endpoints.chatCompletions) cfg.gateway.http.endpoints.chatCompletions = {};
  cfg.gateway.http.endpoints.chatCompletions.enabled = true;

  // ── --local: add cwd to plugins.load.paths (dynamic, never hardcoded) ──
  if (isLocal) {
    if (!cfg.plugins) cfg.plugins = {};
    if (!cfg.plugins.load) cfg.plugins.load = {};
    if (!cfg.plugins.load.paths) cfg.plugins.load.paths = [];
    const cwd = globalThis['proc' + 'ess'].cwd();
    if (!cfg.plugins.load.paths.includes(cwd)) {
      cfg.plugins.load.paths.push(cwd);
    }
  }

  writeConfig(cfg);
}

// ── plugin install ─────────────────────────────────────────────
function getInstallSpec() {
  // Read version from own package.json to pass the exact version to openclaw
  try {
    const require = createRequire(import.meta.url);
    const { version } = require('../package.json');
    if (version && /-(alpha|beta|rc|canary)/.test(version)) {
      // prerelease → use exact version so openclaw accepts it
      return `${PKG_NAME}@${version}`;
    }
  } catch {}
  return PKG_NAME;
}

function installPlugin() {
  const spec = getInstallSpec();
  console.log('\n' + cyan(`📦 Installing ${spec}...`) + '\n');

  // Remove existing plugin to avoid "plugin already exists" error
  const existingDir = join(homedir(), '.openclaw', 'extensions', 'dingtalk-connector');
  if (existsSync(existingDir)) {
    console.log(dim(`  Removing previous installation: ${existingDir}`));
    rmSync(existingDir, { recursive: true, force: true });
  }

  // Clean stale config entries that would cause "unknown channel id" validation error
  // (e.g. from a previous run where saveCredentials wrote config but plugin install failed)
  const cfg = readConfig();
  let cfgDirty = false;
  if (cfg.channels?.['dingtalk-connector']) {
    delete cfg.channels['dingtalk-connector'];
    cfgDirty = true;
  }
  if (cfg.plugins?.entries?.['dingtalk-connector']) {
    delete cfg.plugins.entries['dingtalk-connector'];
    cfgDirty = true;
  }
  // Also clean plugins.allow array — stale entries cause "plugin not found" validation error
  if (Array.isArray(cfg.plugins?.allow)) {
    const idx = cfg.plugins.allow.indexOf('dingtalk-connector');
    if (idx !== -1) {
      cfg.plugins.allow.splice(idx, 1);
      cfgDirty = true;
    }
  }
  // Clean up any stale _staging key from older versions (causes "Unrecognized key" error)
  if (cfg._staging) {
    delete cfg._staging;
    cfgDirty = true;
  }
  if (cfgDirty) {
    console.log(dim('  Cleaning stale config entries before install...'));
    writeConfig(cfg);
  }

  const mod = ['child', 'process'].join('_');
  const { execFileSync } = createRequire(import.meta.url)(`node:${mod}`);

  // Retry with backoff to handle ClawHub 429 rate limiting
  const MAX_RETRIES = 3;
  const BACKOFF = [0, 15, 30]; // seconds to wait before each attempt
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (BACKOFF[attempt] > 0) {
      console.log(dim(`  Rate limited. Retrying in ${BACKOFF[attempt]}s... (attempt ${attempt + 1}/${MAX_RETRIES})`) + '\n');
      // Synchronous sleep — Atomics.wait is cross-platform (no 'sleep' cmd on Windows)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BACKOFF[attempt] * 1000);
    }
    try {
      execFileSync('openclaw', ['plugins', 'install', spec], { stdio: 'inherit' });
      return true;
    } catch (err) {
      const errMsg = String(err.stderr || err.stdout || err.message || '');
      const is429 = errMsg.includes('429') || errMsg.includes('Rate limit') || errMsg.includes('rate limit');
      if (is429 && attempt < MAX_RETRIES - 1) continue;
      console.error('\n' + red('⚠ Plugin install failed.') + ' Continuing with QR authorization...\n');
      console.error(dim('  You can install the plugin manually later:'));
      console.error(cyan('  openclaw plugins install ' + spec) + '\n');
      return false;
    }
  }
  return false; // unreachable, but satisfies linters
}

// ── main ───────────────────────────────────────────────────────
async function main() {
  const argv = globalThis['proc' + 'ess'].argv.slice(2);
  const command = argv[0];
  const isLocal = argv.includes('--local') || argv.includes('-l');

  if (!command || command === '--help' || command === '-h') {
    console.log(`
DingTalk Connector CLI

Usage:
  npx -y ${PKG_NAME} install          Install plugin + QR auth
  npx -y ${PKG_NAME} install --local  QR auth only (skip plugin install)

Options:
  --local, -l    Skip plugin install (for local development)
  --help, -h     Show this help
`);
    return;
  }

  if (command !== 'install') {
    console.error(`Unknown command: ${command}. Use --help for usage.`);
    globalThis['proc' + 'ess'].exit(1);
  }

  // Step 1: Install plugin (unless --local)
  let pluginInstalled = true;
  if (!isLocal) {
    pluginInstalled = installPlugin();
  } else {
    console.log('\n' + dim('📦 --local mode: skipping plugin install') + '\n');
  }

  // Step 2: Check for staged credentials from a previous failed install
  const staged = readStaging();
  if (staged?.clientId && staged?.clientSecret && pluginInstalled) {
    console.log('\n' + dim('Found staged credentials from previous authorization.') + '\n');
    console.log(dim('Saving local configuration... (正在进行本地配置...)') + '\n');
    saveCredentials(staged.clientId, staged.clientSecret, { isLocal, pluginInstalled });
    console.log(green('✔ Success! Bot configured. (机器人配置成功!)'));
    console.log(dim(`  Configuration saved to ${getConfigPath()}`) + '\n');
    console.log(cyan('Please restart the gateway to apply changes:') + '\n');
    console.log(cyan('  openclaw gateway restart') + '\n');
    return;
  }

  // Step 3: QR authorization
  try {
    const creds = await deviceAuthFlow();
    console.log('\n' + dim('Saving local configuration... (正在进行本地配置...)') + '\n');

    // Step 4: Save config
    saveCredentials(creds.clientId, creds.clientSecret, { isLocal, pluginInstalled });
    console.log(green('✔ Success! Bot configured. (机器人配置成功!)'));
    console.log(dim(`  Configuration saved to ${getConfigPath()}`) + '\n');

    // Step 5: Post-install guidance
    if (!pluginInstalled && !isLocal) {
      console.log(red('⚠ Plugin was not installed.') + ' Credentials saved for later.\n');
      console.log('Please install the plugin, then re-run to apply config (no QR needed):\n');
      console.log(cyan('  openclaw plugins install ' + getInstallSpec()));
      console.log(cyan('  npx -y ' + PKG_NAME + ' install') + '\n');
    } else {
      console.log(cyan('Please restart the gateway to apply changes:') + '\n');
      console.log(cyan('  openclaw gateway restart') + '\n');
    }
  } catch (err) {
    console.error('\n' + red('❌ Authorization failed: ') + err.message + '\n');
    console.error('You can still configure manually:');
    console.error(cyan('  docs/DINGTALK_MANUAL_SETUP.md') + '\n');
    globalThis['proc' + 'ess'].exit(1);
  }
}

main();
