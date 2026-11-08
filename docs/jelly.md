# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

Jelly names the plugin **Wispr Flow** (`jelly.title`), with the package name and version beneath. Under
that name it shows the one line in `jelly.summary`, and beside it the mark in `jelly.icon`
(`assets/icon.svg`, shipped in the package): Jelly reads that file once, when it records the
plugin, and keeps it only if it is a clean SVG of drawing elements, with no script, style, link
or outside reference.

Jelly's declaration schema drops a top-level key it does not know, rather than turning the
declaration down, so a Jelly that predates a key simply ignores it. The entries inside, such as
each tool and each sign-in, accept only their own fields.

## Tools and permissions

17 tools are declared (17 read-only): the 15 Wispr Flow lists for every account, `get_participant_contacts`,
which it lists only for accounts with Wispr Contacts, and the plugin's own `events_list`. Jelly's agents have
no base "allow everything" rule, so this plugin's own default rules, which it puts after that
rule, never reach them. Jelly writes each declared `ask` or `deny` as that tool's default instead
(the person's own choice replaces it), and denies a read-only helper every tool not marked
`readOnly`. A declared `allow` changes nothing in Jelly.

- Ask: `wisprflow_get_participant_contacts`. It only reads, but it returns other people's job titles, companies and
  LinkedIn profiles, so it asks, in Jelly as in OpenCode.
- Off: none.
- Everything else runs, as the plugin's own rules let it. That includes `wisprflow_events_list`, the plugin's own
  read for Memory's collector, which runs it unattended, so it never asks.

A tool the upstream server adds later is not declared, so in Jelly it is not asked about by
default. Keep `jelly.tools` in step with the known-tool list; `test/unit/jelly.test.ts` checks
each declared effect against the plugin's own default rules, and the list against the known tools.

## Skills

Declared: `wisprflow`, `wisprflow-meeting-brief`. Jelly does not install a plugin whose skill ids
collide with another plugin's or the agent's own.

## Views and scripts

None: `jelly.views` and `jelly.rpc` are empty, and the plugin adds no Home feed.

## Signing in

`jelly.signIns` declares one sign-in, `wisprflow`, for Wispr Flow's MCP server `wisprflow`, which signs in with OpenCode's MCP OAuth. When the server needs a new sign-in, the row says Sign in again.

Jelly folds the declared sign-ins into this plugin's one card, which shows each as Connected, Not signed in or Sign in again (expired or revoked), and starts, renews and signs out of each. An agent's `jelly_connection_request`, or a tool result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and servers are this plugin's.

## Versions

Jelly's curated catalogue pins an exact version. Each release is published under a new version, so a review in
Jelly can tell the two apart.

The declaration test runs the shared kit, `test/support/jelly-kit.ts`, which checks the declaration and this page against Jelly's plugin authors' standard. `scripts/check-copies.mjs` holds the kit, the shared part of the tools RPC (`src/host/tools-rpc.ts`) and the events_list source contract (`src/host/events-list.ts`) equal to the copies every plugin carries.
