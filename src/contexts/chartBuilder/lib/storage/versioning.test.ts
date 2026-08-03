import { describe, expect, it, vi } from "vitest"
import { stringifyJsonDangerous } from "../../../../lib/json"

import { loadVersioned, saveVersioned, type Migration } from "./versioning"

const stringify = (v: unknown): string => stringifyJsonDangerous(v as never)
const parse = (v: string): unknown => JSON.parse(v) as unknown

/** In-memory Storage shim. Each test gets a fresh one so cases can't
 *  leak data into each other. */
const makeStorage = (): Storage => {
	const map = new Map<string, string>()
	return {
		get length() {
			return map.size
		},
		clear: () => map.clear(),
		getItem: (k) => (map.has(k) ? map.get(k)! : null),
		key: (i) => [...map.keys()][i] ?? null,
		removeItem: (k) => {
			map.delete(k)
		},
		setItem: (k, v) => {
			map.set(k, String(v))
		},
	}
}

/** Mute logger that lets tests assert what *would* have been logged. */
const makeLogger = () => ({
	warn: vi.fn(),
	error: vi.fn(),
})

describe("loadVersioned", () => {
	it("returns fallback when nothing is stored", () => {
		const storage = makeStorage()
		const logger = makeLogger()
		const result = loadVersioned<number>({
			key: "missing",
			currentVersion: 1,
			migrations: [],
			fallback: 42,
			storage,
			logger,
		})
		expect(result).toBe(42)
		expect(logger.error).not.toHaveBeenCalled()
	})

	it("returns the stored value when version matches current", () => {
		const storage = makeStorage()
		storage.setItem("k", stringify({ _v: 2, data: { name: "bob" } }))
		const logger = makeLogger()
		const result = loadVersioned<{ name: string }>({
			key: "k",
			currentVersion: 2,
			migrations: [() => ({ wrong: true }), () => ({ wrong: true })],
			fallback: { name: "fallback" },
			storage,
			logger,
		})
		expect(result).toEqual({ name: "bob" })
		// No migration should have run since version === current.
		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
	})

	it("treats an unversioned stored value as v0 and runs migrations forward", () => {
		const storage = makeStorage()
		// Legacy shape: plain array, no _v wrapper.
		storage.setItem("k", stringify([{ id: "a" }, { id: "b" }]))
		const migrations: Migration[] = [
			// v0 -> v1: tag each item with a version marker so we can assert
			// the migration ran.
			(raw) => (raw as Array<{ id: string }>).map((x) => ({ ...x, mig: 1 })),
		]
		const logger = makeLogger()
		const result = loadVersioned<Array<{ id: string; mig: number }>>({
			key: "k",
			currentVersion: 1,
			migrations,
			fallback: [],
			storage,
			logger,
		})
		expect(result).toEqual([
			{ id: "a", mig: 1 },
			{ id: "b", mig: 1 },
		])
		// Upgraded shape should have been persisted back so subsequent
		// loads can skip the migration.
		const rewritten = parse(storage.getItem("k")!) as {
			_v: number
			data: unknown
		}
		expect(rewritten._v).toBe(1)
		expect(rewritten.data).toEqual([
			{ id: "a", mig: 1 },
			{ id: "b", mig: 1 },
		])
	})

	it("runs multiple migrations in sequence to bridge a multi-version gap", () => {
		const storage = makeStorage()
		storage.setItem("k", stringify({ _v: 1, data: { step: 1 } }))
		const migrations: Migration[] = [
			// index 0: v0 -> v1 (won't run; stored at v1 already)
			() => ({ step: "should not run" }),
			// index 1: v1 -> v2
			(raw) => ({ ...(raw as { step: number }), step: 2 }),
			// index 2: v2 -> v3
			(raw) => ({ ...(raw as { step: number }), step: 3 }),
		]
		const result = loadVersioned<{ step: number }>({
			key: "k",
			currentVersion: 3,
			migrations,
			fallback: { step: 0 },
			storage,
		})
		expect(result).toEqual({ step: 3 })
	})

	it("falls back when the stored version is newer than current (deploy rollback)", () => {
		const storage = makeStorage()
		storage.setItem("k", stringify({ _v: 99, data: { future: true } }))
		const logger = makeLogger()
		const result = loadVersioned<{ ok: boolean }>({
			key: "k",
			currentVersion: 1,
			migrations: [],
			fallback: { ok: false },
			storage,
			logger,
		})
		expect(result).toEqual({ ok: false })
		expect(logger.warn).toHaveBeenCalledOnce()
	})

	it("falls back when JSON.parse throws", () => {
		const storage = makeStorage()
		storage.setItem("k", "{not valid json")
		const logger = makeLogger()
		const result = loadVersioned<number>({
			key: "k",
			currentVersion: 1,
			migrations: [],
			fallback: 0,
			storage,
			logger,
		})
		expect(result).toBe(0)
		expect(logger.error).toHaveBeenCalledOnce()
	})

	it("falls back when a migration throws", () => {
		const storage = makeStorage()
		storage.setItem("k", stringify({ _v: 0, data: { id: "a" } }))
		const logger = makeLogger()
		const result = loadVersioned<unknown>({
			key: "k",
			currentVersion: 1,
			migrations: [
				() => {
					throw new Error("migration boom")
				},
			],
			fallback: { id: "fallback" },
			storage,
			logger,
		})
		expect(result).toEqual({ id: "fallback" })
		expect(logger.error).toHaveBeenCalledOnce()
	})

	it("falls back when validate() rejects the migrated value", () => {
		const storage = makeStorage()
		storage.setItem("k", stringify({ _v: 1, data: { kind: "unexpected" } }))
		const logger = makeLogger()
		const result = loadVersioned<{ kind: "expected" }>({
			key: "k",
			currentVersion: 1,
			migrations: [],
			fallback: { kind: "expected" },
			validate: (d): d is { kind: "expected" } =>
				typeof d === "object" &&
				d !== null &&
				(d as { kind: string }).kind === "expected",
			storage,
			logger,
		})
		expect(result).toEqual({ kind: "expected" })
		expect(logger.warn).toHaveBeenCalledOnce()
	})
})

describe("saveVersioned", () => {
	it("writes a versioned wrapper around the data", () => {
		const storage = makeStorage()
		saveVersioned({
			key: "k",
			currentVersion: 3,
			data: { name: "bob" },
			storage,
		})
		const raw = storage.getItem("k")
		expect(raw).not.toBeNull()
		const parsed = parse(raw!) as { _v: number; data: unknown }
		expect(parsed._v).toBe(3)
		expect(parsed.data).toEqual({ name: "bob" })
	})

	it("logs (and doesn't throw) when setItem fails", () => {
		// Simulate a quota-exceeded scenario.
		const broken: Storage = {
			get length() {
				return 0
			},
			clear: () => {},
			getItem: () => null,
			key: () => null,
			removeItem: () => {},
			setItem: () => {
				throw new Error("QuotaExceededError")
			},
		}
		const logger = makeLogger()
		// Should not throw.
		saveVersioned({
			key: "k",
			currentVersion: 1,
			data: {},
			storage: broken,
			logger,
		})
		expect(logger.error).toHaveBeenCalledOnce()
	})
})
