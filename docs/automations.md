# Automations

An events source is read on a timer with a cursor in the automation's state. The manifest's `cadence.suggestMinutes` is
the suggested interval; the provider's own floor, when it states one, is the minimum.

<!-- generated:automations -->
| Source | Method | Provider floor | Suggested | Signals |
|---|---|---|---|---|
| `wisprflow.meetings` | `tools.wisprflow.events_list` | — | 5 min | — |
<!-- /generated:automations -->

## The recipe

1. Read `tools.wisprflow.events_list` with the account and the cursor saved by the previous run.
2. Apply the page's events, then save the `cursor` it answers in the automation's state. Report any `refused` entries; the read moves past them.
3. Read again on the suggested cadence. `more: true` means another page is ready now, not that the source is done.

```ts
// The automation's state holds one cursor per account.
const page = await tools.wisprflow.events_list({
  source: "wisprflow",
  account: state.account, // the alias this automation reads
  cursor: state.cursor,
})
state.cursor = page.cursor
```

A cursor is bound to its plugin, source and account. Do not share one between accounts: the plugin refuses it with
`CURSOR_INVALID`.

A meeting is listed once it started two hours ago, when its notes are most likely done. The provider's free plan locks
meetings older than 30 days and no tool names the plan, so a read that starts more than 29 days ago answers a `gap` and
restarts at 29 days ago. Render the gap; never invent the missing meetings.
