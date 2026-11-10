// Wispr Flow's tool names, without the `wisprflow_` server prefix: the one place that classifies them. The default
// permission rules, the tools RPC's methods, status and the tests all derive from these lists, and package.json's
// `jelly.tools` must match them (test/unit/jelly.test.ts). Keep this file free of runtime imports:
// scripts/check-wisprflow-tools.mjs loads it with Node's type stripping to report upstream drift.
//
// The tools OpenCode 2.2.3 lists for Wispr Flow's server, 2026-11-05, and one it lists only for some accounts: every
// one reads, and none changes Wispr Flow.

/** Known reads. They run without a prompt, and they are the tools RPC's methods. */
export const READ_TOOLS: readonly string[] = [
  "get_calendar_event",
  "get_meeting",
  "get_meeting_by_calendar_id",
  "get_meeting_participants_enriched",
  "get_scratchpad_note",
  "get_upcoming_meeting",
  "list_folder_meetings",
  "list_folders",
  "list_meeting_series",
  "list_upcoming_meetings",
  "resolve_calendar_link",
  "resolve_share_link",
  "search_calendar_events",
  "search_meetings",
  "search_scratchpad_notes",
]

/**
 * Known tools that read personal data, kept in their own list so status, the docs and the tools RPC can name them. The
 * generated block allows them at `access: "all"` like every other tool, so they are not asked about by default; a
 * user's rule or `"ask-changes"` is what stops them. `get_participant_contacts` returns other people's job titles,
 * companies and LinkedIn profiles; Wispr Flow lists it only for accounts with Wispr Contacts
 * (get_meeting_participants_enriched's description names it).
 */
export const PERSONAL_TOOLS: readonly string[] = ["get_participant_contacts"]

/**
 * The plugin's own reads in the wisprflow namespace: events_list, Memory's source of meetings, which reads through
 * search_meetings. Allowed like the known reads, and a tools RPC method of its own; never one of Wispr Flow's tools.
 */
export const PLUGIN_READS: readonly string[] = ["events_list"]

/** Known writes: none today. A tool Wispr Flow adds later is unknown, and the default block's `wisprflow_*` rule decides it. */
export const WRITE_TOOLS: readonly string[] = []

type ToolClass = "read" | "personal" | "write" | "unknown"

export function classify(name: string): ToolClass {
  if (READ_TOOLS.includes(name)) return "read"
  if (PERSONAL_TOOLS.includes(name)) return "personal"
  if (WRITE_TOOLS.includes(name)) return "write"
  return "unknown"
}
