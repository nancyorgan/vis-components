// @vitest-environment node
// Edit safety and undo (Andrew's specs 03 and 04): TST-2 to TST-6, TST-9 and
// TST-10 to TST-15, against the real self-host server. Each test keeps its
// history in its own temp state folder; handler instances sharing one folder
// stand in for Claude Desktop's two copies of the MCP and for a restart.
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { CONTENT_MIGRATIONS } from "../../src/contexts/chartBuilder/lib/storage/migrations"
import type { Visual } from "../../src/contexts/chartBuilder/lib/types"
import { hydrateVisual } from "../../src/contexts/chartBuilder/lib/visualDefaults"
import { createApi } from "./api"
import { TOOL_TEXT } from "./guide"
import { createHistory, HISTORY_FILE, LOCK_FILE, resolveStateDir, serverKey, type History } from "./history"
import { fakeRenderer, startTestServer, type TestServer } from "./testServer"
import { createHandlers, type Handlers } from "./tools"
import { changedPaths, describeChanges, normalizeVisual, restoreAt } from "./visualDiff"

const VERSION = CONTENT_MIGRATIONS.visuals.currentVersion
const DAY = 24 * 60 * 60 * 1000

let server: TestServer
beforeAll(async () => {
	server = await startTestServer()
})
afterAll(() => server.close())

const folder = () => mkdtempSync(join(tmpdir(), "vis-mcp-history-"))

const direct = () => createApi(server.base)

const instance = (
	stateDir: string,
	more: { fetchImpl?: typeof fetch; base?: string; formatVersion?: number; history?: History } = {}
): Handlers =>
	createHandlers(createApi(more.base ?? server.base, more.fetchImpl), {
		renderer: fakeRenderer(),
		stateDir,
		...(more.formatVersion === undefined ? {} : { formatVersion: more.formatVersion }),
		...(more.history ? { history: more.history } : {}),
	})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Out = Record<string, any>
const text = (r: CallToolResult) => (r.content[0] as { text: string }).text
const ok = (r: CallToolResult): Out => {
	expect(r.isError, text(r)).toBeFalsy()
	return JSON.parse(text(r))
}
const no = (r: CallToolResult): Out => {
	expect(r.isError, text(r)).toBe(true)
	return JSON.parse(text(r))
}

const stored = async (id: string) => (await direct().taggedVisual(id)) as { visual: Visual; tag: string }
const bare = (v: Visual) => ({ ...v, updatedAt: 0 })
const titleOf = async (id: string) => (await stored(id)).visual.labelsConfig.title
const subtitleOf = async (id: string) => (await stored(id)).visual.labelsConfig.subtitle
const yMinOf = async (id: string) => (await stored(id)).visual.channelConfigs.y?.min

/** The person's save, as the editor saves: untagged, last write wins. */
const personSave = async (id: string, change: (v: Visual) => Visual) => {
	const v = (await direct().visual(id)) as Visual
	return direct().putVisual(change({ ...v, updatedAt: v.updatedAt + 1 }))
}
const titled = (title: string) => (v: Visual) => ({ ...v, labelsConfig: { ...v.labelsConfig, title } })
const subtitled = (subtitle: string) => (v: Visual) => ({ ...v, labelsConfig: { ...v.labelsConfig, subtitle } })
const renamed = (name: string) => (v: Visual) => ({ ...v, name })

let made = 0
/** A two-row chart: points (x + y, for a y minimum) or bars. */
const chart = async (tools: Handlers, kind: "points" | "bars" = "points", settings?: Record<string, unknown>) => {
	const n = ++made
	if (kind === "bars") {
		const ds = ok(
			await tools.create_dataset({
				name: `Quarters ${n}`,
				rows: [
					{ Quarter: "Q1", Rate: 4 },
					{ Quarter: "Q2", Rate: 6 },
				],
			})
		)
		return ok(
			await tools.create_chart({
				datasetId: ds.id,
				encodings: { x: "Quarter", length: "Rate" },
				title: "Rate by quarter",
				...(settings ? { settings } : {}),
			})
		).id as string
	}
	const ds = ok(
		await tools.create_dataset({
			name: `Years ${n}`,
			rows: [
				{ Year: 2020, Rate: 10, Region: "North" },
				{ Year: 2021, Rate: 12, Region: "North.East" },
			],
		})
	)
	return ok(
		await tools.create_chart({
			datasetId: ds.id,
			encodings: { x: "Year", y: "Rate" },
			title: "Rate by year",
			...(settings ? { settings } : {}),
		})
	).id as string
}

