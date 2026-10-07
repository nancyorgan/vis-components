/* eslint-disable no-restricted-globals, @th/no-storage-outside-try -- tests seed localStorage deliberately */
import { beforeEach, describe, expect, it } from "vitest"

import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { DEFAULT_CAPTION_CONFIG } from "./captionConfig"
import { DEFAULT_DATA_LABELS_CONFIG } from "./channelConfig"
import { DEFAULT_LEGEND_CONFIG, DEFAULT_TOOLTIP_CONFIG } from "./labelsConfig"
import {
	loadCurrentCaption,
	loadCurrentDataLabelsConfig,
	loadCurrentLegend,
	loadCurrentTooltip,
} from "./storage"
import {
	CAPTION_VERSION,
	DATA_LABELS_CONFIG_VERSION,
	LEGEND_VERSION,
	TOOLTIP_VERSION,
} from "./storage/migrations"

/** The draft-slice loaders (the `current*` editor state) default-merge the
 *  stored value over the slice's DEFAULT config, mirroring what
 *  `useLoadVisual` does for saved visuals. `loadVersioned`'s `fallback`
 *  only covers an ABSENT key: a draft written before a required field was
 *  added would otherwise hydrate with that field `undefined` and every
 *  reader of it would have to defend against the hole. Each case stores a
 *  draft at the CURRENT version (so no migration runs) that is missing a
 *  required field, and checks the default fills it while the stored fields
 *  survive untouched. */

const KEY_CURRENT_LEGEND = "vis-components:currentLegend"
const KEY_CURRENT_TOOLTIP = "vis-components:currentTooltip"
const KEY_CURRENT_DATA_LABELS_CONFIG = "vis-components:currentDataLabelsConfig"
const KEY_CURRENT_CAPTION = "vis-components:currentCaption"

const write = (key: string, value: unknown) =>
	/* eslint-disable-next-line @th/use-wrapped-json-functions */
	localStorage.setItem(key, JSON.stringify(value))

beforeEach(() => {
	installInMemoryLocalStorage()
})

describe("draft-slice loaders default-merge a partial stored draft", () => {
	it("loadCurrentLegend fills a missing `orientation` from the default", () => {
		const { orientation: _dropped, ...partial } = DEFAULT_LEGEND_CONFIG
		write(KEY_CURRENT_LEGEND, {
			_v: LEGEND_VERSION,
			data: { ...partial, position: "bottom" },
		})
		const loaded = loadCurrentLegend()
		expect(loaded.orientation).toBe(DEFAULT_LEGEND_CONFIG.orientation)
		expect(loaded.position).toBe("bottom")
		expect(loaded).toEqual({ ...DEFAULT_LEGEND_CONFIG, position: "bottom" })
	})

	it("loadCurrentTooltip fills a missing `hoverEnabled` from the default", () => {
		const { hoverEnabled: _dropped, ...partial } = DEFAULT_TOOLTIP_CONFIG
		write(KEY_CURRENT_TOOLTIP, {
			_v: TOOLTIP_VERSION,
			data: { ...partial, customCss: ".tip { color: red }" },
		})
		const loaded = loadCurrentTooltip()
		expect(loaded.hoverEnabled).toBe(DEFAULT_TOOLTIP_CONFIG.hoverEnabled)
		expect(loaded.customCss).toBe(".tip { color: red }")
		expect(loaded).toEqual({
			...DEFAULT_TOOLTIP_CONFIG,
			customCss: ".tip { color: red }",
		})
	})

	it("loadCurrentDataLabelsConfig fills a missing `fontWeight` from the default", () => {
		const { fontWeight: _dropped, ...partial } = DEFAULT_DATA_LABELS_CONFIG
		write(KEY_CURRENT_DATA_LABELS_CONFIG, {
			_v: DATA_LABELS_CONFIG_VERSION,
			data: { ...partial, fontSize: 17 },
		})
		const loaded = loadCurrentDataLabelsConfig()
		expect(loaded.fontWeight).toBe(DEFAULT_DATA_LABELS_CONFIG.fontWeight)
		expect(loaded.fontSize).toBe(17)
		expect(loaded).toEqual({ ...DEFAULT_DATA_LABELS_CONFIG, fontSize: 17 })
	})

	it("loadCurrentCaption fills a missing `widthUnit` from the default", () => {
		const { widthUnit: _dropped, ...partial } = DEFAULT_CAPTION_CONFIG
		write(KEY_CURRENT_CAPTION, {
			_v: CAPTION_VERSION,
			data: { ...partial, text: "Source: census" },
		})
		const loaded = loadCurrentCaption()
		expect(loaded.widthUnit).toBe(DEFAULT_CAPTION_CONFIG.widthUnit)
		expect(loaded.text).toBe("Source: census")
		expect(loaded).toEqual({ ...DEFAULT_CAPTION_CONFIG, text: "Source: census" })
	})

	it("returns the full default when no draft is stored at all", () => {
		expect(loadCurrentLegend()).toEqual(DEFAULT_LEGEND_CONFIG)
		expect(loadCurrentTooltip()).toEqual(DEFAULT_TOOLTIP_CONFIG)
		expect(loadCurrentDataLabelsConfig()).toEqual(DEFAULT_DATA_LABELS_CONFIG)
		expect(loadCurrentCaption()).toEqual(DEFAULT_CAPTION_CONFIG)
	})
})
