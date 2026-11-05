import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/options.js"

describe("parseOptions", () => {
  test("defaults to a supported host only", () => {
    expect(parseOptions(undefined)).toEqual({ allowUntestedHost: false })
    expect(parseOptions(null)).toEqual({ allowUntestedHost: false })
    expect(parseOptions({})).toEqual({ allowUntestedHost: false })
  })

  test("accepts every documented value", () => {
    expect(parseOptions({ allowUntestedHost: true })).toEqual({ allowUntestedHost: true })
    expect(parseOptions({ allowUntestedHost: false })).toEqual({ allowUntestedHost: false })
  })

  test.each([
    [{ access: "write" }, 'Unknown option "access". Accepted options: "allowUntestedHost"'],
    [{ account: "work" }, 'Unknown option "account". Accepted options: "allowUntestedHost"'],
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
      expect(nextStep).toContain(`"package": "@joe-broadhead/opencode-wisprflow", "options": { "allowUntestedHost": true }`)
      expect(message.endsWith(`. Next step: ${nextStep}`)).toBe(true)
      expect(nextStep.endsWith(".")).toBe(true)
    }
  })
})
