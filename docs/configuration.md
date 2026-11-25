# Configuration

The options and their defaults, generated from `capabilities.options`.

<!-- generated:configuration -->
| Option | Type | Default | Description |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `"all"` | How much the plugin's methods may do. |
| `accounts` | object | — | One profile per account alias. Each alias signs in to its own Wispr Flow MCP server. |
| `allowUntestedHost` | boolean | `false` | Start outside the tested OpenCode range. |
<!-- /generated:configuration -->

## Configure two accounts

```json
{
  "access": "ask-changes",
  "accounts": {
    "work": {},
    "personal": {}
  },
  "allowUntestedHost": false
}
```

- `access` is the ceiling. `all` runs every method, and the two contact-data tools ask first. `ask-changes` asks before
  those two as well. `read-only` runs every read and still asks before them: an `ask` effect narrows a read, and no level
  turns a read into a deny. Every other method runs at every level.
- `accounts` is one profile per alias. A profile has no fields today; the alias names the MCP server and its sign-in.
- `allowUntestedHost` starts the plugin outside `>=2.4.1 <2.5.0`. Leave it `false`: the plugin refuses an untested host
  with `HOST_UNTESTED` and a next step.
