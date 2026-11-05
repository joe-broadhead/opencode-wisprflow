// Wispr Flow's part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts. The shared part is tested in
// tools-rpc.test.ts.
import { describe, expect, test } from "bun:test"
import { PLUGIN_ID as WISPRFLOW_PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { KNOWN_READS, NEXT_STEPS, PLUGIN_ID, shapeResult, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { defaultRules } from "../../src/permissions.js"
import { ASK_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/wisprflow-tools.js"

describe("Wispr Flow's tools RPC", () => {
  test("is wisprflow.meetings.tools, under the plugin's own id", () => {
    expect(PLUGIN_ID).toBe(WISPRFLOW_PLUGIN_ID)
    expect(TOOLS_RPC_ID).toBe("wisprflow.meetings.tools")
  })

  test("its methods are exactly the known reads, the tools the default rules allow", () => {
    expect([...KNOWN_READS]).toEqual([...READ_TOOLS])
    const allowed = defaultRules().filter((rule) => rule.effect === "allow").map((rule) => rule.action)
    expect(KNOWN_READS.map((name) => `${SERVER_NAME}_${name}`)).toEqual(allowed)
  })

  test("no known write and no unknown tool is a method", () => {
    expect(KNOWN_READS.filter((name) => WRITE_TOOLS.includes(name))).toEqual([])
    // A read that asks is never a method: no one can answer its prompt in a script.
    expect(KNOWN_READS.filter((name) => ASK_TOOLS.includes(name))).toEqual([])
    for (const name of ["shiny_new_tool", "describe", "*"]) expect(KNOWN_READS).not.toContain(name)
  })

  test("returns Wispr Flow's results unchanged, UTC times included", () => {
    const result = { output: { start: "2026-01-02T03:04:05Z" }, text: "{}" }
    expect(shapeResult("search_meetings", result)).toBe(result)
  })

  test("names Wispr Flow's own commands in its next steps, and has no per-account servers", () => {
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect and choose Wispr Flow")
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("opencode mcp auth wisprflow")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.wisprflow")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("/wisprflow-status")
    for (const step of Object.values(NEXT_STEPS)) expect(step).toMatch(/[^.]\.$/)
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toBeUndefined()
  })
})
