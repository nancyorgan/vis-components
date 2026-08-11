import { describe, expect, it } from "vitest"
import type { ChannelConfigs, OpacityConfig } from "./channelConfig"
import type { Encodings } from "./types"
import {
	mappedStackChannels,
	preserveStackMode,
	resolveStackModes,
} from "./stackMode"

const enc = (m: Partial<Record<string, string>>): Encodings =>
	Object.fromEntries(
		Object.entries(m).map(([k, field]) => [k, { field }])
	) as Encodings

describe("resolveStackModes", () => {
	it("returns mapped channels in precedence order with their modes", () => {
		const encodings = enc({ hue: "region", pattern: "year" })
		const configs = {
			hue: { stackMode: "group" },
			pattern: { stackMode: "stack" },
		} as unknown as ChannelConfigs
		expect(resolveStackModes(configs, encodings)).toEqual([
			{ channel: "hue", mode: "group" },
			{ channel: "pattern", mode: "stack" },
		])
	})

	it("defaults an unset channel's mode to stack", () => {
		const encodings = enc({ hue: "region", pattern: "year" })
		const configs = { hue: { stackMode: "group" } } as unknown as ChannelConfigs
		expect(resolveStackModes(configs, encodings)).toEqual([
			{ channel: "hue", mode: "group" },
			{ channel: "pattern", mode: "stack" },
		])
	})

	it("omits unmapped channels", () => {
		const encodings = enc({ hue: "region" })
		const configs = { hue: { stackMode: "overlay" } } as unknown as ChannelConfigs
		expect(resolveStackModes(configs, encodings)).toEqual([
			{ channel: "hue", mode: "overlay" },
		])
	})
})

describe("mappedStackChannels", () => {
	it("returns every mapped stack channel in precedence order", () => {
		const encodings = enc({ pattern: "year", hue: "region" })
		expect(mappedStackChannels(encodings)).toEqual(["hue", "pattern"])
	})

	it("includes BOTH channels even when they share the same field", () => {
		const encodings = enc({ hue: "region", pattern: "region" })
		expect(mappedStackChannels(encodings)).toEqual(["hue", "pattern"])
	})

	it("returns a single channel when only one is mapped", () => {
		expect(mappedStackChannels(enc({ hue: "region" }))).toEqual(["hue"])
	})

	it("returns empty when none mapped", () => {
		expect(mappedStackChannels(enc({}))).toEqual([])
	})
})

describe("preserveStackMode", () => {
	it("carries the stored stackMode onto a rebuilt config that dropped it", () => {
		// The repro: per-category opacity edit rebuilds the config without
		// stackMode — the user's Group choice must survive.
		const prev: OpacityConfig = {
			kind: "categorical",
			overrides: {},
			stackMode: "group",
		}
		const next: OpacityConfig = { kind: "categorical", overrides: { A: 0.5 } }
		expect(preserveStackMode(prev, next)).toEqual({
			kind: "categorical",
			overrides: { A: 0.5 },
			stackMode: "group",
		})
	})

	it("the stored stackMode wins over a stale one on the replacement (stash restore)", () => {
		const prev: OpacityConfig = {
			kind: "categorical",
			overrides: {},
			stackMode: "group",
		}
		const next: OpacityConfig = {
			kind: "quantitative",
			min: 0,
			max: 1,
			stackMode: "stack",
		}
		expect(preserveStackMode(prev, next).stackMode).toBe("group")
	})

	it("survives a kind switch (categorical stackMode onto a quantitative rebuild)", () => {
		const prev: OpacityConfig = {
			kind: "categorical",
			overrides: {},
			stackMode: "overlay",
		}
		const next: OpacityConfig = { kind: "quantitative", min: 0.2, max: 1 }
		expect(preserveStackMode(prev, next)).toEqual({
			kind: "quantitative",
			min: 0.2,
			max: 1,
			stackMode: "overlay",
		})
	})

	it("returns next unchanged when no prior stackMode exists", () => {
		const prev: OpacityConfig = { kind: "categorical", overrides: {} }
		const next: OpacityConfig = { kind: "categorical", overrides: {} }
		expect(preserveStackMode(undefined, next)).toBe(next)
		expect(preserveStackMode(prev, next)).toBe(next)
	})
})
