# Configuration

Every option is optional. The smallest setup is one entry in `plugins`:

```json
{
  "plugins": ["@joe-broadhead/opencode-wisprflow"]
}
```

To set options, use the object form:

```json
{
  "plugins": [{ "package": "@joe-broadhead/opencode-wisprflow", "options": { "allowUntestedHost": true } }]
}
```

## Options

### `allowUntestedHost`

- Type: `true` or `false`.
- Default: `false`.

The plugin supports OpenCode `>=2.2.3 <2.3.0`, the range `opencode.host` in `package.json` declares, and every check
runs on 2.2.3, 2.2.4 and 2.2.5, the tested releases. Status shows the version, whether it is tested and the supported
range in its `OpenCode` row, for example `2.2.5 (tested; supported range >=2.2.3 <2.3.0)`.

- **A tested release:** the plugin starts.
- **Another release inside the range, such as 2.2.6:** the plugin starts too. Status marks the version `untested`, and
  the status RPC's `host.tested` is `false`. The next step is the same as on a tested release.
- **Outside the range, including 2.3.0, prereleases and development builds:** the plugin refuses to start, and
  `/plugins` shows:

  ```text
  HOST_UNTESTED: This plugin supports OpenCode >=2.2.3 <2.3.0, found 2.3.0. Next step: Use OpenCode >=2.2.3 <2.3.0, or set the plugin option "allowUntestedHost": true to run anyway.
  ```

- **Outside the range with `"allowUntestedHost": true`:** it starts anyway, and `/wisprflow-status` and `/wisprflow`
  show a warning.

Wispr Flow has one server, no read-only variant, no scope choice and no region, so there is nothing else to set.

## Your own `mcp.servers.wisprflow`

If your config defines no server named `wisprflow`, the plugin registers one:

```json
{ "type": "remote", "url": "https://api.wisprflow.ai/connect/mcp" }
```

It sets no `oauth` block: OpenCode registers its own OAuth client with Wispr Flow automatically and asks for the
scopes Wispr Flow's sign-in names. OpenCode's own defaults apply to everything else.

To change anything, for example a timeout, define `mcp.servers.wisprflow` yourself, at exactly
`https://api.wisprflow.ai/connect/mcp`. The plugin then **adopts** your entry unchanged, and `/wisprflow-status` shows
"Connection: connected (…, your own mcp.servers.wisprflow, used unchanged)". The permission rules and skills stay the
same.

```json
{
  "mcp": {
    "servers": {
      "wisprflow": {
        "type": "remote",
        "url": "https://api.wisprflow.ai/connect/mcp",
        "timeout": { "execution": 60000 }
      }
    }
  }
}
```

The plugin compares origin and path exactly, and ignores a query string. Any other URL, or a local command, is a
**conflict**: the plugin leaves the entry alone and adds no server, though its rules and skills still apply, status
shows "Connection: conflict", and gives the next step. A server at another origin is shown as its origin and `/…`,
because its path can hold a secret:

```text
- Next step: mcp.servers.wisprflow is set to https://wispr.example.com/…, but Wispr Flow's server is https://api.wisprflow.ai/connect/mcp. Point it there or remove it, then restart OpenCode.
```

The same address with a trailing slash is a conflict too, because Wispr Flow's sign-in does not start with it:

```text
- Next step: mcp.servers.wisprflow is set to https://api.wisprflow.ai/connect/mcp/; Wispr Flow's sign-in needs https://api.wisprflow.ai/connect/mcp, without the trailing slash. Change it or remove it, then restart OpenCode.
```

OpenCode keeps the sign-in under the server's name and address, so changing either needs a new sign-in.

## Permissions

OpenCode asserts every MCP call itself, with the action `wisprflow_<tool>` and the resource `*`. The plugin adds these
rules to every agent that starts with the base rule `{ "action": "*", "resource": "*", "effect": "allow" }`, directly
after that rule:

```json
[
  { "action": "wisprflow_*", "resource": "*", "effect": "ask" },
  { "action": "wisprflow_get_calendar_event", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_get_meeting", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_get_meeting_by_calendar_id", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_get_meeting_participants_enriched", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_get_scratchpad_note", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_get_upcoming_meeting", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_list_folder_meetings", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_list_folders", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_list_meeting_series", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_list_upcoming_meetings", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_resolve_calendar_link", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_resolve_share_link", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_search_calendar_events", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_search_meetings", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_search_scratchpad_notes", "resource": "*", "effect": "allow" },
  { "action": "wisprflow_get_participant_contacts", "resource": "*", "effect": "ask" }
]
```

