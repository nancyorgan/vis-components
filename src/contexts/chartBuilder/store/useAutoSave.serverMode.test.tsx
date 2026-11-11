import { act, cleanup, render } from "@testing-library/react"
import { useAtomValue } from "jotai"
import { useEffect, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { stringifyJsonDangerous } from "../../../lib/json"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { EMPTY_CHANNEL_CONFIGS } from "../lib/channelConfig"
import { localStorageAdapter } from "../lib/storage/adapter"
import { createHttpStorageAdapter } from "../lib/storage/httpAdapter"
import { CONTENT_MIGRATIONS } from "../lib/storage/migrations"
import { setStorageAdapter } from "../lib/storage/registry"
import { SYSTEM_LIGHT_THEME } from "../lib/systemThemes"
import { labelsFromTheme } from "../lib/themeConfig"
import { emptyEncodings, type Visual } from "../lib/types"
import { currentVisualNameAtom, visualsHydratedAtom } from "./atoms"
import { useEditorHistory, useUndo } from "./editorHistory"
import { useLoadVisual, useRefreshStoredVisual } from "./saveVisual"
import { useAutoSave } from "./useAutoSave"

/** Autosave in server mode, end to end through the real save, the real
 *  loader steps and the real HTTP adapter (fetch stubbed): only a REAL
 *  change of the draft writes. The loader is the PARENT of the component
 *  running autosave, exactly as VisualLoaderForExisting is EditorLayout's
 *  — so the child's effects run first and the hydration lands after
 *  autosave mounted, which is what used to look like an edit. */

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }))
vi.mock("./republishVisual", () => ({ useRepublishVisual: () => vi.fn() }))
vi.mock("./useEffectiveGeographyLevel", () => ({
	useEffectiveGeographyLevel: () => "states",
}))
vi.mock("../lib/captureThumbnail", () => ({ captureThumbnail: async () => null }))

const stored = (over: Partial<Visual> = {}): Visual => ({
	id: "v1",
	name: "Chart",
	folderId: null,
	datasetId: "ds-1",
	createdAtVersionId: "dv-1",
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: labelsFromTheme(SYSTEM_LIGHT_THEME),
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
	...over,
})

const json = (body: unknown) =>
	({
		ok: true,
		status: 200,
		json: async () => body,
		text: async () => stringifyJsonDangerous(body as never),
	}) as unknown as Response

const status = (code: number) => ({ ok: code < 300, status: code }) as unknown as Response

const VERSIONS = Object.fromEntries(
	Object.entries(CONTENT_MIGRATIONS).map(([c, spec]) => [c, spec.currentVersion])
)

/** The server: `list` is what the session's list load saw, `fresh` what
 *  `GET /api/visuals/v1` answers now (a number = that status). Visual PUTs
 *  answer `putResult()` — a status, or a promise the test settles. */
const serve = (opts: {
	list: Visual[]
	fresh: Visual | number
	putResult?: () => number | Promise<number>
}) => {
	const puts: Array<{ name: string }> = []
	const mock = vi.fn(async (path: string, init?: RequestInit) => {
		const method = init?.method ?? "GET"
		if (method === "GET") {
			if (path === "/api/content-versions") return json(VERSIONS)
			if (path.startsWith("/api/visuals/v1"))
				return typeof opts.fresh === "number" ? status(opts.fresh) : json(opts.fresh)
			if (path.startsWith("/api/visuals")) return json(opts.list)
			if (path.startsWith("/api/datasets")) return json({})
			if (path.startsWith("/api/embed-instances")) return json({})
			return json([])
		}
		if (method === "PUT" && path === "/api/visuals/v1") {
			puts.push(JSON.parse(init?.body as string) as { name: string })
			return status(await (opts.putResult?.() ?? 204))
		}
		return status(204)
	})
	vi.stubGlobal("fetch", mock)
	return { mock, puts }
}

/** VisualLoaderForExisting's open, minus the router. */
const Loader = ({ children }: { children: ReactNode }) => {
	const hydrated = useAtomValue(visualsHydratedAtom)
	const refresh = useRefreshStoredVisual()
	const load = useLoadVisual()
	useEffect(() => {
		if (!hydrated) return
		void (async () => {
			await refresh("v1")
			await load("v1")
		})()
	}, [hydrated, refresh, load])
	return <>{children}</>
}

