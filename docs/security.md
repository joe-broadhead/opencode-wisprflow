# Security

## What leaves the machine

The plugin talks to Wispr Flow only through the vendor's MCP server that OpenCode registered for an alias. It sends the
inputs a read needs: a `since`/`until` window, a page cursor, a result limit and, for the pass-through tools, whatever
the person or agent asks for. It reads meetings, transcripts, summaries, Scratchpad notes, folders and calendar events
from the account that signed in. Nothing is sent anywhere else.

## Credentials

Wispr Flow's MCP server holds the credentials. OpenCode adds one MCP server per alias and keys OAuth per server, so the
plugin never sees a token, a refresh token or a password. The plugin stores no credential and prints none. `status` and
every page show the sign-in's stable credential id as the owner id, never the credential itself.

## Scopes

The plugin requests no OpenCode scope of its own. Wispr Flow's OAuth scopes are the provider's. `probe` reports the owner
and reads no content; it does not claim a scope the plugin has not checked.

## Accounts and isolation

Each alias is a separate MCP server and a separate OAuth session. The permission resources and the vendor tool actions
are per alias (`work:search_meetings`, `wisprflow-work_search_meetings`), so a rule or a grant for one alias cannot reach
another alias's tools. Cursors are bound to the account; a foreign cursor is refused rather than restarted.

## Untrusted data

Every answer is marked `trust: "untrusted"`. A meeting's title and summary are data: the plugin never follows them, never
puts them in `status`, and never uses them to choose a tool or a recipient. Every event passes the contract's
`screenEvents`, which refuses a meeting whose title or summary holds a secret (`refused[]`, reason `secret`). A refused
meeting is never delivered.

## Redaction

`status` and every failure reason go through the contract's `redactReason`: query values, bearer credentials, JWTs and
token-shaped words are replaced, and the line is cut to 160 characters. Status and logs never carry a URL query string, a
token or a credential. A page's `url` is the meeting's share link as the provider gave it; the plugin adds no token to
it.

## Confirmation

The plugin has no write, so it has nothing to confirm. Its only two `ask` methods are reads that return other people's
contact data (`get_participant_contacts`, `get_meeting_participants_enriched`); they ask at every access level, because
their `ask` effect narrows a read and no level turns a read into a deny. A future write follows the contract: a planning
read and a separate commit, an `actions` entry, and either an OpenCode permission ask or a host-signed action grant
verified by the contract's `grant` module.

## Reporting

Report a vulnerability through GitHub's private vulnerability reporting on this repository. Do not open a public issue
with a credential, a token or a person's data in it.
