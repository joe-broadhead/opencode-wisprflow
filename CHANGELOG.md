# Changelog

## 0.0.0 (unreleased)

- The plugin-contract v0 rebuild: `Plugin.define` and one `register` call, the `mcp` account mechanism with several
  aliases (`wisprflow`, `wisprflow-<alias>`), the meetings events source and its list snapshot, `probe` and `status`,
  and the 16 vendor MCP tools declared as `mcp:` pass-through methods.
- Two read effects ask: `get_participant_contacts` and `get_meeting_participants_enriched`, both for other people's
  contact data.
- No write, no action and no bus event. The owner is OpenCode's sign-in, marked `verified: false`.
