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
 * Known tools that read but ask before they run. They are tools RPC methods like the reads, and a script is refused
 * them until an allow rule exists, because no one can answer the prompt. `get_participant_contacts` returns other
 * people's job titles, companies and LinkedIn profiles; Wispr Flow lists it only for accounts with Wispr Contacts
 * (get_meeting_participants_enriched's description names it).
 */
export const ASK_TOOLS: readonly string[] = ["get_participant_contacts"]

/** Known writes: none today. They would ask before they run. A tool Wispr Flow adds later is unknown, and asks too. */
export const WRITE_TOOLS: readonly string[] = []

type ToolClass = "read" | "ask" | "write" | "unknown"

export function classify(name: string): ToolClass {
  if (READ_TOOLS.includes(name)) return "read"
  if (ASK_TOOLS.includes(name)) return "ask"
  if (WRITE_TOOLS.includes(name)) return "write"
  return "unknown"
}
