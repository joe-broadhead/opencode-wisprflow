# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | — |
| `events_list` | read | optional | `search_meetings` |
| `mcp:get_calendar_event` | read | none | `get_calendar_event` |
| `mcp:get_meeting` | read | none | `get_meeting` |
| `mcp:get_meeting_by_calendar_id` | read | none | `get_meeting_by_calendar_id` |
| `mcp:get_meeting_participants_enriched` | read | none | `get_meeting_participants_enriched` |
| `mcp:get_participant_contacts` | read | none | `get_participant_contacts` |
| `mcp:get_scratchpad_note` | read | none | `get_scratchpad_note` |
| `mcp:get_upcoming_meeting` | read | none | `get_upcoming_meeting` |
| `mcp:list_folder_meetings` | read | none | `list_folder_meetings` |
| `mcp:list_folders` | read | none | `list_folders` |
| `mcp:list_meeting_series` | read | none | `list_meeting_series` |
| `mcp:list_upcoming_meetings` | read | none | `list_upcoming_meetings` |
| `mcp:resolve_calendar_link` | read | none | `resolve_calendar_link` |
| `mcp:resolve_share_link` | read | none | `resolve_share_link` |
| `mcp:search_calendar_events` | read | none | `search_calendar_events` |
| `mcp:search_meetings` | read | none | `search_meetings` |
| `mcp:search_scratchpad_notes` | read | none | `search_scratchpad_notes` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `wisprflow.meetings` | events | `meeting` | `events_list` | free |
| `wisprflow.meetings.list` | snapshot | `list` | `events_list` | free |

### Actions

None.

### Bus events

None.
<!-- /generated:capabilities -->

## Notes

- **`status`** reads no account. It reports the plugin's version, the OpenCode host, one entry per alias with its
  sign-in state and owner, the agents whose rules no longer match the generated rules, and any next step.
- **`probe`** reads one account's owner and nothing else. It calls no provider tool; the owner is OpenCode's sign-in for
  the alias's MCP server, marked `verified: false`.
- **`events_list`** reads the `wisprflow.meetings` events source for one account, oldest first. A page names its owner,
  carries a cursor, and refuses a meeting whose title or summary holds a secret. A cursor is bound to the plugin, the
  source and the account; another account's cursor is `CURSOR_INVALID`, and another sign-in's is `ACCOUNT_MISMATCH`.
  With `list: "meetings"` the same method answers the `wisprflow.meetings.list` snapshot: up to 50 meeting titles from
  the window the free plan shows, newest first, never editable.
- **The 16 `mcp:` methods** are Wispr Flow's own MCP tools, passed through by the vendor's server. The plugin declares
  each one so its class and access rule are known before it runs, but it does not proxy them. Two are `ask`:
  `get_participant_contacts` and `get_meeting_participants_enriched`, because they return other people's email
  addresses, job titles, companies and contact ids.
- **The sources** are `wisprflow.meetings` (events: `meeting`, private, free, 64 KB per page) and
  `wisprflow.meetings.list` (snapshot: the `list` shape, private, free, 64 KB per answer). They share the `Meetings`
  service, a 5-minute suggested cadence and the `search_meetings` operation.
- **No actions and no bus events.** The plugin writes nothing and receives no webhook, so it has nothing to confirm and
  no honest `changed` nudge to send.
