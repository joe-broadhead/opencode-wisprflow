import { describe, expect, test } from "bun:test"
import { ACCESS_VALUES, parseOptions } from "../../src/options.js"

describe("parseOptions", () => {
  test("defaults to a supported host and every tool allowed", () => {
    expect(parseOptions(undefined)).toEqual({ allowUntestedHost: false, access: "all" })
    expect(parseOptions(null)).toEqual({ allowUntestedHost: false, access: "all" })
    expect(parseOptions({})).toEqual({ allowUntestedHost: false, access: "all" })
  })

  test("accepts every documented value", () => {
    expect(parseOptions({ allowUntestedHost: true })).toEqual({ allowUntestedHost: true, access: "all" })
    expect(parseOptions({ allowUntestedHost: false })).toEqual({ allowUntestedHost: false, access: "all" })
    for (const access of ACCESS_VALUES) expect(parseOptions({ access })).toEqual({ allowUntestedHost: false, access })
  })

  test.each([
    [{ account: "work" }, 'Unknown option "account". Accepted options: "allowUntestedHost", "access"'],
    [{ access: "write" }, 'The option "access" must be "all" (the default), "ask-changes" or "read-only", found "write"'],
    [{ access: 1 }, 'The option "access" must be "all" (the default), "ask-changes" or "read-only", found 1'],
    [{ allowUntestedHost: "yes" }, 'The option "allowUntestedHost" must be true or false (the default), found "yes"'],
    [{ allowUntestedHost: null }, 'The option "allowUntestedHost" must be true or false (the default), found null'],
    ["true", "The plugin options must be an object, found \"true\""],
    [[], "The plugin options must be an object, found an array"],
  ])("rejects %j with the key, the accepted values and an example", (input, problem) => {
    expect(() => parseOptions(input)).toThrow(problem)
    try {
      parseOptions(input)
    } catch (error) {
      const { message, code, nextStep } = error as Error & { code: string; nextStep: string }
      expect(code).toBe("OPTIONS_INVALID")
      expect(message.startsWith("OPTIONS_INVALID: ")).toBe(true)
      expect(nextStep).toContain(`"package": "github:joe-broadhead/opencode-wisprflow#v0.0.0", "options": { "allowUntestedHost": true }`)
      expect(message.endsWith(`. Next step: ${nextStep}`)).toBe(true)
      expect(nextStep.endsWith(".")).toBe(true)
    }
  })
})