type StoredStep = { id: string; at: number; tag: string | null }
const historyOf = (dir: string) => JSON.parse(readFileSync(join(dir, HISTORY_FILE), "utf8"))
const chartState = (dir: string, id: string) => historyOf(dir).servers[serverKey(server.base)]?.[String(VERSION)]?.charts?.[id]
const stepsOf = (dir: string, id: string): StoredStep[] => chartState(dir, id)?.steps ?? []

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const CHOICES = /keep theirs \(.*keepTheirs: true.*\); go ahead \(.*revision.*\); leave it \(no call\); or a combined value \(edit_chart with this revision/
const UNDO_CHOICES = /keep theirs \(undo_chart_edit with keepTheirs: true.*\); undo over theirs \(undo_chart_edit with this revision\); leave it \(no call\); or a combined value \(edit_chart with this revision/

// ---------------------------------------------------------------------------
// The diff itself
// ---------------------------------------------------------------------------

describe("setting paths", () => {
	it("keeps keys holding dots apart, compares lists whole, and restores without leaving empty objects", () => {
		const a = { c: { colors: { North: "#1", "North.East": "#2" }, rules: [1, 2] } }
		const b = { c: { colors: { North: "#3", "North.East": "#2" }, rules: [1, 2, 3] } }
		expect(changedPaths(a, b)).toEqual([
			["c", "colors", "North"],
			["c", "rules"],
		])
		expect(describeChanges([["c", "colors", "North.East"]], a, b)).toEqual(['c.colors["North.East"]: "#2" -> "#2"'])
		const target = { c: { x: { min: 0 } }, k: 1 }
		restoreAt(target, { k: 1 }, ["c", "x", "min"])
		expect(target).toEqual({ k: 1 })
		restoreAt(target, { c: { y: [1] } }, ["c", "y"])
		expect(target).toEqual({ k: 1, c: { y: [1] } })
	})

	it("reads the editor's filled-in defaults as no change", () => {
		const v = { id: "v", name: "n", labelsConfig: { title: "t" }, encodings: {}, channelConfigs: {} } as unknown as Visual
		expect(changedPaths(normalizeVisual(v), normalizeVisual({ ...v, ...hydrateVisual(v), updatedAt: 5 }))).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// Spec 03: no lost work
// ---------------------------------------------------------------------------

describe("TST-2: an edit with no revision keeps the person's newer change", () => {
	it.each(["create", "edit", "undo"])("after %s: paused, naming the title from -> to, and leaving no undo step", async (lead) => {
		const tools = instance(folder())
		const id = await chart(tools, "bars")
		const subtitle = await subtitleOf(id)
		if (lead !== "create") ok(await tools.edit_chart({ id, patch: { subtitle: "Ours" } }))
		if (lead === "undo") ok(await tools.undo_chart_edit({ id }))
		await personSave(id, titled("The person's title"))
		const paused = no(await tools.edit_chart({ id, patch: { title: "The model's title" } }))
		const now = await stored(id)
		expect(now.visual.labelsConfig.title).toBe("The person's title")
		expect(paused.changes).toEqual(['labelsConfig.title: "Rate by quarter" -> "The person\'s title"'])
		expect(paused.revision).toBe(now.tag)
		expect(paused.message).toMatch(/ask what they want/)
		const undo = await tools.undo_chart_edit({ id })
		if (lead === "edit") {
			ok(undo)
			expect(await subtitleOf(id)).toBe(subtitle)
			expect(await titleOf(id)).toBe("The person's title")
		} else expect(no(undo).message).toMatch(/^Nothing is left to undo/)
	})
})

describe("TST-3: an edit at a revision", () => {
	it("same setting paused (twice), other setting merged, the refusal's revision overwrites, get_chart then lands", async () => {
		const tools = instance(folder())
		const id = await chart(tools)
		const r0 = ok(await tools.get_chart({ id, picture: false })).revision as string
		expect(r0).toMatch(/^"/)
		await personSave(id, titled("Theirs"))
		const first = no(await tools.edit_chart({ id, revision: r0, patch: { title: "Mine" } }))
		expect(first.message).toMatch(CHOICES)
		expect(await titleOf(id)).toBe("Theirs")
		no(await tools.edit_chart({ id, revision: r0, patch: { title: "Mine" } }))
		const sub = ok(await tools.edit_chart({ id, revision: r0, patch: { subtitle: "Sub" } }))
		expect(sub.revision).not.toBe(r0)
		expect(await titleOf(id)).toBe("Theirs")
		expect(await subtitleOf(id)).toBe("Sub")
		const go = ok(await tools.edit_chart({ id, revision: first.revision, patch: { title: "Mine" } }))
		expect(go.revision).not.toBe(sub.revision)
		expect(await titleOf(id)).toBe("Mine")
		expect(await subtitleOf(id)).toBe("Sub")

		await personSave(id, titled("Theirs again"))
		no(await tools.edit_chart({ id, patch: { title: "Mine again" } }))
		ok(await tools.get_chart({ id, picture: false }))
		ok(await tools.edit_chart({ id, patch: { title: "Mine again" } }))
		expect(await titleOf(id)).toBe("Mine again")
	})

	it.each(["keep theirs", "go ahead", "combined", "leave it"])("from a pause, %s takes at most one call", async (way) => {
		const tools = instance(folder())
		const id = await chart(tools)
		const subtitle = await subtitleOf(id)
		await personSave(id, titled("Theirs"))
		const left = bare((await stored(id)).visual)
		const patch = { title: "Mine", subtitle: "My subtitle" }
		const p = no(await tools.edit_chart({ id, patch }))
		expect(p.message).toMatch(CHOICES)
		if (way === "keep theirs") {
			ok(await tools.edit_chart({ id, keepTheirs: true, patch }))
			expect(await titleOf(id)).toBe("Theirs")
			expect(await subtitleOf(id)).toBe("My subtitle")
		} else if (way === "go ahead") {
			ok(await tools.edit_chart({ id, revision: p.revision, patch }))
			expect(await titleOf(id)).toBe("Mine")
			expect(await subtitleOf(id)).toBe("My subtitle")
		} else if (way === "combined") {
			ok(await tools.edit_chart({ id, revision: p.revision, patch: { title: "Theirs, and mine" } }))
			expect(await titleOf(id)).toBe("Theirs, and mine")
			expect(await subtitleOf(id)).toBe(subtitle)
		} else expect(bare((await stored(id)).visual)).toEqual(left)
	})
})

describe("TST-4: the baseline survives", () => {
	it("a second copy, a restart, and 150 other charts read", async () => {
		const dir = folder()
		const a = instance(dir)
		const b = instance(dir)
		const id = await chart(a)
		await personSave(id, titled("The person's title"))
		no(await b.edit_chart({ id, patch: { title: "Model" } }))
		no(await instance(dir).edit_chart({ id, patch: { title: "Model" } }))
		const template = (await direct().visual(id)) as Visual
		for (let i = 0; i < 150; i++) {
			const other = { ...template, id: `vs-other-${made}-${i}` }
			await direct().putVisual(other)
			ok(await a.get_chart({ id: other.id, picture: false }))
		}
		no(await a.edit_chart({ id, patch: { title: "Model" } }))
		expect(await titleOf(id)).toBe("The person's title")
	}, 60_000)

	it("a baseline trimmed by age, or an unreadable history, refuses the edit and asks for get_chart", async () => {
		const dir = folder()
		const a = instance(dir)
		const id = await chart(a)
		const file = historyOf(dir)
		const state = file.servers[serverKey(server.base)][String(VERSION)].charts[id]
		state.baseline.at = Date.now() - 31 * DAY
		state.revisions = []
		writeFileSync(join(dir, HISTORY_FILE), JSON.stringify(file))
		expect(no(await a.edit_chart({ id, patch: { title: "Model" } })).message).toMatch(/get_chart/)
		ok(await a.get_chart({ id, picture: false }))
		ok(await a.edit_chart({ id, patch: { title: "Model" } }))

		writeFileSync(join(dir, HISTORY_FILE), "{ not json")
		const other = await chart(instance(folder()))
		expect(no(await a.edit_chart({ id: other, patch: { title: "Model" } })).message).toMatch(/get_chart/)
		ok(await a.get_chart({ id: other, picture: false }))
		ok(await a.edit_chart({ id: other, patch: { title: "Model" } }))
		expect(readdirSync(dir)).toEqual([HISTORY_FILE])
	})
})

describe("TST-5: a save landing mid-edit", () => {
	/** An instance whose visual PUTs first run the next queued save. */
	const hooked = () => {
		const queue: Array<() => Promise<unknown>> = []
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
			if (init?.method === "PUT" && String(input).includes("/api/visuals/")) await queue.shift()?.()
			return fetch(input, init)
		}) as typeof fetch
		return { tools: instance(folder(), { fetchImpl }), queue }
	}

	it("the title saved in between pauses a title edit", async () => {
		const { tools, queue } = hooked()
		const id = await chart(tools)
		queue.push(() => personSave(id, titled("Late")))
		no(await tools.edit_chart({ id, patch: { title: "Mine" } }))
		expect(await titleOf(id)).toBe("Late")
	})

	it("the name saved in between: the edit lands and both stand", async () => {
		const { tools, queue } = hooked()
		const id = await chart(tools)
		queue.push(() => personSave(id, renamed("Renamed")))
		ok(await tools.edit_chart({ id, patch: { title: "Mine" } }))
		expect((await stored(id)).visual.name).toBe("Renamed")
		expect(await titleOf(id)).toBe("Mine")
	})

	it("a second save during the one retry refuses the edit", async () => {
		const { tools, queue } = hooked()
		const id = await chart(tools)
		queue.push(
			() => personSave(id, renamed("Once")),
			() => personSave(id, renamed("Twice"))
		)
		expect(no(await tools.edit_chart({ id, patch: { title: "Mine" } })).message).toMatch(/saved elsewhere twice/)
		expect((await stored(id)).visual.name).toBe("Twice")
		expect(await titleOf(id)).toBe("Rate by year")
	})
})

describe("TST-6: keys with dots, defaults, lists, made-up revisions, charts never returned", () => {
	it('"North" and "North.East" stay apart', async () => {
		const tools = instance(folder())
		const ds = ok(
			await tools.create_dataset({
				name: `Regions ${++made}`,
				rows: [
					{ Year: 2020, Rate: 10, Region: "North" },
					{ Year: 2021, Rate: 12, Region: "North.East" },
				],
			})
		)
		const id = ok(
			await tools.create_chart({
				datasetId: ds.id,
				encodings: { x: "Year", y: "Rate", hue: "Region" },
				title: "Rate by region",
				settings: { channelConfigs: { hue: { colors: { North: "#111111", "North.East": "#222222" } } } },
			})
		).id as string
		const r = ok(await tools.get_chart({ id, picture: false })).revision
		await personSave(id, (v) => {
			const hue = v.channelConfigs.hue as unknown as { colors: Record<string, string> }
			return { ...v, channelConfigs: { ...v.channelConfigs, hue: { ...hue, colors: { ...hue.colors, North: "#333333" } } } } as unknown as Visual
		})
		ok(
			await tools.edit_chart({
				id,
				revision: r,
				patch: { settings: { channelConfigs: { hue: { colors: { "North.East": "#444444" } } } } },
			})
		)
		const colors = ((await stored(id)).visual.channelConfigs.hue as unknown as { colors: Record<string, string> }).colors
		expect(colors.North).toBe("#333333")
		expect(colors["North.East"]).toBe("#444444")
	})

	it("defaults the editor fills in on save are no change", async () => {
		const tools = instance(folder())
		const id = await chart(tools)
		const full = (await direct().visual(id)) as Visual
		const raw = { ...full } as Partial<Visual>
		for (const key of [
			"legendConfig",
			"tooltipConfig",
			"captionConfig",
			"dataTableConfig",
			"accessibilityConfig",
			"reshapeConfig",
			"derivedVariablesConfig",
			"mapConfig",
			"fieldLevelOrders",
			"dataLabelsConfig",
		] as const)
			delete raw[key]
		await direct().putVisual(raw as Visual)
		ok(await tools.get_chart({ id, picture: false }))
		await personSave(id, (v) => ({ ...v, ...hydrateVisual(v) }))
		ok(await tools.edit_chart({ id, patch: { settings: { legendConfig: { position: "bottom" } } } }))
		expect((await stored(id)).visual.legendConfig?.position).toBe("bottom")
	})

	it("a list the person changed is one conflicting path", async () => {
		const tools = instance(folder())
		const id = await chart(tools, "bars", {
			channelConfigs: { fillColorRules: [{ condition: "> 1", color: "#111111" }] },
		})
		await personSave(id, (v) => ({
			...v,
			channelConfigs: {
				...v.channelConfigs,
				fillColorRules: [
					{ condition: "> 1", color: "#111111" },
					{ condition: "> 5", color: "#999999" },
				],
			},
		}))
		const p = no(
			await tools.edit_chart({
				id,
				patch: { settings: { channelConfigs: { fillColorRules: [{ condition: "> 2", color: "#555555" }] } } },
			})
		)
		expect(p.changes).toHaveLength(1)
		expect(p.changes[0]).toMatch(/^channelConfigs\.fillColorRules: \[/)
	})

	it("a made-up revision is refused; a chart never returned is edited as it is now", async () => {
		const tools = instance(folder())
		const id = await chart(tools)
		const before = (await stored(id)).tag
		expect(no(await tools.edit_chart({ id, revision: '"made-up"', patch: { title: "No" } })).message).toMatch(
			/read it again with get_chart/
		)
		expect((await stored(id)).tag).toBe(before)

		const elsewhere = await chart(instance(folder()))
		await personSave(elsewhere, titled("Person"))
		const fresh = instance(folder())
		ok(await fresh.edit_chart({ id: elsewhere, patch: { subtitle: "Mine" } }))
		expect(await titleOf(elsewhere)).toBe("Person")
		ok(await fresh.edit_chart({ id: elsewhere, patch: { title: "Model" } }))
		expect(await titleOf(elsewhere)).toBe("Model")
	})
})

describe("TST-9: a write against a newer data format", () => {
	it("refuses create and edit, saying to update the MCP, and leaves the library", async () => {
		const own = await startTestServer()
		try {
			const tools = instance(folder(), { base: own.base })
			const ds = ok(await tools.create_dataset({ name: "Format", rows: [{ a: "x", b: 1 }] }))
			const id = ok(await tools.create_chart({ datasetId: ds.id, encodings: { x: "a", length: "b" } })).id
			const api = createApi(own.base)
			const before = await api.visuals()
			const put = await fetch(`${own.base}/api/content-versions/visuals`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ v: VERSION + 1 }),
			})
			expect(put.ok).toBe(true)
			expect(no(await tools.create_chart({ datasetId: ds.id, encodings: { x: "a" } })).message).toMatch(/Update the MCP/)
			expect(no(await tools.edit_chart({ id, patch: { title: "No" } })).message).toMatch(/Update the MCP/)
			expect(await api.visuals()).toEqual(before)
		} finally {
			own.close()
		}
	})
})

// ---------------------------------------------------------------------------
// Spec 04: undo
// ---------------------------------------------------------------------------

describe("TST-10: two edits, two undos, exactly", () => {
	it("each undo restores the state before its edit; the third says nothing is left and writes nothing", async () => {
		const tools = instance(folder())
		const id = await chart(tools)
		const s0 = bare((await stored(id)).visual)
		ok(await tools.edit_chart({ id, patch: { title: "T1", axes: { y: { min: 5 } } } }))
		const s1 = bare((await stored(id)).visual)
		expect(s1.channelConfigs.y?.min).toBe(5)
		ok(await tools.edit_chart({ id, patch: { subtitle: "Sub" } }))
		ok(await tools.undo_chart_edit({ id }))
		expect(bare((await stored(id)).visual)).toEqual(s1)
		ok(await tools.undo_chart_edit({ id }))
		expect(bare((await stored(id)).visual)).toEqual(s0)
		const tag = (await stored(id)).tag
		expect(no(await tools.undo_chart_edit({ id })).message).toMatch(/^Nothing is left to undo/)
		expect((await stored(id)).tag).toBe(tag)
	})
})

/** An edit of the title and y minimum, then the person's save of the title. */
const pausedUndo = async () => {
	const dir = folder()
	const tools = instance(dir)
	const id = await chart(tools)
	const s0 = bare((await stored(id)).visual)
	ok(await tools.edit_chart({ id, patch: { title: "T1", axes: { y: { min: 5 } } } }))
	await personSave(id, titled("Theirs"))
	const theirs = await stored(id)
	const p = no(await tools.undo_chart_edit({ id }))
	return { dir, tools, id, s0, theirs, p }
}

describe("TST-11: undo merges and never undoes someone else's save", () => {
	it("(a) another setting changed since: undone with no pause, their subtitle kept", async () => {
		const tools = instance(folder())
		const id = await chart(tools)
		const s0 = bare((await stored(id)).visual)
		ok(await tools.edit_chart({ id, patch: { title: "T1", axes: { y: { min: 5 } } } }))
		await personSave(id, subtitled("Person sub"))
		ok(await tools.undo_chart_edit({ id }))
		expect(await titleOf(id)).toBe(s0.labelsConfig.title)
		expect(await yMinOf(id)).toBe(s0.channelConfigs.y?.min)
		expect(await subtitleOf(id)).toBe("Person sub")
	})

	it("(b) the same setting changed: paused naming it; keep theirs and over theirs each from the same start", async () => {
		const keep = await pausedUndo()
		expect(keep.p.changes).toEqual(['labelsConfig.title: "T1" -> "Theirs"'])
		expect(keep.p.revision).toBe(keep.theirs.tag)
		expect(keep.p.message).toMatch(UNDO_CHOICES)
		expect(keep.p.message).toMatch(/lose their change/)
		expect((await stored(keep.id)).tag).toBe(keep.theirs.tag)
		ok(await keep.tools.undo_chart_edit({ id: keep.id, keepTheirs: true }))
		expect(await titleOf(keep.id)).toBe("Theirs")
		expect(await yMinOf(keep.id)).toBe(keep.s0.channelConfigs.y?.min)

		const over = await pausedUndo()
		ok(await over.tools.undo_chart_edit({ id: over.id, revision: over.p.revision }))
		expect(await titleOf(over.id)).toBe(over.s0.labelsConfig.title)
		expect(await yMinOf(over.id)).toBe(over.s0.channelConfigs.y?.min)
	})

	it("(c) a rename between two edits survives both undos; the step below keeps its own write", async () => {
		const dir = folder()
		const tools = instance(dir)
		const id = await chart(tools)
		const s0 = bare((await stored(id)).visual)
		ok(await tools.edit_chart({ id, patch: { title: "T1" } }))
		await personSave(id, renamed("Renamed"))
		ok(await tools.edit_chart({ id, patch: { subtitle: "Sub" } }))
		const belowTag = stepsOf(dir, id)[0].tag
		ok(await tools.undo_chart_edit({ id }))
		expect(stepsOf(dir, id)[0].tag).toBe(belowTag)
		ok(await tools.undo_chart_edit({ id }))
		const now = (await stored(id)).visual
		expect(now.name).toBe("Renamed")
		expect(now.labelsConfig.title).toBe(s0.labelsConfig.title)
		expect(now.labelsConfig.subtitle).toBe(s0.labelsConfig.subtitle)
	})

	it("(d) UNDO-17: after an undo, the step below is checked against it; a later change to its setting pauses", async () => {
		const dir = folder()
		const tools = instance(dir)
		const id = await chart(tools)
		ok(await tools.edit_chart({ id, patch: { title: "One" } }))
		ok(await tools.edit_chart({ id, patch: { subtitle: "Two" } }))
		ok(await tools.undo_chart_edit({ id }))
		// Nothing else saved: the step below took the undo's write.
		expect(stepsOf(dir, id)[0].tag).toBe((await stored(id)).tag)
		await personSave(id, titled("Person"))
		const tag = (await stored(id)).tag
		no(await tools.undo_chart_edit({ id }))
		expect((await stored(id)).tag).toBe(tag)
		expect(await titleOf(id)).toBe("Person")
	})

	it("(d) with no other save, the second undo lands", async () => {
		const tools = instance(folder())
		const id = await chart(tools)
		const s0 = bare((await stored(id)).visual)
		ok(await tools.edit_chart({ id, patch: { title: "One" } }))
		ok(await tools.edit_chart({ id, patch: { subtitle: "Two" } }))
		ok(await tools.undo_chart_edit({ id }))
		ok(await tools.undo_chart_edit({ id }))
		expect(bare((await stored(id)).visual)).toEqual(s0)
	})
})

describe("TST-12: undo over a change only on that pause's yes", () => {
	/** An edit of the subtitle, then the person's subtitle (and name). */
	const subtitleClash = async (dir = folder()) => {
		const tools = instance(dir)
		const id = await chart(tools)
		const s0 = bare((await stored(id)).visual)
		ok(await tools.edit_chart({ id, patch: { subtitle: "Mine" } }))
		await personSave(id, (v) => renamed("Renamed")(subtitled("Theirs")(v)))
		return { dir, tools, id, s0 }
	}

	it("the pause names the subtitle; its revision restores it and keeps their other change", async () => {
		const { tools, id, s0 } = await subtitleClash()
		const p = no(await tools.undo_chart_edit({ id }))
		expect(p.changes).toEqual(['labelsConfig.subtitle: "Mine" -> "Theirs"'])
		expect(p.revision).toBe((await stored(id)).tag)
		ok(await tools.undo_chart_edit({ id, revision: p.revision }))
		expect(await subtitleOf(id)).toBe(s0.labelsConfig.subtitle)
		expect((await stored(id)).visual.name).toBe("Renamed")
	})

	it("(a) get_chart's revision with no pause, and (b) a made-up one, are refused; nothing written, the step kept", async () => {
		const { dir, tools, id } = await subtitleClash()
		const r = ok(await tools.get_chart({ id, picture: false })).revision
		const tag = (await stored(id)).tag
		expect(no(await tools.undo_chart_edit({ id, revision: r })).changes).toEqual([
			'labelsConfig.subtitle: "Mine" -> "Theirs"',
		])
		expect(no(await tools.undo_chart_edit({ id, revision: '"made-up"' })).changes).toHaveLength(1)
		expect((await stored(id)).tag).toBe(tag)
		expect(stepsOf(dir, id)).toHaveLength(1)
	})

	it("(c) two retries at once with one revision undo one step only", async () => {
		const dir = folder()
		const tools = instance(dir)
		const id = await chart(tools)
		ok(await tools.edit_chart({ id, patch: { title: "One" } }))
		ok(await tools.edit_chart({ id, patch: { subtitle: "Mine" } }))
		await personSave(id, subtitled("Theirs"))
		const p = no(await tools.undo_chart_edit({ id }))
		const other = instance(dir)
		const results = await Promise.all([
			tools.undo_chart_edit({ id, revision: p.revision }),
			other.undo_chart_edit({ id, revision: p.revision }),
		])
		expect(results.filter((r) => !r.isError)).toHaveLength(1)
		expect(stepsOf(dir, id)).toHaveLength(1)
		expect(await titleOf(id)).toBe("One")
	})

	it("(d) a save between the pause and the yes refuses the yes, keeps the save and the step", async () => {
		const { dir, tools, id } = await subtitleClash()
		const p = no(await tools.undo_chart_edit({ id }))
		await personSave(id, renamed("Again"))
		no(await tools.undo_chart_edit({ id, revision: p.revision }))
		expect((await stored(id)).visual.name).toBe("Again")
		expect(await subtitleOf(id)).toBe("Theirs")
		expect(stepsOf(dir, id)).toHaveLength(1)
	})

	it("(e) with nothing changed since, undo needs no revision and ignores one", async () => {
		const tools = instance(folder())
		const id = await chart(tools)
		ok(await tools.edit_chart({ id, patch: { subtitle: "A" } }))
		ok(await tools.undo_chart_edit({ id }))
		ok(await tools.edit_chart({ id, patch: { subtitle: "B" } }))
		ok(await tools.undo_chart_edit({ id, revision: '"unrelated"' }))
		expect(await subtitleOf(id)).toBe("")
	})

	it.each(["keep theirs", "undo over theirs", "combined", "leave it"])("(f) from a paused undo, %s in one call", async (way) => {
		const { tools, id, s0, theirs, p } = await pausedUndo()
		expect(p.message).toMatch(UNDO_CHOICES)
		if (way === "keep theirs") {
			ok(await tools.undo_chart_edit({ id, keepTheirs: true }))
			expect(await titleOf(id)).toBe("Theirs")
			expect(await yMinOf(id)).toBe(s0.channelConfigs.y?.min)
		} else if (way === "undo over theirs") {
			ok(await tools.undo_chart_edit({ id, revision: p.revision }))
			expect(await titleOf(id)).toBe(s0.labelsConfig.title)
			expect(await yMinOf(id)).toBe(s0.channelConfigs.y?.min)
		} else if (way === "combined") {
			ok(await tools.edit_chart({ id, revision: p.revision, patch: { title: "Theirs and T1" } }))
			expect(await titleOf(id)).toBe("Theirs and T1")
			expect(await yMinOf(id)).toBe(5)
		} else expect(bare((await stored(id)).visual)).toEqual(bare(theirs.visual))
	})
})

describe("TST-13: shared, durable, keyed history", () => {
	it("two copies share the steps both ways", async () => {
		const dir = folder()
		const a = instance(dir)
		const b = instance(dir)
		const id = await chart(a)
		const s0 = bare((await stored(id)).visual)
		ok(await a.edit_chart({ id, patch: { title: "A" } }))
		ok(await b.edit_chart({ id, patch: { subtitle: "B" } }))
		expect(readdirSync(dir)).toEqual([HISTORY_FILE])
		ok(await a.undo_chart_edit({ id }))
		expect(await subtitleOf(id)).toBe(s0.labelsConfig.subtitle)
		expect(await titleOf(id)).toBe("A")
		ok(await b.undo_chart_edit({ id }))
		expect(await titleOf(id)).toBe(s0.labelsConfig.title)
		no(await a.undo_chart_edit({ id }))
		no(await b.undo_chart_edit({ id }))
		expect(readdirSync(dir)).toEqual([HISTORY_FILE])
	})

	it("a restart undoes both edits", async () => {
		const dir = folder()
		const a = instance(dir)
		const id = await chart(a)
		const s0 = bare((await stored(id)).visual)
		ok(await a.edit_chart({ id, patch: { title: "One" } }))
		ok(await a.edit_chart({ id, patch: { title: "Two" } }))
		const restarted = instance(dir)
		ok(await restarted.undo_chart_edit({ id }))
		expect(await titleOf(id)).toBe("One")
		ok(await restarted.undo_chart_edit({ id }))
		expect(bare((await stored(id)).visual)).toEqual(s0)
	})

	it("21 edits keep 20 steps: 20 undos through a restart, the 21st refused", async () => {
		const dir = folder()
		const a = instance(dir)
		const id = await chart(a)
		for (let i = 1; i <= 21; i++) ok(await a.edit_chart({ id, patch: { title: `E${i}` } }))
		const restarted = instance(dir)
		for (let k = 1; k <= 20; k++) {
			ok(await restarted.undo_chart_edit({ id }))
			expect(await titleOf(id)).toBe(`E${21 - k}`)
		}
		expect(no(await restarted.undo_chart_edit({ id })).message).toMatch(/^Nothing is left to undo/)
		expect(await titleOf(id)).toBe("E1")
	}, 30_000)

	it("another server address, or another data format, sees none of it", async () => {
		const dir = folder()
		const a = instance(dir)
		const id = await chart(a)
		ok(await a.edit_chart({ id, patch: { title: "X" } }))
		const other = await startTestServer()
		try {
			expect(no(await instance(dir, { base: other.base }).undo_chart_edit({ id })).message).toMatch(/^Nothing is left/)
		} finally {
			other.close()
		}
		expect(no(await instance(dir, { formatVersion: VERSION + 1 }).undo_chart_edit({ id })).message).toMatch(
			/^Nothing is left/
		)
		expect(await titleOf(id)).toBe("X")
		ok(await a.undo_chart_edit({ id }))
	})

	it("a lock left by a dead copy, or one not kept fresh, is taken over well within 10 s", async () => {
		const dir = folder()
		const a = instance(dir)
		const id = await chart(a)
		ok(await a.edit_chart({ id, patch: { title: "One" } }))
		ok(await a.edit_chart({ id, patch: { title: "Two" } }))
		const dead = spawnSync(process.execPath, ["-e", ""]).pid
		writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: dead, nonce: "dead" }))
		let started = Date.now()
		ok(await instance(dir).undo_chart_edit({ id }))
		expect(Date.now() - started).toBeLessThan(10_000)
		// An alive pid (this one) whose hold went stale.
		writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: process.pid, nonce: "stale" }))
		const old = new Date(Date.now() - 20_000)
		utimesSync(join(dir, LOCK_FILE), old, old)
		started = Date.now()
		ok(await instance(dir).undo_chart_edit({ id }))
		expect(Date.now() - started).toBeLessThan(10_000)
		expect(readdirSync(dir)).toEqual([HISTORY_FILE])
	})

	it("resolves the state folder per platform and from the override", () => {
		expect(resolveStateDir({ VIS_STATE_DIR: "/tmp/zafiro-state" }, "darwin", "/Users/p")).toBe("/tmp/zafiro-state")
		expect(resolveStateDir({ VIS_STATE_DIR: "~/state" }, "linux", "/home/p")).toBe("/home/p/state")
		expect(resolveStateDir({ VIS_STATE_DIR: "relative" }, "darwin", "/Users/p")).toBe(
			"/Users/p/Library/Application Support/Zafiro MCP"
		)
		expect(resolveStateDir({}, "darwin", "/Users/p")).toBe("/Users/p/Library/Application Support/Zafiro MCP")
		expect(resolveStateDir({ LOCALAPPDATA: "C:\\Users\\p\\AppData\\Local" }, "win32", "C:\\Users\\p")).toBe(
			"C:\\Users\\p\\AppData\\Local\\Zafiro MCP"
		)
		expect(resolveStateDir({}, "win32", "C:\\Users\\p")).toBe("C:\\Users\\p\\AppData\\Local\\Zafiro MCP")
		expect(resolveStateDir({}, "linux", "/home/p")).toBe("/home/p/.local/state/zafiro-mcp")
		expect(resolveStateDir({ XDG_STATE_HOME: "/xdg" }, "linux", "/home/p")).toBe("/xdg/zafiro-mcp")
	})

	it("an edit writes the history into the override folder", async () => {
		const dir = folder()
		const previous = process.env.VIS_STATE_DIR
		process.env.VIS_STATE_DIR = dir
		try {
			const tools = createHandlers(createApi(server.base), { renderer: fakeRenderer() })
			const id = await chart(tools)
			ok(await tools.edit_chart({ id, patch: { title: "Here" } }))
			expect(stepsOf(dir, id)).toHaveLength(1)
		} finally {
			process.env.VIS_STATE_DIR = previous
		}
	})

	it("describes undo as this computer's edits, kept across restarts", () => {
		expect(TOOL_TEXT.undo_chart_edit.description).toMatch(
			/edits made through this MCP on this computer, kept across restarts/
		)
	})

	it("steps past 30 days are trimmed on start and never offered; younger ones remain", async () => {
		const dir = folder()
		const a = instance(dir)
		const id = await chart(a)
		ok(await a.edit_chart({ id, patch: { title: "Old" } }))
		ok(await a.edit_chart({ id, patch: { subtitle: "Young" } }))
		const file = historyOf(dir)
		file.servers[serverKey(server.base)][String(VERSION)].charts[id].steps[0].at = Date.now() - 31 * DAY
		writeFileSync(join(dir, HISTORY_FILE), JSON.stringify(file))
		const restarted = instance(dir)
		await restarted.started
		expect(stepsOf(dir, id)).toHaveLength(1)
		ok(await restarted.undo_chart_edit({ id }))
		expect(await subtitleOf(id)).toBe("")
		expect(no(await restarted.undo_chart_edit({ id })).message).toMatch(/^Nothing is left/)
		expect(await titleOf(id)).toBe("Old")
	})
})

