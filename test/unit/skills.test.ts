import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import type { Plugin } from "@opencode/plugin"
import { readSkills, registerSkills } from "../../src/skills.ts"

const roots: string[] = []
after(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tree(skills: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "wisprflow-skills-"))
  roots.push(root)
  for (const [directory, text] of Object.entries(skills)) {
    mkdirSync(join(root, directory))
    writeFileSync(join(root, directory, "SKILL.md"), text)
  }
  return root
}

test("reads every skills/<name>/SKILL.md from the package root", () => {
  assert.deepEqual(
    readSkills().map((skill) => skill.id),
    ["wisprflow", "wisprflow-meeting-brief"],
  )
})

test("parses folded and literal block descriptions from the front matter", () => {
  const skills = readSkills(
    tree({
      wisprflow: "---\nname: wisprflow\ndescription: >\n  Read the meetings Wispr Flow captured.\n  Then summarise them.\n---\nbody",
      "wisprflow-meeting-brief": "---\nname: wisprflow-meeting-brief\ndescription: |\n  First line.\n  Second line.\n---\nbody",
    }),
  )
  assert.deepEqual(
    skills.map((skill) => [skill.id, skill.description]),
    [
      ["wisprflow", "Read the meetings Wispr Flow captured. Then summarise them.\n"],
      ["wisprflow-meeting-brief", "First line.\nSecond line.\n"],
    ],
  )
})

test("registers each skill under its directory name, with the parsed front matter and body", async () => {
  const skills = readSkills()
  const added: { id: string; name: string; description?: string; path: string; content: string }[] = []
  const ctx = {
    skill: {
      transform: async (callback: (editor: { add: (skill: (typeof added)[number]) => void }) => void) => {
        callback({ add: (skill) => void added.push(skill) })
        return { dispose: async () => {} }
      },
    },
  } as unknown as Plugin.Context
  await registerSkills(ctx, skills)
  assert.deepEqual(
    added.map((skill) => skill.id),
    ["wisprflow", "wisprflow-meeting-brief"],
  )
  for (const [index, skill] of skills.entries()) {
    const item = added[index]
    assert.ok(item !== undefined)
    assert.equal(item.name, skill.name)
    assert.equal(item.description, skill.description)
    assert.equal(item.path, skill.path)
    assert.equal(item.content, skill.content)
  }
})

for (const [label, files] of [
  ["a name that differs from the directory", { wisprflow: "---\nname: other\ndescription: A skill.\n---\nbody" }],
  ["no description", { wisprflow: "---\nname: wisprflow\n---\nbody" }],
  ["a block marker with no text", { wisprflow: "---\nname: wisprflow\ndescription: >\n---\nbody" }],
  ["a literal block marker as the description", { wisprflow: "---\nname: wisprflow\ndescription: '>'\n---\nbody" }],
  ["no front matter", { wisprflow: "# Wispr Flow" }],
  ["an empty body", { wisprflow: "---\nname: wisprflow\ndescription: A skill.\n---\n" }],
] as const) {
  test(`refuses a skill with ${label}, with a contract code and a next step`, () => {
    assert.throws(
      () => readSkills(tree(files)),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /^SCHEMA_VIOLATION: /)
        assert.match(error.message, /Next step: /)
        return true
      },
    )
  })
}
