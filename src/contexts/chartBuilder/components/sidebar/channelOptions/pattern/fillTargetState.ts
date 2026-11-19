import type { PatternConfig } from "../../../../lib/channelConfig"
import type { PATTERN_NONE } from "../../../../lib/patterns"
import type { FillTargetPatternKeys } from "../../../../lib/resolveLayerColor"

export const nonEmptyMap = (m?: Record<string, unknown>): boolean =>
	!!m && Object.keys(m).length > 0

/** Separate fill targets — the radar polygon body, the violin / box body and
 *  an area chart's points — keep the same shapes as the point-fill
 *  `overrides` / `inkColors` / `scales` / `rotations` / `defaultPattern` set,
 *  stored beside them on the pattern config so no two picks ever share an
 *  index. One accessor per target. */
export const fillTargetState = (
	cfg: PatternConfig,
	updateCfg: (next: Partial<PatternConfig>) => void,
	keys: FillTargetPatternKeys
) => {
	const overrides = cfg[keys.overrides] ?? {}
	const inkColors = cfg[keys.inkColors] ?? {}
	const scales = cfg[keys.scales] ?? {}
	const rotations = cfg[keys.rotations] ?? {}
	const write = (next: Record<string, unknown>) =>
		updateCfg(next as Partial<PatternConfig>)
	const without = <V,>(m: Record<string, V>, value: string) => {
		const { [value]: _removed, ...rest } = m
		return rest
	}
	return {
		overrides,
		inkColors,
		scales,
		rotations,
		setOverride: (value: string, idx: number | typeof PATTERN_NONE) =>
			write({ [keys.overrides]: { ...overrides, [value]: idx } }),
		resetOverride: (value: string) =>
			write({ [keys.overrides]: without(overrides, value) }),
		setInk: (value: string, color: string) =>
			write({ [keys.inkColors]: { ...inkColors, [value]: color } }),
		resetInk: (value: string) =>
			write({ [keys.inkColors]: without(inkColors, value) }),
		setScale: (value: string, scale: number) =>
			write({ [keys.scales]: { ...scales, [value]: scale } }),
		resetScale: (value: string) =>
			write({ [keys.scales]: without(scales, value) }),
		setRotation: (value: string, rotation: number) =>
			write({ [keys.rotations]: { ...rotations, [value]: rotation } }),
		resetRotation: (value: string) =>
			write({ [keys.rotations]: without(rotations, value) }),
		defaultIdx: cfg[keys.defaultPattern] ?? null,
		defaultInk: cfg[keys.defaultInk] ?? null,
		defaultScale: cfg[keys.defaultScale] ?? null,
		defaultRotation: cfg[keys.defaultRotation] ?? null,
		setDefaultIdx: (next: number | null) =>
			write({ [keys.defaultPattern]: next }),
		setDefaultInk: (next: string | null) =>
			write({ [keys.defaultInk]: next }),
		setDefaultScale: (next: number | null) =>
			write({ [keys.defaultScale]: next }),
		setDefaultRotation: (next: number | null) =>
			write({ [keys.defaultRotation]: next }),
		/** The panel-wide reset's patch for this target's defaults. */
		clearDefaults: {
			[keys.defaultPattern]: null,
			[keys.defaultInk]: null,
			[keys.defaultScale]: null,
			[keys.defaultRotation]: null,
		} as Partial<PatternConfig>,
	}
}
export type FillTargetState = ReturnType<typeof fillTargetState>

export const targetSubsectionChanged = (
	t: FillTargetState,
	mapped: boolean
): boolean =>
	mapped
		? nonEmptyMap(t.overrides) ||
			nonEmptyMap(t.inkColors) ||
			nonEmptyMap(t.scales) ||
			nonEmptyMap(t.rotations)
		: t.defaultIdx !== null ||
			t.defaultInk !== null ||
			t.defaultScale !== null ||
			t.defaultRotation !== null