describe("TST-14: order holds across copies", () => {
	it("A's held save, B waiting for the history, then two undos in landed order", async () => {
		const dir = folder()
		let id = ""
		let holdNext = false
		let release: () => void = () => {}
		let reached: () => void = () => {}
		const aReached = new Promise<void>((resolve) => (reached = resolve))
		const aFetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const response = await fetch(input, init)
			if (holdNext && init?.method === "PUT" && String(input).includes("/api/visuals/")) {
				holdNext = false
				reached()
				await new Promise<void>((resolve) => (release = resolve))
			}
			return response
		}) as typeof fetch
		const bCalls: string[] = []
		const bFetch = (async (input: string | URL | Request, init?: RequestInit) => {
			if (id && String(input).includes(`/api/visuals/${id}`)) bCalls.push(init?.method ?? "GET")
			return fetch(input, init)
		}) as typeof fetch
		const a = instance(dir, { fetchImpl: aFetch })
		const b = instance(dir, { fetchImpl: bFetch })
		id = await chart(a)
		holdNext = true
		const first = a.edit_chart({ id, patch: { title: "First" } })
		await aReached
		const second = b.edit_chart({ id, patch: { title: "Second" } })
		await sleep(300)
		expect(bCalls).toEqual([])
		release()
		ok(await first)
		ok(await second)
		expect(await titleOf(id)).toBe("Second")
		ok(await a.undo_chart_edit({ id }))
		expect(await titleOf(id)).toBe("First")
		ok(await a.undo_chart_edit({ id }))
		expect(await titleOf(id)).toBe("Rate by year")
	})

	it("an undo and an edit at once from two copies skip no step", async () => {
		const dir = folder()
		const a = instance(dir)
		const b = instance(dir)
		const id = await chart(a)
		const s0 = bare((await stored(id)).visual)
		ok(await a.edit_chart({ id, patch: { title: "e1" } }))
		ok(await a.edit_chart({ id, patch: { subtitle: "e2" } }))
		const [undone, edited] = await Promise.all([
			a.undo_chart_edit({ id }),
			b.edit_chart({ id, patch: { name: "e3" } }),
		])
		ok(undone)
		ok(edited)
		const left = stepsOf(dir, id).length
		expect([2, 3]).toContain(left)
		for (let i = 0; i < left; i++) ok(await a.undo_chart_edit({ id }))
		expect(no(await a.undo_chart_edit({ id })).message).toMatch(/^Nothing is left/)
		expect(bare((await stored(id)).visual)).toEqual(s0)
	})
})

