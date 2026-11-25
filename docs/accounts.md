# Accounts

Several aliases at once, each signed in separately.

<!-- generated:accounts -->
Accounts are held by the **mcp** mechanism: the vendor's MCP server holds them.

The profile has no fields.
<!-- /generated:accounts -->

## Sign in

The mechanism is `mcp`: Wispr Flow's MCP server holds the credentials. OpenCode adds one server per alias, named
`wisprflow` for `default` and `wisprflow-work` / `wisprflow-personal` for the other aliases. Each server has its own
OAuth, so two aliases are two independent sessions. Sign in through OpenCode's MCP sign-in, once per alias.

The account profile has no fields: the alias names the server, and nothing else differs between accounts.

## Picking an account

Pass `account: "<alias>"` on `events_list` and `probe`. With one alias it may be left out. With two aliases and no
account, the call is refused with `ACCOUNT_REQUIRED`, whose next step lists the aliases. An alias the plugin does not
serve is `ACCOUNT_UNKNOWN`.

Cursors are bound to the account. A cursor issued for `work` and passed with `personal` is `CURSOR_INVALID`, never a
silent restart. The page's owner is OpenCode's sign-in for that alias's server, marked `verified: false`; a new sign-in
changes the owner id, and a cursor from the old sign-in is `ACCOUNT_MISMATCH`.

## The vendor's own tools

The 16 pass-through MCP tools take no `account`: their alias is the server that owns them. A rule or a grant for
`work` reaches `wisprflow-work_<tool>` only, never `wisprflow-personal_<tool>`.

## Status

`status` lists every alias in the order the options name them, with `ready`, `needs_sign_in` or `error`. A failure's
reason is one line of at most 160 characters, with query values, bearer credentials and token-shaped words replaced.
