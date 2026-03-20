# CLAUDE.md

## Project Overview

DingTalk OpenClaw Connector — an OpenClaw channel plugin that bridges DingTalk (钉钉) messaging with the OpenClaw AI Gateway. Uses DingTalk Stream mode (WebSocket, no public IP needed), supports AI Card streaming responses, multi-account management, rich media handling, and proactive messaging.

**Package**: `@dingtalk-real-ai/dingtalk-connector` (npm, public)
**Runtime**: TypeScript loaded via `jiti` — no build step.

## Commands

```bash
npm install                  # Install dependencies
npm run type-check           # TypeScript type checking (npx tsc --noEmit)
npm test                     # Run unit tests (vitest)
npm run test:all             # Run all tests
npm run test:watch           # Watch mode
npm run test:coverage        # Coverage report (excludes integration tests)
openclaw plugins install -l . && openclaw gateway restart  # Local dev reload
npm run release:publish      # Publish to npm (--access public)
```

There is no build step. There is no lint step (stubs only). `npm run validate` runs type-check only.

## Architecture

### Module Layout (`src/`, ~10.5k LOC)

```
src/
├── channel.ts              # ChannelPlugin definition — the plugin's root contract with OpenClaw
├── runtime.ts              # Plugin runtime store (get/set singleton)
├── config/
│   ├── schema.ts           # Zod schemas: DingtalkConfigSchema, DingtalkAccountConfigSchema
│   └── accounts.ts         # Account resolution, listing, credential merging
├── core/
│   ├── provider.ts         # Entry point: monitorDingtalkProvider — starts account(s)
│   ├── connection.ts       # WebSocket connection lifecycle, heartbeat (10s), reconnect w/ exponential backoff
│   ├── message-handler.ts  # Business logic: message parsing → media download → OpenClaw dispatch → reply
│   └── state.ts            # Rate-limit and monitor state
├── services/
│   ├── messaging.ts        # Legacy messaging facade (sendMessage, sendProactive, sendToUser/Group)
│   ├── messaging/
│   │   ├── card.ts         # AI Card: create, stream update, finish
│   │   ├── send.ts         # Low-level DingTalk send APIs (text, media)
│   │   └── index.ts        # Re-exports
│   ├── media.ts            # Legacy media facade
│   └── media/
│       ├── common.ts       # Shared media utilities, marker patterns
│       ├── image.ts        # Image upload & markdown processing
│       ├── video.ts        # Video marker processing
│       ├── audio.ts        # Audio marker processing
│       ├── file.ts         # File marker processing
│       ├── chunk-upload.ts # Large file chunked upload
│       └── index.ts        # Re-exports
├── sdk/
│   ├── types.ts            # OpenClaw SDK type definitions (SecretInput, etc.)
│   └── helpers.ts          # Pure helpers: normalizeAccountId, DEFAULT_ACCOUNT_ID, status builders
├── utils/
│   ├── utils-legacy.ts     # Legacy utilities (accessToken, session context, dedup, API constants)
│   ├── token.ts            # Token management
│   ├── http-client.ts      # Axios-based DingTalk HTTP client
│   ├── logger.ts           # createLogger / createLoggerFromConfig
│   ├── session.ts          # Session context helpers
│   ├── agent.ts            # Agent workspace directory resolution
│   ├── async.ts            # Async utilities
│   ├── constants.ts        # Shared constants
│   └── index.ts            # Re-exports
├── types/
│   └── index.ts            # Core types: DingtalkConfig, DingtalkMessageContext, ResolvedDingtalkAccount
├── reply-dispatcher.ts     # Reply routing: AI Card streaming, slash commands (/new, /reset)
├── gateway-methods.ts      # RPC methods: sendToUser, sendToGroup, docs.*, probe
├── docs.ts                 # DingtalkDocsClient — document CRUD via DingTalk API
├── directory.ts            # User/group directory listing (live & cached)
├── policy.ts               # Group tool policy resolution
├── targets.ts              # Target normalization (user:id, group:id)
├── onboarding.ts           # Interactive setup wizard
├── probe.ts                # Health check / probe implementation
└── secret-input.ts         # SecretInput schema builder
```

### Key Architectural Patterns

1. **ChannelPlugin contract** (`src/channel.ts`): Implements OpenClaw's `ChannelPlugin<ResolvedDingtalkAccount>` interface — config, capabilities, outbound messaging, status, gateway lifecycle. This is the integration surface.

2. **Provider → Connection → MessageHandler pipeline**:
   - `provider.ts` resolves accounts, starts monitors
   - `connection.ts` manages WebSocket lifecycle per account (DWClient with custom heartbeat, `autoReconnect: false`)
   - `message-handler.ts` processes inbound messages: content extraction → media download → OpenClaw SDK dispatch → AI Card reply

