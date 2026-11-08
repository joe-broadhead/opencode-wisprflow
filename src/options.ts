import { wisprflowError } from "./constants.js"

/** What the default rules allow. `all` is the default; the other two are how a user restricts the plugin. */
export type Access = "all" | "ask-changes" | "read-only"

export const ACCESS_VALUES: readonly Access[] = ["all", "ask-changes", "read-only"]

interface Options {
  /** Run on an OpenCode version outside the supported range, with a note in status. */
  readonly allowUntestedHost: boolean
  /** What the generated default rules allow: everything, changes ask, or read-only. */
  readonly access: Access
}

const EXAMPLE = `"plugins": [{ "package": "@joe-broadhead/opencode-wisprflow", "options": { "allowUntestedHost": true } }]`
const ACCEPTED = {
  allowUntestedHost: "true or false (the default)",
  access: `"all" (the default), "ask-changes" or "read-only"`,
} as const

const invalid = (problem: string) =>
  wisprflowError("OPTIONS_INVALID", `${problem}.`, `Fix the plugin options in opencode.json, for example ${EXAMPLE}.`)

/** Validates the plugin options from opencode.json. Every option is optional. */
export function parseOptions(raw: unknown): Options {
  if (raw === undefined || raw === null) return { allowUntestedHost: false, access: "all" }
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid(`The plugin options must be an object, found ${describe(raw)}`)
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(ACCEPTED, key)) {
      throw invalid(`Unknown option "${key}". Accepted options: ${Object.keys(ACCEPTED).map((name) => `"${name}"`).join(", ")}`)
    }
  }
  const { allowUntestedHost = false, access = "all" } = input
  if (typeof allowUntestedHost !== "boolean") {
    throw invalid(`The option "allowUntestedHost" must be ${ACCEPTED.allowUntestedHost}, found ${describe(allowUntestedHost)}`)
  }
  if (typeof access !== "string" || !(ACCESS_VALUES as readonly string[]).includes(access)) {
    throw invalid(`The option "access" must be ${ACCEPTED.access}, found ${describe(access)}`)
  }
  return { allowUntestedHost, access: access as Access }
}

const describe = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "an array" : typeof value === "string" ? JSON.stringify(value) : typeof value === "object" ? "an object" : String(value)
