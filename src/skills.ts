/**
 * The plugin's skills: every `skills/<name>/SKILL.md` at the package root, registered with OpenCode at setup.
 *
 * The contract's `register` wires the doors, the accounts and the access rules; skills are the host's (`ctx.skill`),
 * so the plugin registers them itself. The files are read before the synchronous transform, and a file that does not
 * parse fails setup with the contract's code and a next step rather than loading a partial set.
 */
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"

/** `skills/` at the package root: next to `src/` in the repository, next to `dist/` in the installed package. */
export const SKILLS_DIR = fileURLToPath(new URL("../skills/", import.meta.url))

const failure = (problem: string) => new Error(`OPTIONS_INVALID: ${problem} Next step: reinstall the plugin from its release.`)
const notLoaded = (name: string, problem: string) => failure(`The "${name}" skill was not loaded: skills/${name}/SKILL.md ${problem}.`)

const BLOCK = new Set(["|", ">", "|-", ">-", "|+", ">+"])

const unquote = (value: string) => {
  const trimmed = value.trim()
  return (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")) ? trimmed.slice(1, -1) : trimmed
}

/** One frontmatter field: a plain value with folded continuation lines, or a `|`/`>` block. */
export function fieldOf(frontmatter: string, key: string): string | undefined {
  const lines = frontmatter.split("\n")
  const at = lines.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line))
  if (at < 0) return undefined
  const first = (lines[at] ?? "").replace(new RegExp(`^${key}\\s*:\\s*`), "").trim()
  if (first !== "" && !BLOCK.has(first)) {
    const parts = [unquote(first)]
    for (const line of lines.slice(at + 1)) {
      if (line.trim() === "") continue
      if (!/^\s/.test(line)) break
      parts.push(line.trim())
    }
    return parts.join(" ")
  }
  const body: string[] = []
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && !/^\s/.test(line)) break
    body.push(line)
  }
  const indents = body.filter((line) => line.trim() !== "").map((line) => line.length - line.trimStart().length)
  const indent = indents.length === 0 ? 0 : Math.min(...indents)
  const dedented = body.map((line) => line.slice(Math.min(indent, line.length)))
  const folded = first.startsWith(">")
  return unquote(folded ? dedented.map((line) => line.trim()).filter((line) => line !== "").join(" ") : dedented.join("\n").trim())
}

/**
 * Parses `---` frontmatter with `name` and `description`; the body after it is the skill's content. The name must equal
 * the folder, because OpenCode keys a skill by the id the plugin registers, not by the folder it was read from.
 */
export function parseSkill(name: string, path: string, text: string): Skill.Info {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"))
  if (!match) throw notLoaded(name, "has no frontmatter")
  const frontmatter = match[1] ?? ""
  if (fieldOf(frontmatter, "name") !== name) throw notLoaded(name, `must be named "${name}" in its frontmatter`)
  const description = fieldOf(frontmatter, "description")
  if (!description) throw notLoaded(name, "has no description")
  if (/^[>|][+-]?\d*$/.test(description)) throw notLoaded(name, "has a block marker as its description")
  const content = match[2]?.trim() ?? ""
  if (!content) throw notLoaded(name, "has no content")
  return { id: Skill.ID.make(name), name: Skill.Name.make(name), description, path: Skill.Info.fields.path.make(path), content }
}

/** Reads every folder under `skills/`, in name order, and parses its `SKILL.md`. */
export async function loadSkills(directory = SKILLS_DIR): Promise<readonly Skill.Info[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    const code = (error as { code?: unknown }).code
    throw failure(`The plugin's skills folder cannot be read (${typeof code === "string" ? code : String(error)}).`)
  })
  const skills: Skill.Info[] = []
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const path = join(directory, name, "SKILL.md")
    let text: string
    try {
      text = await readFile(path, "utf8")
    } catch (error) {
      const code = (error as { code?: unknown }).code
      throw notLoaded(name, code === "ENOENT" ? "is missing" : `cannot be read (${typeof code === "string" ? code : String(error)})`)
    }
    skills.push(parseSkill(name, path, text))
  }
  return skills
}

/** Registers the skills with the host. The callback is synchronous and runs before the first turn reads them. */
export function registerSkills(skill: Pick<Plugin.Context["skill"], "transform">, skills: readonly Skill.Info[]) {
  return skill.transform((editor) => {
    for (const info of skills) editor.add(info)
  })
}