`READ_TOOLS` in `src/wisprflow-tools.ts` lists the 15 read tools Wispr Flow lists for every account. `ASK_TOOLS` lists
`get_participant_contacts`, which Wispr Flow lists only for accounts with Wispr Contacts: it returns other people's job
titles, companies and LinkedIn profiles, so it asks, although it only reads. No Wispr Flow tool changes anything. A
tool Wispr Flow adds later matches only `wisprflow_*`, so it asks, and `/wisprflow-status` names it.

OpenCode uses the last rule that matches, so everything after the plugin's rules wins:

1. the agent's own rules, such as Explore's restrictions;
2. your top-level `permissions`, which OpenCode adds to every agent;
3. your saved "Always allow" answers, which beat an `ask` but never a configured `deny`.

A `deny` on resource `*` also hides the tool from the model. In an unattended run such as `opencode run`, a tool that
asks is refused. An agent without the base rule gets no Wispr Flow rules and keeps its own behaviour.

### Recipes

Put these in the top-level `permissions` of `opencode.json`. They apply to every agent. To limit a rule to one
agent, put it in that agent's own `permissions` instead.

Ask before opening any meeting or note. These are the tools whose results can hold a meeting's notes, Flow Summary or
transcript, or a note's text; a later rule wins over the plugin's allow:

```json
[
  { "action": "wisprflow_get_meeting", "resource": "*", "effect": "ask" },
  { "action": "wisprflow_get_meeting_by_calendar_id", "resource": "*", "effect": "ask" },
  { "action": "wisprflow_get_scratchpad_note", "resource": "*", "effect": "ask" },
  { "action": "wisprflow_list_folder_meetings", "resource": "*", "effect": "ask" },
  { "action": "wisprflow_resolve_share_link", "resource": "*", "effect": "ask" }
]
```

`list_folder_meetings` is there because other members' notes in a folder come with their summary. Searches and series
still run and show titles, times and attendees. Pre-reads, Wispr Flow's briefs for upcoming events drawn from earlier
meetings, come with `list_upcoming_meetings` and `get_upcoming_meeting`: add the same rule for
`wisprflow_list_upcoming_meetings` and `wisprflow_get_upcoming_meeting` to cover them too.

Keep Scratchpad out of reach (a `deny` also hides the matching tools):

```json
{ "action": "wisprflow_*_scratchpad_*", "resource": "*", "effect": "deny" }
```

### Agents that miss the rules

OpenCode creates agents that exist only in your config after plugins add their rules, so those agents get no
Wispr Flow rules; agents that a later plugin adds are in the same position. An agent counts as guarded when the whole
default block appears, in order, anywhere after its base allow. `/wisprflow-status` and `/wisprflow` list every other
agent that has a base allow and where a new Wispr Flow tool would run without asking, by name, followed by the default
rules to paste. The next step reads:

```text
Put the default rules shown by /wisprflow-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Wispr Flow tools.
```

Put the block first in that agent's own `permissions`, then repeat after it any top-level rules you have for
`wisprflow_*` tools, so yours keep winning. Never put the block in the top-level `permissions`: top-level rules come
after every agent's own rules, so it would loosen Explore. For an agent `reviewer`, with one top-level rule of your
own:

```json
{
  "permissions": [{ "action": "wisprflow_get_meeting", "resource": "*", "effect": "ask" }],
  "agents": {
    "reviewer": {
      "description": "Reviews changes",
      "mode": "subagent",
      "permissions": [
        { "action": "wisprflow_*", "resource": "*", "effect": "ask" },
        { "action": "wisprflow_get_calendar_event", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_get_meeting", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_get_meeting_by_calendar_id", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_get_meeting_participants_enriched", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_get_scratchpad_note", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_get_upcoming_meeting", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_list_folder_meetings", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_list_folders", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_list_meeting_series", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_list_upcoming_meetings", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_resolve_calendar_link", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_resolve_share_link", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_search_calendar_events", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_search_meetings", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_search_scratchpad_notes", "resource": "*", "effect": "allow" },
        { "action": "wisprflow_get_participant_contacts", "resource": "*", "effect": "ask" },
        { "action": "wisprflow_get_meeting", "resource": "*", "effect": "ask" }
      ]
    }
  }
}
```

