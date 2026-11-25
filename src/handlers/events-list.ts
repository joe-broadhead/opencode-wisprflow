/**
 * `events_list`: the meetings source's one read, and its `list` snapshot.
 *
 * The page, its cursor and its screening come from the provider; this handler validates the input, tells the snapshot
 * apart from the events read, and passes the resolved account and the call's vendor-tool context through. The snapshot
 * is for an app's view: a `list` read takes nothing but the source and the list name, so an agent's events read and an
 * app's snapshot never share a cursor or a since.
 */
import { EVENTS_LIST_INPUT_SCHEMA, PAGE_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/events"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { refuseInput, refuseSource } from "./shared.ts"
import { SOURCE } from "../provider/meetings.ts"
import type { HandlerRuntime } from "./index.ts"

/** The registry's `list` answer for the meetings snapshot: id and title, newest first, never editable. */
const LIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["source", "account", "data", "asOf", "trust"],
  properties: {
    source: { type: "string", const: SOURCE },
    account: { type: "string" },
    data: {
      type: "object",
      additionalProperties: false,
      required: ["items", "editable"],
      properties: {
        items: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "text"],
            properties: { id: { type: "string" }, text: { type: "string" } },
          },
        },
        editable: { type: "boolean", const: false },
      },
    },
    asOf: { type: "string" },
    trust: { type: "string", const: "untrusted" },
  },
} as const

/** The page, or the list snapshot, both of which the one method answers. */
const OUTPUT = { anyOf: [PAGE_SCHEMA, LIST_SCHEMA] } as const

/** The contract's `events_list` input, plus this plugin's `list` selector for its snapshot source. */
const INPUT_SCHEMA = {
  ...EVENTS_LIST_INPUT_SCHEMA,
  properties: {
    ...(EVENTS_LIST_INPUT_SCHEMA["properties"] as Readonly<Record<string, unknown>>),
    list: { type: "string", enum: ["meetings"], description: "Answer the meetings list snapshot instead of events: up to 50 meeting titles, newest first. Pass source wisprflow." },
  },
}

/** `events_list`: one account's meetings, oldest first, with a cursor bound to the account. */
export function eventsListHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description:
      "List the meetings Wispr Flow captured since a cursor, oldest first, with each meeting's share link. Pass the previous page's cursor and its account to read what follows it. list: meetings answers the latest meeting titles as a list snapshot instead, for an app's view.",
    input: INPUT_SCHEMA,
    output: OUTPUT,
    async run(input, call) {
      if (input["list"] !== undefined) {
        if (input["list"] !== "meetings") refuseInput(['list must be "meetings"'])
        return runtime.provider.list({ account: call.account, input, now: runtime.clock(), call })
      }
      const source = input["source"]
      if (source !== undefined && source !== SOURCE) refuseSource(runtime.plugin, String(source))
      return runtime.provider.page({ account: call.account, input, now: runtime.clock(), call })
    },
  }
}