const handles: { undo: () => boolean } = { undo: () => false }
const Editor = () => {
	useEditorHistory()
	useAutoSave()
	const undo = useUndo()
	useEffect(() => {
		handles.undo = undo
	}, [undo])
	return null
}

const flush = async (ms = 0) => {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms)
	})
}

const open = async () => {
	let store!: TestStore
	render(
		<TestProvider initializeState={(s) => (store = s)}>
			<Loader>
				<Editor />
			</Loader>
		</TestProvider>
	)
	// List load, fresh read, hydration.
	await flush(10)
	return store
}

const rename = (store: TestStore, name: string) =>
	act(() => {
		store.set(currentVisualNameAtom, name)
	})

beforeEach(() => {
	installInMemoryLocalStorage()
	vi.useFakeTimers()
	setStorageAdapter(createHttpStorageAdapter())
})

afterEach(() => {
	cleanup()
	setStorageAdapter(localStorageAdapter)
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe("autosave saves only a real change (server mode)", () => {
	it("opening an existing visual writes nothing, and opens the server's latest copy", async () => {
		const { mock, puts } = serve({
			list: [stored({ name: "Old name" })],
			fresh: stored({ name: "Edited elsewhere", updatedAt: 50 }),
		})
		const store = await open()
		expect(store.get(currentVisualNameAtom)).toBe("Edited elsewhere")
		await flush(3000)
		expect(puts).toEqual([])
		expect(
			mock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method)
		).toEqual([])
	})

	it("falls back to the in-memory copy on an older server (405) and still writes nothing", async () => {
		const { puts } = serve({ list: [stored({ name: "Listed" })], fresh: 405 })
		const store = await open()
		expect(store.get(currentVisualNameAtom)).toBe("Listed")
		await flush(3000)
		expect(puts).toEqual([])
	})

	it("one change saves exactly once", async () => {
		const { puts } = serve({ list: [stored()], fresh: stored() })
		const store = await open()
		rename(store, "Renamed")
		await flush(3000)
		expect(puts.map((p) => p.name)).toEqual(["Renamed"])
	})

	it("a change put back before the debounce saves nothing", async () => {
		const { puts } = serve({ list: [stored()], fresh: stored() })
		const store = await open()
		rename(store, "Renamed")
		await flush(300)
		rename(store, "Chart")
		await flush(3000)
		expect(puts).toEqual([])
	})

	it("an edit undone back to the saved state saves nothing", async () => {
		const { puts } = serve({ list: [stored()], fresh: stored() })
		const store = await open()
		rename(store, "Renamed")
		await flush(100)
		act(() => {
			expect(handles.undo()).toBe(true)
		})
		expect(store.get(currentVisualNameAtom)).toBe("Chart")
		await flush(3000)
		expect(puts).toEqual([])
	})

	it("a failed save is not counted: returning to that draft later saves it", async () => {
		let failing = true
		const { puts } = serve({
			list: [stored()],
			fresh: stored(),
			putResult: () => (failing ? 500 : 204),
		})
		vi.spyOn(console, "error").mockImplementation(() => {})
		const store = await open()
		rename(store, "Renamed")
		await flush(3000)
		expect(puts.map((p) => p.name)).toEqual(["Renamed"])

		failing = false
		rename(store, "Something else")
		await flush(200)
		rename(store, "Renamed")
		await flush(3000)
		expect(puts.map((p) => p.name)).toEqual(["Renamed", "Renamed"])
	})

	it("an edit undone while its save is in flight saves the undone state", async () => {
		let release!: () => void
		let first = true
		const { puts } = serve({
			list: [stored()],
			fresh: stored(),
			putResult: () => {
				if (!first) return 204
				first = false
				return new Promise<number>((resolve) => {
					release = () => resolve(204)
				})
			},
		})
		const store = await open()
		rename(store, "Renamed")
		await flush(1000)
		expect(puts.map((p) => p.name)).toEqual(["Renamed"])

		// Undo while the PUT is still out.
		act(() => {
			expect(handles.undo()).toBe(true)
		})
		await flush(3000)
		expect(puts).toHaveLength(1)

		// It lands; the draft no longer matches what it wrote, so it saves.
		await act(async () => {
			release()
		})
		await flush(3000)
		expect(puts.map((p) => p.name)).toEqual(["Renamed", "Chart"])
	})
})
