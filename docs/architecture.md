# Architecture

## Layers

| Layer | Files | Does |
|---|---|---|
| Entry | `src/index.ts` | `Plugin.define({ id, setup })`, `assertHost`, the account wiring, the skills and one `register` call |
| Accounts | `src/accounts.ts` | one Wispr Flow MCP server per alias, through the contract's `accounts` module |
| Skills | `src/skills.ts` | reads `skills/<name>/SKILL.md`, checks the frontmatter and registers each one with `ctx.skill` |
| Manifest | `src/manifest.ts` | reads `package.json` `capabilities` and checks it with the contract's validator |
| Handlers | `src/handlers/` | one handler per method: the input, the answer schema, the description and the work |
| Provider client | `src/provider/client.ts` | the one vendor URL, the alias's server and tool, the sign-in, the error mapping |
| Meetings | `src/provider/meetings.ts` | the page, the cursor, the windows, the cap handling and the list snapshot |

The entry is deliberately thin. `register` from the contract wires doors 1–3: one agent tool per method in the
`wisprflow` namespace, the same tools in Code Mode, one RPC registration under `wisprflow`, the permission assertions on
`<alias>:<operation>`, and the access rules inserted into every agent. This repository never calls `ctx.tool`,
`ctx.rpc` or `ctx.permission` itself. Skills are the exception the contract does not cover: `src/skills.ts` adds them
through `ctx.skill.transform`, because OpenCode loads a plugin's skills only if the plugin registers them.

## The call path

1. OpenCode loads `dist/index.js` through the package's `./server` export and calls `setup(ctx)`.
2. `assertHost` refuses an OpenCode release outside `>=2.4.1 <2.5.0`, unless `allowUntestedHost` is set.
3. `src/accounts.ts` adds one MCP server per alias through `ctx.mcp.transform`, named `wisprflow` or
   `wisprflow-<alias>`. All aliases point at the same vendor URL; OpenCode keys OAuth by server name, so each alias is
   its own session.
4. `src/skills.ts` parses every `skills/<name>/SKILL.md` as YAML before the synchronous transform. Invalid YAML, a
   frontmatter name that is not the folder, a missing description or an empty body is `SCHEMA_VIOLATION` and stops
   setup; `registerSkills` adds the parsed skills through `ctx.skill.transform` after `register`.
5. `register` checks the handler table against `capabilities.methods`, resolves the accounts from the options, generates
   the access rules into every agent, and registers the tools and the single RPC id.
6. A call resolves the account, validates the input against the handler's schema, asserts the method's operations, runs
   the handler, checks the answer and maps a failure to the contract's error table.

## The provider

`src/provider/client.ts` is the only file that names the vendor. It says which server and which vendor tool belong to an
alias, reads the sign-in through the public host APIs (`ctx.mcp.list`, `ctx.integration.connection.active`), and maps a
host state to the contract's errors: `needs_auth` is `NEEDS_SIGN_IN`, a failed server or tool is `UNAVAILABLE` with a
redacted reason.

`events_list` reads through the host's own registered `search_meetings` tool, executed as the calling session and agent.
The host therefore asserts the vendor tool's own permission on every call, and a grant's fenced rules cover it.

`src/provider/meetings.ts` turns `search_meetings` answers into contract events and builds every answer with the
contract's own modules:

- `makeEvent` normalises an event and computes its hash;
- `encodeBoundCursor` / `decodeBoundCursor` bind a cursor to the plugin, source and account;
- `screenEvents` refuses a meeting whose title or summary holds a secret;
- `fitPage` keeps a page inside the source's 64 KB;
- `eventsListResult` builds the page and its `gap`, `refused` and `asOf` fields.

A read walks the window a week at a time, splits a capped window in two, and answers a `window-truncated` gap only for a
minute the provider still caps. It looks back behind the cursor for a meeting that reached the provider late, and the
cursor carries short tags of what it already accounted for there.

## OpenCode APIs

| API | Who calls it |
|---|---|
| `Plugin.define` | `src/index.ts` |
| `ctx.app.version` | `src/index.ts`, for the host gate and status |
| `ctx.mcp.transform` | `src/accounts.ts` |
| `ctx.skill.transform` | `src/skills.ts` |
| `ctx.mcp.list`, `ctx.integration.connection.active`, `ctx.tool.list` | the provider client, reads only |
| `ctx.agent.transform` | `register`'s access rules |
| `ctx.tool.transform`, `ctx.rpc.register`, `ctx.permission.assert` | `register` only |

## State and caching

The plugin keeps no content cache and no credential. The consumer owns the cursor and stores it; the plugin binds the
cursor to the account and refuses one that another account presents. `status` reads the host and the accounts on demand
and never calls the provider for content. The plugin declares no bus event, because it writes nothing and receives no
push.

## Bundle

`scripts/bundle.mjs` bundles `src/index.ts` into `dist/index.js` with esbuild. `@opencode/*` stays external, because
OpenCode provides it; the contract modules are bundled, so an install needs no build step. `dist/` is generated by
`npm run bundle` and committed; CI rebuilds it and fails when the committed copy is stale.