`/wisprflow-status` shows the same block for the version you run.

## Errors

Every error from the plugin reads `CODE: What happened. Next step: What to do.`

| Code | When | Next step |
| --- | --- | --- |
| `OPTIONS_INVALID` | Setup: an option is unknown or has a wrong value. `/plugins` shows the message, which names the option and the accepted values. | Fix the plugin options in `opencode.json`. |
| `HOST_UNTESTED` | Setup: OpenCode is outside `>=2.2.3 <2.3.0`, and `allowUntestedHost` is not set. | Use OpenCode `>=2.2.3 <2.3.0`, or set `"allowUntestedHost": true`. |
| `STATUS_UNAVAILABLE` | `/wisprflow-status`, `/wisprflow` or the status RPC: the status could not be read, or the plugin is not running on the server. The RPC answers with its error `unavailable`. | The message's own next step: restart OpenCode and run the command again, or, when the plugin is not running, run `/plugins` to see why. |
| `SKILLS_INVALID` | Setup: a skill file is missing or broken. The plugin still starts; status shows the problem. | Reinstall the plugin. |
| `SERVER_NOT_REGISTERED` | Setup: the `wisprflow` server could not be registered. Status shows the problem. | Restart OpenCode. |
| `RULES_NOT_ADDED` | Setup: the default permission rules could not be added, so Wispr Flow tools may run without asking. Status shows the problem. | Restart OpenCode. |

For example:

```text
OPTIONS_INVALID: The option "allowUntestedHost" must be true or false (the default), found "yes". Next step: Fix the plugin options in opencode.json, for example "plugins": [{ "package": "@joe-broadhead/opencode-wisprflow", "options": { "allowUntestedHost": true } }].
```

Errors from Wispr Flow's server and from OpenCode pass through unchanged, except in the tools RPC for scripts, whose
codes are in [Scripting](scripting.md#errors). Wispr Flow's own refusals, such as "Cloud Sync must be enabled to use
this feature." or "Too many requests", are listed in the README's Troubleshooting.

## Status and RPC

`/wisprflow-status`, the `/wisprflow` dialog and the RPC method `status` (RPC ID `wisprflow.meetings`) share one
status model. It holds no token and no URL query, and reading it never calls Wispr Flow. `version`, `host`, `state`,
`unguardedAgents` and `nextStep` are the fields every plugin of this family shares, with the same names and meanings:

| Field | Content |
| --- | --- |
| `version` | The plugin's version |
| `state` | `connected`, `sign_in_required`, `connecting`, `disabled`, `failed`, `not_configured` or `conflict`. The `Connection` row shows the same states as `connected`, `sign-in required`, `connecting`, `disabled`, `failed`, `not configured` and `conflict`. |
| `error` | For a failed connection only: OpenCode's reason, on one line of at most 160 characters, with any URL cut before its query. The text for a needed sign-in can hold an authorization URL, so it is never shown. |
| `account` | The account label OpenCode's credential holds, if any |
| `source` | `type` (`plugin`, `adopted` or `conflict`), `url`, and for a conflict the `expected` URL |
| `tools` | How many Wispr Flow tools OpenCode lists. Connected with none means Wispr Flow turned its MCP off for this account. |
| `unknownCount`, `unknownTools` | How many of them the plugin does not know, and at most 20 of their names, only those made of lowercase letters, digits and `_` |
| `unguardedAgents` | Agents where a new Wispr Flow tool would run without asking; empty when there are none. An agent without a base allow, or whose own rules already ask or deny for every Wispr Flow tool, is not listed. |
| `shadowedSkills` | Skills OpenCode loads instead of the plugin's own because they use the same id, each with `name` (the plugin's skill) and `path` (the file that takes its place); empty when there are none |
| `host` | `version` (`null` if OpenCode reports none), `range` (the supported range) and `tested` (true only for 2.2.3, 2.2.4 and 2.2.5) |
| `problems` | Setup problems, each `CODE: What happened. Next step: What to do.` |
| `nextStep` | Exactly one next step: the `Next step` row, `Nothing to do.` when nothing is needed |

When the status cannot be read, the method answers with its error `unavailable`: the message
`STATUS_UNAVAILABLE: Could not read Wispr Flow's status (…).` and `data: { nextStep }`.
