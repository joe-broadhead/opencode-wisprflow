# Security

## Supported versions

Fixes go into the newest release. Older releases are not patched.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub private vulnerability reporting: open the repository's **Security**
tab and choose **Report a vulnerability**. Do not open a public issue. Include the plugin version, the OpenCode
version, your plugin options and the steps to reproduce. Never include tokens or Wispr Flow content.

Vulnerabilities in Wispr Flow's service or in OpenCode itself are out of scope. Report those to Wispr Flow or to the
OpenCode project.

## Data handling

- The plugin stores nothing and runs no network requests of its own. It registers Wispr Flow's MCP server with
  OpenCode, and OpenCode connects, signs in and stores the credentials. Meeting, note and calendar content flows from
  Wispr Flow to the model through OpenCode's MCP client. The tools RPC for scripts (see [Scripts](#scripts)) runs
  Wispr Flow's tools through OpenCode's own connection, too.
- The plugin never reads tokens. Status shows only the account label OpenCode's credential holds, if any, and server
  URLs without their query strings. It never shows OpenCode's text for a needed sign-in, which can hold an
  authorization URL, and cuts a connection failure's reason to one line with no URL query. Reading status never calls
  Wispr Flow.
- The sign-in covers every meeting, note and calendar event the account can see, past ones included; Wispr Flow has no
  per-meeting or time-range control.
- Wispr Flow content is untrusted. Transcripts, notes, summaries and calendar text hold other people's words and can
  contain instructions aimed at the model. The skills tell the model to treat it as data, to keep secrets read out in
  a meeting out of its answers, and to show attendees' details only when asked about them.
- Tool results go to your model provider, like any other tool result in the session.
- On Wispr Flow's enterprise plans, note and transcript reads through MCP are recorded in Wispr Flow's audit logs.
- Maintainer drift check: `scripts/check-wisprflow-tools.mjs` reads a saved tool list from a file and compares the
  names with the plugin's. It reads no credential, calls no server and stores nothing.

## Permissions

What the model can do in Wispr Flow is limited by three layers, in this order:

1. **Wispr Flow's server.** Every tool it offers only reads, and it applies the account's and the organisation's own
   settings, such as Cloud Sync, HIPAA and an admin's MCP or Scratchpad switch. If you define
   `mcp.servers.wisprflow` yourself, the plugin adopts it only at exactly `https://api.wisprflow.ai/connect/mcp`.
2. **Default permission rules.** Every Wispr Flow tool asks before it runs, except the 15 read tools listed in
   `src/wisprflow-tools.ts`, which run without a prompt. `get_participant_contacts`, which Wispr Flow lists only for
   accounts with Wispr Contacts, asks too, because it returns other people's profiles. A tool Wispr Flow adds later
   asks.
3. **Your OpenCode permissions.** Your `permissions` rules and saved "Always allow" answers override the default
   rules. A `deny` you configure always wins.

Things to know:

- **Saved approvals are broad.** "Always allow" on a Wispr Flow tool saves the pattern `*` for that tool's action. It
  applies to every agent in the OpenCode project, Plan included, until you remove it. OpenCode identifies a project by
  its git repository. A folder outside any git repository with a commit may belong to OpenCode's shared `global`
  project, so an approval saved there may apply in other such folders too.
- **Some agents get no default rules.** Agents defined only in your own config, and agents added by plugins that load
  after this one, are created after the plugin inserts its rules, and agents without a base allow get none. Wispr
  Flow tools may run there without asking. `/wisprflow-status` names these agents and gives the fix: put the default
  rules it shows first in that agent's own `permissions`, followed by your top-level rules for Wispr Flow tools. Do
  not put them in the top-level `permissions`, which would loosen Explore.
- **Unattended runs refuse prompts.** In `opencode run`, a Wispr Flow tool that would ask is refused.
- **The `wisprflow_*` rule also matches other servers** whose names start with `wisprflow_`. For their tools it only
  adds prompts.

## Scripts

The tools RPC (`wisprflow.meetings.tools`, see
[docs/scripting.md](https://github.com/joe-broadhead/opencode-wisprflow/blob/HEAD/docs/scripting.md)) runs Wispr
Flow's known read tools for a script, with no model. It adds no authority:

- A script names a session that names an agent, and runs as them. A tool that the agent's or the session's rules hide
  from the model is refused. OpenCode's own executor then checks the call against the agent's rules, the session's
  rules and saved approvals, as it does for the model.
- An ask on a script's call is denied, not prompted: no one is there to answer it. The plugin's permission hook
  changes only an ask on one of its own script calls in flight, only to a deny, and leaves every other call alone.
- Only the 15 known reads are methods. A tool that Wispr Flow adds later never is, even with an allow rule.
- The call goes through OpenCode's own MCP connection and sign-in. The plugin never sees the token, and returns none.
- Wispr Flow's error text reaches the script only as the first line, at most 300 characters, with tokens and URL
  query strings removed.
- OpenCode's `execute.before` and `execute.after` tool hooks, from any plugin, do not run for a script's call, so
  another plugin's policy hook does not see it. A script's calls are not recorded in the session.
- The RPC is reachable only by callers of the OpenCode server API, who already hold the server's full authority. The
  session is not a login: it scopes a script to what its agent may do.
