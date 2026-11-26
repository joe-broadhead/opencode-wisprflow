# Changelog

## 0.0.0 (2026-11-25)

- The first release on plugin-contract v0: `Plugin.define`, `assertHost` and one `register` call.
- Several Wispr Flow accounts at once through the `mcp` mechanism, one server per alias (`wisprflow`,
  `wisprflow-<alias>`), each with its own OAuth session. `probe` and `status` answer per alias; the owner is OpenCode's
  sign-in, marked `verified: false`.
- The `wisprflow.meetings` events source: Notetaker meetings, oldest first, with a cursor bound to the account, the
  two-hour settle, the 30-day plan window, cap splitting, gaps, the late-meeting look-back and secret refusal.
- The `wisprflow.meetings.list` snapshot: up to 50 recent meeting titles, newest first, never editable.
- All 16 Wispr Flow MCP tools declared as `mcp:` pass-through methods; `get_participant_contacts` and
  `get_meeting_participants_enriched` ask first because they return other people's contact data.
- No write, no action and no bus event.
- The two skills (`wisprflow`, `wisprflow-meeting-brief`) are read from `skills/<name>/SKILL.md` and registered with
  `ctx.skill.transform` at setup, because the contract's `register` does not register skills. A frontmatter name that is
  not the folder, a missing description or an empty body fails setup with `SCHEMA_VIOLATION` and a next step.
- Docs, skills and `AGENTS.md` generated from the manifest where the contract renders them; conformance fixtures for two
  accounts; Biome lint, a pack test and `plugin-kit check` in CI.

### Removed since v0.0.8

- The `/wisprflow-status` command. `tools.wisprflow.status` and `POST /api/rpc/wisprflow/status` replace it: a command is
  not a contract door, and the `status` method is reachable from every door.
- The `/wisprflow` TUI status dialog and the package's `./tui` export. The `status` method replaces it; the plugin
  standard keeps the TUI part optional, and this release ships the server entry only.
- The `wisprflow.meetings.tools` RPC and its `describe` method. The contract's one RPC id, `wisprflow`, carries `status`,
  `probe` and `events_list`, and the vendor's 16 tools are declared pass-through `mcp:` methods.
- The `wisprflow.meetings.status` RPC id. `status` is a method of the `wisprflow` RPC.
- The old status fields `tools`, `unknownCount`, `unknownTools`, `shadowedSkills`, `source` and `access`. `status` now
  answers the contract's §11 shape (`name`, `version`, `host`, `state`, `accounts`, `unguardedAgents`, `nextStep`), and
  `probe` reads an alias's owner.
- Adoption of a hand-written `mcp.servers.wisprflow` entry, and its conflict report. The contract's `accounts` module
  sets each alias's server from the manifest, so a hand-written server for the same alias is replaced; the alias is one
  server and one OAuth session, named by the plugin.
