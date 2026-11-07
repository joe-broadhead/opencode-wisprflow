# Scripting

A script can call every tool this plugin knows with no model: a cron job, a shell script, or any program that can reach
the OpenCode server. It uses the tools RPC, `wisprflow.meetings.tools`, through `opencode api` or an OpenCode client.

| Class | Methods |
| --- | --- |
| read | the 15 read tools the default rules allow (`READ_TOOLS` in `src/wisprflow-tools.ts`): `get_calendar_event`, `get_meeting`, `get_meeting_by_calendar_id`, `get_meeting_participants_enriched`, `get_scratchpad_note`, `get_upcoming_meeting`, `list_folder_meetings`, `list_folders`, `list_meeting_series`, `list_upcoming_meetings`, `resolve_calendar_link`, `resolve_share_link`, `search_calendar_events`, `search_meetings` and `search_scratchpad_notes` |
| read, asks by default | `get_participant_contacts`: it returns other people's job titles, companies and LinkedIn profiles, so a script is refused it until an allow rule exists |
| `describe` | not a tool: lists the methods, their classes and permission actions, whether OpenCode lists each tool now, each tool's input as JSON Schema, and — with a session — that session's permission for each |

Every Wispr Flow tool only reads, so every method's class is `read`. The class is the worst thing a tool can do; it
never decides whether a call runs: the rules do.

Each method runs the tool with the same input: Wispr Flow's own tool, through OpenCode's own connection and sign-in.
The plugin never sees the OAuth token. A tool that Wispr Flow adds later is not a method until this plugin classifies
it, and `describe` lists it under `unclassified`. Results come back as Wispr Flow sends them: every time in them is
UTC.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with exactly the
access its model would have:

- The rule for the tool's permission name, such as `wisprflow_search_meetings`, on resource `*` is resolved **before**
  the tool runs, in OpenCode's own order: the agent's rules, then the session's, the last match winning.
- Only an `allow` runs. An `ask` is refused, because no one can answer a prompt for a script. A `deny` is refused.
  Neither makes a tool call or leaves a prompt waiting. The plugin's default rules allow the 15 reads and ask for
  `get_participant_contacts`, so that tool needs an allow rule. An agent defined only in your config gets no default
  rules; `/wisprflow-status` names it.
- OpenCode then checks the call itself, as it does for the model: the agent's rules, the session's rules, then saved
  approvals.

**A saved "Always allow" approval does not authorize an ad-hoc script.** It lives outside the agent's and the
session's rules, so the resolve refuses an `ask` even after a past approval. That is deliberate: a script's permission
must be reviewable in config. A script's grant is a rule in the agent's or the session's config, or a Jobs run session.
For a one-off that needs an approval-bound grant, use Jobs's `jobs_run_script`.

Create the session once, with the agent the script runs as, and keep its id. Never borrow a session found through
history or a list: the script would run as that session's agent, under its rules.

```sh
opencode api post /api/session -d '{"title":"meeting digest","agent":"build"}'
```

Session rules come after the agent's, so a session can narrow what its script may do. This one can search and read
meetings, and nothing else in Wispr Flow:

```sh
opencode api post /api/session -d '{"title":"meeting digest","agent":"build","permissions":[
  {"action":"wisprflow_*","resource":"*","effect":"deny"},
  {"action":"wisprflow_search_meetings","resource":"*","effect":"allow"},
  {"action":"wisprflow_get_meeting","resource":"*","effect":"allow"}
]}'
```

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed:

```sh
opencode api post /api/rpc/wisprflow.meetings.tools/search_meetings \
  -H "x-opencode-directory:$PWD" -d '{"input":{
  "sessionID":"ses_…",
  "input":{"query":"pricing","since":"2026-03-01T00:00:00Z","until":"2026-03-08T00:00:00Z"}
}}'
```

**Send the call to the location you mean.** Without the header the call goes to the OpenCode service's default
location, your home directory, and fails `rpc.unavailable` when the plugin is not loaded there. The HTTP equivalents
are the `location[directory]` query parameter and the same header. A project whose own config differs is reached this
way; the session may belong to another directory.

The tool's input is Wispr Flow's, and Wispr Flow defines its fields: `describe` shows each tool's schema as OpenCode
lists it now. Check it rather than guess a field name. For example, `get_meeting` takes `meeting_id` from a search
result, and returns a transcript range only when asked for one with `view_transcript`:

```sh
opencode api post /api/rpc/wisprflow.meetings.tools/get_meeting \
  -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…","input":{"meeting_id":"…","view_transcript":{}}}}'
```

```sh
opencode api post /api/rpc/wisprflow.meetings.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{}}'
```

`describe` takes nothing, or a session to resolve each method's permission for:

```sh
opencode api post /api/rpc/wisprflow.meetings.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…"}}'
```

A result is `{"output": {"output": <the tool's structured content, or its text when it has none>, "text": <the tool's
text>}}`, as plain JSON. Wispr Flow content in it is untrusted data: meeting notes, transcripts and calendar text are
other people's words too. Lists page with `has_more` and `next_cursor`; pass `next_cursor` back as `cursor`.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON to standard output.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist in this location. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The rules ask or deny. An `ask` is refused before dispatch: the message says the action would ask, and the next step says to add an allow rule. A `deny` names the denied action, such as `wisprflow_get_meeting`, and its next step says to remove or narrow that deny rule, add a later allow rule to the session, or use a session whose agent allows it. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `wisprflow` server at a URL other than the plugin's, a trailing slash included. `/wisprflow-status` names both. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `wisprflow` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/wisprflow-status` gives the details. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool, for example because Wispr Flow lists no tools for this account. |
| `UPSTREAM_ERROR` | Wispr Flow answered with an error, such as an invalid input, a meeting that does not exist, "Cloud Sync must be enabled" or "Too many requests". The message holds the first line of Wispr Flow's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as a tool Wispr Flow adds later,
`rpc.unavailable` when the plugin did not register the tools RPC or the call reached another location, and
`rpc.invalid_input` for a body that is not the envelope above, with one message per problem:

| Problem | Message |
| --- | --- |
| The envelope is not an object | `the envelope must be an object, such as {"sessionID":"<session>","input":<the tool's input>}` |
| A key other than `sessionID` and `input` | `"extra" is not allowed`, naming the key |
| `sessionID` missing, not a string, or empty | `"sessionID" must be a non-empty string` |
| `input` missing | `"input" is missing` |
| `input` not an object | `"input" must be an object` |
| `describe` given anything but `{}`, a session or nothing | `describe takes nothing, or {"sessionID":"<session>"}` |

## What scripts cannot do

- Call a tool that Wispr Flow adds later, even with an allow rule, until this plugin classifies it.
- Call `get_participant_contacts` without a prior allow rule: it asks by default, and an ask is refused.
- Change anything in Wispr Flow: none of its tools does.
- Rely on a past "Always allow": it does not authorize an ad-hoc script.
- Use a token: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from
any plugin, do not run for them. Wispr Flow's model path has no such hook either, so a script sees what a direct model
call would.
