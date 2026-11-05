// What OpenCode lists for Wispr Flow's server, https://api.wisprflow.ai/connect/mcp: `ctx.tool.list()` on OpenCode
// 2.2.3, signed in to a Wispr Flow account, on 2026-11-05. Only names and facts from the tools' own descriptions and
// input schemas are recorded here, and no credential of the test or its author is used. OpenCode's tool list carries no
// annotations, so whether a tool reads comes from its description: every one reads, and none changes anything.
// No runtime imports: scripts/check-wisprflow-tools.mjs loads this file with Node's type stripping to compare a saved
// tool list with it. Refresh it, and src/wisprflow-tools.ts, when Wispr Flow changes its tools (CONTRIBUTING,
// "Wispr Flow's tools").

export interface LiveTool {
  /** The input schema's property names. */
  readonly params: readonly string[]
  /** The ones the schema requires. */
  readonly required: readonly string[]
  /**
   * The tool's result can hold a meeting's notes, Flow Summary or transcript, or a note's text, per its description.
   * Titles, times, attendees and calendar details don't count.
   */
  readonly body: boolean
  /** The result can hold a pre-read: Wispr Flow's brief for an upcoming event, drawn from earlier meetings. */
  readonly preread?: true
  /**
   * Wispr Flow lists the tool only for some accounts, and the recorded list doesn't have it: its facts come from another
   * tool's description, and the drift check doesn't count it as removed.
   */
  readonly conditional?: true
}

const LIST = ["limit", "cursor"]

export const LIVE: Readonly<Record<string, LiveTool>> = {
  get_calendar_event: { params: ["calendar_id"], required: ["calendar_id"], body: false },
  get_meeting: { params: ["meeting_id", "view_content", "view_transcript"], required: ["meeting_id"], body: true },
  get_meeting_by_calendar_id: { params: ["calendar_id", "view_content", "view_transcript"], required: ["calendar_id"], body: true },
  get_meeting_participants_enriched: { params: ["meeting_id"], required: ["meeting_id"], body: false },
  // Listed only with Wispr Contacts; get_meeting_participants_enriched's description says it takes contact_ids.
  get_participant_contacts: { params: ["contact_ids"], required: ["contact_ids"], body: false, conditional: true },
  get_scratchpad_note: { params: ["note_id", "view_content"], required: ["note_id"], body: true },
  get_upcoming_meeting: { params: ["calendar_id", "include_preread"], required: ["calendar_id"], body: false, preread: true },
  // Other members' notes in the folder carry their summary.
  list_folder_meetings: { params: ["folder_id", ...LIST], required: ["folder_id"], body: true },
  list_folders: { params: [], required: [], body: false },
  // Each occurrence is shaped like a search result; get_meeting reads the notes.
  list_meeting_series: { params: ["meeting_id", ...LIST], required: ["meeting_id"], body: false },
  list_upcoming_meetings: { params: ["window_hours", ...LIST], required: [], body: false, preread: true },
  resolve_calendar_link: { params: ["url"], required: ["url"], body: false },
  resolve_share_link: { params: ["url", "view_transcript"], required: ["url"], body: true },
  search_calendar_events: { params: ["query", "attendee_emails", "attendee_match", "since", "until", ...LIST], required: [], body: false },
  search_meetings: { params: ["query", "field", "attendee_emails", "attendee_match", "contact_ids", "since", "until", ...LIST], required: [], body: false },
  search_scratchpad_notes: { params: ["query", "field", "since", "until", ...LIST], required: [], body: false },
}

/** The keys of `view_content` and `view_transcript`. */
export const VIEW_KEYS: readonly string[] = ["start_char", "char_limit"]

/** Result fields the tools' descriptions name, which the skills teach. Their output schemas are empty. */
export const RESULT_FIELDS: readonly string[] = [
  "content",
  "count",
  "folders",
  "has_more",
  "has_transcript",
  "is_mine",
  "more",
  "next_cursor",
  "note",
  "owner",
  "preread",
  "reason",
  "recorded",
  "recurring",
  "share_link",
  "shared",
  "summary",
  "transcript",
  "transcript_access",
  "truncated",
]

/** The tools the recorded list holds: every known tool, apart from those listed only for some accounts. */
export const LIVE_TOOLS: readonly string[] = Object.keys(LIVE).filter((name) => !LIVE[name]!.conditional)