describe("TST-15: crashes and history failures", () => {
	const jiti = join(__dirname, "../../node_modules/.bin/jiti")

	it.skipIf(!existsSync(jiti))("(a) a copy killed mid-undo before its save leaves the step", async () => {
		const dir = folder()
		const tools = instance(dir)
		const id = await chart(tools)
		const s0 = bare((await stored(id)).visual)
		ok(await tools.edit_chart({ id, patch: { title: "Edited" } }))
		const child = spawn(jiti, [join(__dirname, "undoChild.ts"), server.base, dir, id], {
			stdio: ["ignore", "pipe", "pipe"],
		})
		let stderr = ""
		child.stderr.on("data", (d) => (stderr += String(d)))
		await new Promise<void>((resolve, reject) => {
			child.stdout.on("data", (d) => {
				if (String(d).includes("put")) resolve()
			})
			child.on("exit", (code) => reject(new Error(`the child left (${code}) before its save: ${stderr}`)))
		})
		child.kill("SIGKILL")
		await once(child, "exit")
		expect(existsSync(join(dir, LOCK_FILE))).toBe(true)
		expect(await titleOf(id)).toBe("Edited")
		const started = Date.now()
		ok(await instance(dir).undo_chart_edit({ id }))
		expect(Date.now() - started).toBeLessThan(10_000)
		expect(bare((await stored(id)).visual)).toEqual(s0)
	}, 60_000)

	it("(b) an unwritable history: a saved edit is a success with no undo step; a held lock saves nothing", async () => {
		const dir = folder()
		const tools = instance(dir)
		const id = await chart(tools)
		ok(await tools.edit_chart({ id, patch: { title: "One" } }))
		chmodSync(dir, 0o555)
		try {
			const saved = ok(await tools.edit_chart({ id, patch: { title: "Two" } }))
			expect(saved.warnings.join(" ")).toMatch(/without an undo step/)
			expect(await titleOf(id)).toBe("Two")
		} finally {
			chmodSync(dir, 0o755)
		}
		writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: process.pid, nonce: "held" }))
		const busy = instance(dir, {
			history: createHistory({ dir, server: server.base, version: VERSION, lockWaitMs: 300 }),
		})
		expect(no(await busy.edit_chart({ id, patch: { title: "Three" } })).message).toMatch(/Nothing was saved: .*busy/)
		expect(await titleOf(id)).toBe("Two")
	})

	it("(c) an undo whose save the server rejects is an error and keeps its step", async () => {
		let reject = false
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
			if (reject && init?.method === "PUT" && String(input).includes("/api/visuals/"))
				return new Response("boom", { status: 500 })
			return fetch(input, init)
		}) as typeof fetch
		const dir = folder()
		const tools = instance(dir, { fetchImpl })
		const id = await chart(tools)
		ok(await tools.edit_chart({ id, patch: { title: "One" } }))
		reject = true
		expect(no(await tools.undo_chart_edit({ id })).message).toMatch(/failed: 500/)
		expect(stepsOf(dir, id)).toHaveLength(1)
		reject = false
		ok(await tools.undo_chart_edit({ id }))
		expect(await titleOf(id)).toBe("Rate by year")
	})
})
