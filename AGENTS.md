# Repository rules

This repository builds `@we-the-rebel-alliance/wisprflow-plugin`, an OpenCode plugin that registers Wispr Flow's
official MCP server and adds default permission rules, a status command and view, two skills, and a tools RPC for
scripts. It adds no tool of its own. Read [docs/architecture.md](docs/architecture.md) before changing code and
[CONTRIBUTING.md](CONTRIBUTING.md) for the checks.

`v0.0.0` starts the repository's new org and history. It is being rebuilt on plugin-contract v0
([tracking issue](https://github.com/we-the-rebel-alliance/wisprflow-plugin/issues/25)); the contract work comes next.
Keep this repository greenfield: delete rather than deprecate, and add no compatibility path or app-specific doc.

## Rules

- **Public API only.** Use only the public `@opencode/plugin` 2.4.1 API. `opencode.host` in `package.json` and
  `SUPPORTED_HOST` in `src/constants.ts` both say exactly `>=2.4.1 <2.5.0`. `TESTED_HOSTS` is `["2.4.1"]`: status
  calls only that release tested, and the host, pack and CI checks run on it. Inside the range an untested release
  starts; the untested example in tests is `2.4.99` and the outside example is `2.5.0`.
- **No peers, no runtime dependencies, no lifecycle scripts.** `@opencode/plugin`, `@opencode/sdk` and
  `@opencode/client` are devDependencies pinned to exactly `2.4.1`. The bundle is self-contained.
- **Ship prebuilt, one file per entry.** `scripts/build.mjs` bundles `src/index.ts` and `src/tui.ts` with esbuild into
  the self-contained `dist/index.js` and `dist/tui.js`: no chunks, no relative imports, and only host-provided modules
  external. `tsc` only typechecks. No declaration files, `.tsx` or JSX.
- **The server URL** is `https://api.wisprflow.ai/connect/mcp`, exactly, in `ENDPOINT` in `src/constants.ts` and
  nowhere else in `src`: a trailing slash stops Wispr Flow's sign-in, the URL is part of the credential's key, and the
  pack test swaps its one occurrence in the bundle for a fake's. The server config sets no `oauth` block.
- **Default rules, not hooks.** Permissions come from rules inserted through `ctx.agent.transform` directly after each
  agent's base allow. A stricter agent is never weakened. Agents that miss the rules are named in status with the
  per-agent fix, never patched, and the fix never goes in the top-level `permissions`. No per-request hooks and no
  pinned tools.
- **Transforms are cheap, synchronous and never throw.** Record failures for status instead.
- **Errors** read `CODE: What happened. Next step: What to do.`, built by `wisprflowError` or `errorText`. Codes have no
  service prefix; shared failures use the shared names.
- **Status.** `src/status.ts` builds one model for `/wisprflow-status`, the `/wisprflow` dialog and the status RPC from
  OpenCode's own state: it never calls Wispr Flow. It cuts a failure's reason to one line of 160 characters without URL
  queries, and names at most 20 unknown tools, plain names only.
- **`src/wisprflow-tools.ts` is the one place that classifies Wispr Flow's tools.** It and `src/constants.ts` have no
  runtime imports: `scripts/check.mjs` loads them with Node's type stripping. The default rules, the tools RPC's
  methods, status and the tests derive from it.
- **Fixed context.** The Code Mode namespace line is at most 400 characters and each skill description at most 300.
  `test/unit/docs.test.ts` enforces both. Nothing outside the plugin names its tools.
- **`jelly` and `sources` stay for now.** `package.json`'s `jelly` and `sources` keys are read by the current apps and
  are replaced by the contract manifest; do not grow them. The source's owner is OpenCode's sign-in, marked
  `verified: false`, because Wispr Flow names no account.
- **Tests.** Unit tests use narrow `Pick<Plugin.Context, ...>` fakes. Host tests use the public `@opencode/sdk` with
  `PromiseSdk.create` and the temp root from `test/host/isolate.ts`. The embedded host does not start the automation
  scheduler, so the harness forks `Automation.run` itself; Code Mode with nobody present runs as an automation's code
  action. Never sign in to Wispr Flow or call its server from a check.
- **Text.** Model-facing text and docs describe what the code does now: no process narrative, test counts,
  machine-local paths, secrets or personal data. Fixtures use made-up names only.
- **One check command.** `npm run check` passes before every commit. Never skip, weaken or delete a test to get green.
