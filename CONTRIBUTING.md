# Contributing

Read [AGENTS.md](AGENTS.md) first: it lists the rules for this repository and the APIs that must never appear in it.
[docs/architecture.md](docs/architecture.md) explains how the plugin works.

## Set up

You need Node.js 22.18 or later, npm, and [Bun](https://bun.sh). CI and the release use Node.js 24 and Bun 1.4.4,
the Bun inside stock OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6.

```sh
npm ci --ignore-scripts
```

### Run your checkout in OpenCode

```sh
npm run build
```

Then list the folder in `plugins`, as an absolute path or a path relative to the config file that contains it, and
restart OpenCode. One entry loads both the server part and the terminal UI part. Run `npm run build` again after you
pull changes.

```json
{
  "plugins": ["/path/to/opencode-wisprflow"]
}
```

## Check

One command runs every check, in order, and stops at the first failure:

```sh
npm run check
```

| Stage | What it does |
| --- | --- |
| `typecheck` | `tsc --noEmit` over `src/` and `test/`, strict, with unused names as errors |
| `unit` | `bun test ./test/unit`: every module in `src/`, the docs' counts and error table, and the Jelly declaration |
| `build` | `node scripts/build.mjs`: deletes `dist/` and bundles `src/index.ts` and `src/tui.ts` with esbuild into the self-contained `dist/index.js` and `dist/tui.js`. Fails if a bundle imports anything the host does not provide |
| `host` | `bun test ./test/host`: the plugin inside an embedded OpenCode host, once on each tested release (`@opencode/sdk` 2.2.3, 2.2.4, 2.2.5 and 2.2.6) |
| `pack` | `bun test ./test/pack`: builds, packs and installs the package, imports both entry points, and loads it in stock OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6 |
| `forbidden` | `node scripts/check-forbidden.mjs`: scans `src/`, `test/`, `scripts/` and `dist/` for forbidden APIs and machine-local paths |
| `whitelist` | Checks `package.json` against the approved package shape, and that `dist/` holds exactly `index.js` and `tui.js` |

To run some stages only, name them; they run in the order given:

```sh
node scripts/check.mjs typecheck unit
```

Shortcuts: `npm run typecheck`, `npm run build`, `npm test` (the `unit` stage), `npm run test:host`,
`npm run test:pack` and `npm run lint` (the `forbidden` stage).

`TESTED_HOSTS` in `src/constants.ts` is the one list of tested OpenCode releases: 2.2.3, 2.2.4, 2.2.5 and 2.2.6. The host
and pack stages, status and CI all take their versions from it. Add a release there, and to the README's
requirements, when every check passes on it.

The host stage tests the plugin's behaviour inside each tested host's core, with this repository's own
`@opencode/plugin` 2.2.3; the pack stage tests the published package against the `@opencode/plugin` each stock
release provides. The host stage starts an embedded OpenCode host in a temporary home folder, with a local fake of Wispr Flow's MCP server,
once for each tested release. A request to any address other than the local machine fails the test. 2.2.3 is the
locked `@opencode/sdk`; the stage installs the others from npm, outside this repository's lockfile, into a temporary
folder that it deletes afterwards (about 370 MB each, from npm's cache after the first run). To run the host stage on
one other OpenCode 2.2.x only, install that SDK in a separate folder and point `HOST_SDK_DIR` at it:

```sh
mkdir ../sdk-2.2.99 && cd ../sdk-2.2.99 && npm init -y && npm install @opencode/sdk@2.2.99 --ignore-scripts && cd -
HOST_SDK_DIR=../sdk-2.2.99 node scripts/check.mjs host
```

Every temporary folder of the host and pack stages is a git repository under the system's `/tmp`, never under
`TMPDIR` or your home folder. OpenCode looks for `.opencode` folders and project config upwards from a project, and
stops at a repository's root, so it never picks up your own agents or skills. Each stock server listens on its own
free port.

The pack stage needs network access to the npm registry. It checks that the tarball contains exactly the `files`
whitelist, with fewer than 30 entries and at most 100 KB; that `dist/` holds only `index.js` and `tui.js`, with no
relative import, dynamic `import()` or `require()`; and that they import only modules OpenCode provides. It
installs the tarball next to the host packages that OpenCode 2.2.3 provides and imports both entry points under Bun.
Then it installs the tarball alone and loads it with `opencode serve` from stock OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6. Each server
runs offline, in its own temporary home, on its own port with a password. The stage checks that every path in
`opencode debug paths` is inside that home, that the plugin is active, that the `wisprflow` server and the default rules
are registered, that `/connect` lists the server as "Wispr Flow", and that the status RPC answers. It also reads each
stock release's terminal UI code to check that a dialog's close paths resolve the plugin's alert, which the `/wisprflow`
dialog's `r` key relies on. Against a local
fake Wispr Flow server, it also calls the known reads through the tools RPC.

To use `opencode` binaries you already have, set `OPENCODE_BIN_2_2_3`, `OPENCODE_BIN_2_2_4` and `OPENCODE_BIN_2_2_5`:

```sh
OPENCODE_BIN_2_2_3=/path/to/opencode-2.2.3 OPENCODE_BIN_2_2_4=/path/to/opencode-2.2.4 \
  OPENCODE_BIN_2_2_5=/path/to/opencode-2.2.5 node scripts/check.mjs pack
```

Otherwise the stage installs `@opencode/cli` with the binary for your platform (macOS or Linux, arm64 or x64), a few
hundred megabytes per version, once per run, into a temporary folder that it deletes afterwards.

CI (`.github/workflows/ci.yml`) runs `npm ci --ignore-scripts` and `npm run check` on Linux and macOS.

## Wispr Flow's tools

`src/wisprflow-tools.ts` lists the Wispr Flow tools the plugin knows: `READ_TOOLS` run without a prompt, `ASK_TOOLS`
read but ask (`get_participant_contacts`, which returns other people's profiles), and `WRITE_TOOLS`, empty today,
would ask. `test/unit/wisprflow-catalog.ts` records what OpenCode lists for a signed-in
`wisprflow` server: each tool's parameters, which are required, and whether its result can hold a transcript, notes or
a note's text. The tests check the skills' and docs' call examples, and the privacy recipe in
`docs/configuration.md`, against it. `jelly.tools` in `package.json` declares each tool. Wispr Flow can add, rename or remove
tools at any time, and an account lists only the tools its features allow.

The drift check is a manual maintainer check. It is not part of `npm run check` or CI, nothing at runtime depends on
it, and it never calls Wispr Flow or reads a credential. Save the tool list first, by either of these:

- in an OpenCode project signed in to Wispr Flow, a throwaway local plugin that writes `ctx.tool.list()`'s
  `wisprflow` tools (`name`, `description`, `inputSchema`) as `{ "tools": [...] }` to a file;
- an MCP client's `tools/list` result for `https://api.wisprflow.ai/connect/mcp`, saved as JSON.

Keep the file out of this repository. Then:

```sh
npm run drift -- <tools.json>
npm run drift -- <tools.json> --strict
```

- It needs Node.js 22.18 or later, which loads `src/wisprflow-tools.ts` by stripping its types. Keep that file free
  of runtime imports.
- It prints only tool and parameter names, grouped as added (listed, but in neither list), removed (in a list, but
  not in the file), parameters changed (a tool's input properties differ from the catalog), change wording (a known
  read's description now says it creates, changes or sends something), and, when the file has annotations,
  reclassified (the lists disagree with a tool's `readOnlyHint` or `destructiveHint`).
- What it can't see: OpenCode's tool list carries no annotations, so a tool that starts changing data shows only if
  its description says so, and a description that changes in other ways, such as what a result holds, is not
  compared. Read each new or changed description yourself.
- Exit codes: `0` for no drift, or drift without `--strict`; `1` for drift with `--strict`; `2` for a usage or file
  error.

### Updating the tool lists

1. Run the drift check.
2. For each name it reports, read the tool's description and schema, and check what it does.
3. Add a tool to `READ_TOOLS` only if it never changes anything in Wispr Flow and sends nothing to it unasked, because
   reads run without a prompt and each one is also a method of the tools RPC for scripts. Add tools that change
   anything to `WRITE_TOOLS`, and a read that returns other people's personal data to `ASK_TOOLS`. Give an ask or a
   write its `effect: "ask"` entry in `jelly.tools`. Leave a tool out if you are not sure: it then asks before every call, and scripts cannot
   call it.
4. Remove names that Wispr Flow no longer lists for any account.
5. Update `test/unit/wisprflow-catalog.ts` (parameters, required ones, and whether a result holds a body),
   `jelly.tools` in `package.json`, the skills' tool names and parameters,
   and the counts and method list in `README.md`, `SECURITY.md`, `docs/configuration.md`, `docs/scripting.md` and
   `docs/jelly.md`. Run `npm run check`: the tool-list test fails if the lists differ from the catalog, the Jelly test
   if a declared tool or effect differs from the lists and the default rules, the docs test on a stale count or
   method list, the skills test if a skill names a tool the plugin doesn't know, and the examples test if a call
   example uses a tool or parameter the catalog lacks.
6. Record the change in `CHANGELOG.md`. Moving a tool between the lists changes the default rules and the tools RPC's
   methods, which are part of the plugin's contract.

## Commits

Use `type(scope): summary`, for example `fix(status): explain a disabled server`. Keep commits small, and keep
`npm run check` green.

## Releases

### Versioning

The version follows semantic versioning on the plugin's contract: its options, the `/wisprflow-status` command, the
`/wisprflow` dialog, the skill names, the server name `wisprflow` and its URL, the status RPC method, the tools RPC's
methods and the default rule behaviour. While the major version is 0, a breaking change raises the minor version, and anything else the patch
version.

Each release supports one tested OpenCode line, stated as `opencode.host` in `package.json` and enforced by the host
check (`SUPPORTED_HOST` in `src/constants.ts`). Both must change together, with the README's requirements. Each
`CHANGELOG.md` entry follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

### Releasing

1. Update `version` in `package.json` and add the `CHANGELOG.md` entry, then run `npm run check`.
2. Push the release commit to `master` and tag it `v<version>`. The release workflow refuses a
   private package or a tag that differs from `version`.
3. Approve the run in the GitHub environment `release`.

CI then runs `npm run check`, packs the tree, runs the pack test against that exact tarball
(`PACK_TARBALL=<tarball> node scripts/check.mjs pack`), and publishes it with npm trusted publishing and provenance:
`npm publish <tarball> --provenance --access public`. The trusted publisher on npmjs.com names this repository, the
workflow `release.yml` and the environment `release`, and allows `npm publish`. A rerun skips a version that is
already on npm.

### Dist-tags

- `latest`: the newest stable release. The release workflow sets it for versions without a prerelease part.
- `next`: prereleases, such as `<version>-rc.1`. The release workflow sets it.
- `host-2.2`: the newest release for OpenCode 2.2.x. Move it by hand, so users on 2.2 can still install a matching
  version after `latest` moves to a newer OpenCode line:

  ```sh
  npm dist-tag add @joe-broadhead/opencode-wisprflow@<version> host-2.2
  ```

Never unpublish a release. Deprecate it instead, and name the version to use:

```sh
npm deprecate @joe-broadhead/opencode-wisprflow@<version> "<reason>. Use <version> instead."
```
