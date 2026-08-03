import { describe, expect, it } from "vitest"
import type { ChannelConfigs } from "./channelConfig"
import type { Encodings } from "./types"
import {
	mappedStackChannels,
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