3. **Multi-account**: Config supports `accounts` map with per-account overrides. Account resolution merges top-level defaults with account-specific config. `DEFAULT_ACCOUNT_ID = "__default__"`.

4. **AI Card streaming**: Create card instance → stream markdown chunks → finish. Falls back to plain text. Template ID: `02fcf2f4-5e02-4a85-b672-46d1f715543e.schema`.

5. **Media processing via markers**: AI responses contain markers that get post-processed:
   - Images: `![alt](local_path)` → upload → replace with media URL
   - Video: `[DINGTALK_VIDEO]{"path":"..."}[/DINGTALK_VIDEO]`
   - Audio: `[DINGTALK_AUDIO]{"path":"..."}[/DINGTALK_AUDIO]`
   - File: `[DINGTALK_FILE]{"path":"...","fileName":"...","fileType":"..."}[/DINGTALK_FILE]`

6. **Gateway methods** (RPC): `dingtalk-connector.sendToUser`, `.sendToGroup`, `.docs.*`, `.status`, `.probe` — registered via `OpenClawPluginApi`.

7. **Config validation**: Zod schemas with cross-field validation (e.g., `dmPolicy="allowlist"` requires non-empty `allowFrom`).

### Important Conventions

- **Imports use `.ts` extensions**: All relative imports include the `.ts` suffix (e.g., `import { foo } from "./bar.ts"`). This is required by the jiti runtime.
- **Legacy facades**: `src/services/messaging.ts` and `src/services/media.ts` are legacy monolith files. New code goes in `src/services/messaging/` and `src/services/media/` subdirectories. The `index.ts` files re-export from both.
- **Logger pattern**: Use `createLogger(debug, tag)` or `createLoggerFromConfig(config)`. Tag format: `'DingTalk:ModuleName'`.
- **Error handling**: DingTalk API calls use `dingtalkHttp` (Axios instance). Token functions (`getAccessToken`, `getOapiAccessToken`) handle auth. Errors propagate up; callers log context.
- **Chinese + English**: Comments and changelog use bilingual format. Code identifiers are English.

## Testing

- **Framework**: Vitest with `globals: true`, `environment: 'node'`, 30s timeout
- **Setup**: `tests/setup.ts` (global setup file)
- **Structure**: `tests/<feature>/<feature>.test.ts` — 41 test files across ~30 feature directories
- **Each test dir may have a `PLAN.md`** describing test strategy
- **Run specific test**: `npx vitest run tests/<feature>/<feature>.test.ts`
- **Default `npm test`** runs only `tests/gateway-methods.unit.test.ts`

## Configuration

Plugin config lives in `~/.openclaw/openclaw.json` under `channels.dingtalk-connector`:

```jsonc
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "dingXXX",
      "clientSecret": "secret",
      // Policies
      "dmPolicy": "open",           // "open" | "pairing" | "allowlist"
      "groupPolicy": "open",        // "open" | "allowlist" | "disabled"
      "requireMention": true,
      // Session
      "separateSessionByConversation": true,
      "groupSessionScope": "group",  // "group" | "group_sender"
      // Multi-account
      "accounts": {
        "bot-a": { "clientId": "...", "clientSecret": "...", "name": "Bot A" }
      }
    }
  }
}
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `openclaw` | OpenClaw SDK — plugin API, types, runtime |
| `dingtalk-stream` | DingTalk Stream protocol WebSocket client |
| `axios` | HTTP client for DingTalk REST APIs |
| `zod` | Config schema validation |
| `mammoth` | Word (.docx) document parsing |
| `pdf-parse` | PDF document parsing |
| `fluent-ffmpeg` + `@ffmpeg-installer/ffmpeg` | Video/audio metadata extraction |
| `pako` | Compression utilities |
| `form-data` | Multipart form data for file uploads |

## CI / GitHub Actions

- `pr-review.yml`: Notifies DingTalk group on PR events (opened, reviewed, approved)
- `issue-to-dingtalk.yml`: Forwards issues to DingTalk
- `issue-to-AI-table.yml`: Syncs issues to AI table
- `ai-fix-and-test.yml`: AI-assisted fix and test workflow

## Code Navigation Tips

- **Entry point**: `src/channel.ts` — follow `dingtalkPlugin` for the full plugin contract
- **Message flow**: `core/provider.ts` → `core/connection.ts` → `core/message-handler.ts` → `reply-dispatcher.ts`
- **Config flow**: `config/schema.ts` (Zod) → `config/accounts.ts` (resolution) → `channel.ts` (wired to OpenClaw)
- **Outbound messaging**: `channel.ts:outbound.sendText/sendMedia` → `services/messaging/send.ts`
- **AI Card**: `services/messaging/card.ts` — `createAICardForTarget()` → `streamAICard()` → `finishAICard()`
- **Gateway RPC**: `gateway-methods.ts` — all registered methods with JSDoc examples
