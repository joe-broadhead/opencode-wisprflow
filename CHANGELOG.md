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
- Docs, skills and `AGENTS.md` generated from the manifest where the contract renders them; conformance fixtures for two
  accounts; Biome lint, a pack test and `plugin-kit check` in CI.
