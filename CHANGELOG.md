# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-11-06

### Fixed

- `/connect` now clears the "Sign in required" mark on the account after you sign in again.

## [0.0.0] - 2026-11-05

### Added

- Wispr Flow's official MCP server, registered under the name `wisprflow` at `https://api.wisprflow.ai/connect/mcp`.
  OpenCode signs in with its own MCP OAuth: run `/connect` and choose Wispr Flow. The `/connect` entry is named
  "Wispr Flow", and its account is marked "Sign in required" when the sign-in needs renewing.
- Your own `mcp.servers.wisprflow` at exactly that URL is adopted unchanged. Any other URL, the same one with a
  trailing slash included, is a conflict, which status reports with its fix.
- Default permission rules after each agent's base allow: every Wispr Flow tool asks, and the 15 read tools Wispr
  Flow lists for every account run without a prompt. `get_participant_contacts`, listed only for accounts with Wispr
  Contacts, asks, because it returns other people's profiles. A tool Wispr Flow adds later asks.
- `/wisprflow-status`, and the `/wisprflow` dialog ("Wispr Flow: Status" in the command palette): connection,
  account, access, skills, tools, agents without the default rules, the OpenCode check and one next step. Status
  names a skill of yours that takes the place of the plugin's own, and says when Wispr Flow lists no tools for the
  account. The status RPC `wisprflow.meetings` returns the same model.
- Two skills: `wisprflow`, for finding, reading and citing meetings, transcripts, Scratchpad notes and calendar events,
  and for saying what the connection can't read; and `wisprflow-meeting-brief`, for a sourced brief before a meeting
  or a recap of a period's meetings.
- The tools RPC `wisprflow.meetings.tools`: a script calls the 15 known reads with no model, as a session and its
  agent.
- The option `allowUntestedHost`. The plugin starts on OpenCode `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4 and 2.2.5.
- A `jelly` declaration for Jelly: the 16 known tools, `get_participant_contacts` as an ask, the skills, the sign-in, a
  summary and a neutral icon.
