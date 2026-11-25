/**
 * `probe`: whose sign-in an account is. It reads the account and never any content.
 *
 * Wispr Flow names no account, so the owner is OpenCode's sign-in for the alias's MCP server, marked `verified: false`
 * exactly as every events page names it. The check calls the provider for nothing.
 */
import { PROBE_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/events"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { refuseSource } from "./shared.ts"
import { SOURCE } from "../provider/meetings.ts"
import type { HandlerRuntime } from "./index.ts"

/** `probe`: the owner of one account, and no content. */
export function probeHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description: "Read the signed-in owner of one account. Use it to tell accounts apart; it reads no meetings and calls no provider tool.",
    input: {
      type: "object",
      properties: { source: { type: "string", enum: [SOURCE], description: "The source to probe; wisprflow." } },
      additionalProperties: false,
    },
    output: PROBE_SCHEMA,
    async run(input, call) {
      const source = input["source"]
      if (source !== undefined && source !== SOURCE) refuseSource(runtime.plugin, String(source))
      return runtime.provider.probe({ account: call.account })
    },
  }
}
