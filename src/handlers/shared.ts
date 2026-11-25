/** The shapes and refusals the handlers share. */
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import type { JsonSchema } from "@we-the-rebel-alliance/plugin-contract/manifest"

/** A method that takes no input. */
export const EMPTY: JsonSchema = { type: "object", properties: {}, additionalProperties: false }

/** Refuse an input the handler rejected, in the contract's one form. */
export function refuseInput(problems: readonly string[]): never {
  throw new SourceError({ code: "INPUT_INVALID", what: problems.join("; "), next: "Pass only the input the method's schema describes." })
}

/** Refuse a source this plugin does not have. */
export function refuseSource(plugin: string, source: string): never {
  throw new SourceError({ code: "SOURCE_UNKNOWN", what: `${source} is not a source of ${plugin}`, next: 'Read the "wisprflow" source, or omit source.' })
}
