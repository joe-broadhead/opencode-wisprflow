// Wispr Flow's part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts. The shared part is tested in
// tools-rpc.test.ts.
import { describe, expect, test } from "bun:test"
import { PLUGIN_ID as WISPRFLOW_PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { METHODS, NEXT_STEPS, PLUGIN_ID, shapeInput, shapeResult, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { defaultRules } from "../../src/permissions.js"
import { ASK_TOOLS, PLUGIN_READS, READ_TOOLS, WRITE_TOOLS } from "../../src/wisprflow-tools.js"

describe("Wispr Flow's tools RPC", () => {
  test("is wisprflow.meetings.tools, under the plugin's own id", () => {
    expect(PLUGIN_ID).toBe(WISPRFLOW_PLUGIN_ID)
    expect(TOOLS_RPC_ID).toBe("wisprflow.meetings.tools")
  })

  test("every known tool is a method, by exact name, and all of them only read", () => {
    expect(METHODS.map((method) => method.name)).toEqual([...READ_TOOLS, ...ASK_TOOLS, ...WRITE_TOOLS])
    for (const method of METHODS) expect(method).toMatchObject({ kind: "mcp", class: "read" })
    // Every known tool allows by default, and so does the namespace rule that covers a tool Wispr Flow adds later.
    const allowed = defaultRules().filter((rule) => rule.effect === "allow").map((rule) => rule.action)
    expect(allowed).toEqual([`${SERVER_NAME}_*`, ...[...READ_TOOLS, ...PLUGIN_READS, ...ASK_TOOLS, ...WRITE_TOOLS].map((name) => `${SERVER_NAME}_${name}`)])
    // A read that asks is a method too: a script is refused it only when the user restricts the plugin.
    expect(defaultRules()).toContainEqual({ action: `wisprflow_${ASK_TOOLS[0]}`, resource: "*", effect: "allow" })
    for (const name of ["shiny_new_tool", "describe", "*"]) expect(METHODS.map((method) => method.name)).not.toContain(name)
  })

  test("returns Wispr Flow's results unchanged, UTC times included, and leaves its arguments alone", () => {
    const result = { output: { start: "2026-01-02T03:04:05Z" }, text: "{}" }
    const call = { sessionID: "s", agent: "a", action: "wisprflow_search_meetings" }
    expect(shapeResult("search_meetings", result, call)).toBe(result)
    expect(shapeInput("search_meetings", { query: "q" }, call)).toEqual({ query: "q" })
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
