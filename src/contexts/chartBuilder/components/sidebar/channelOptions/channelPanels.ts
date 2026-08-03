import { createElement, type ComponentType } from "react"

import {
	AngleOptionsPanel,
	LengthOptionsPanel,
} from "./AngleLengthPanel"
import { AxisOptionsPanel } from "./AxisOptionsPanel"
import { ConnectionOptionsPanel } from "./ConnectionOptionsPanel"
import { FacetColOptionsPanel } from "./FacetColOptionsPanel"
import { FacetOptionsPanel } from "./FacetOptionsPanel"
import { FacetRowOptionsPanel } from "./FacetRowOptionsPanel"
import {
	PatternOptionsPanel,
	ShapeOptionsPanel,
} from "./GlyphPickerPanel"
import { ColorPanel } from "./ColorPanel"
import { OpacityOptionsPanel } from "./OpacityOptionsPanel"
import { OutlineHueOptionsPanel } from "./OutlineHuePanel"
import {
	AreaOptionsPanel,
	BrightnessOptionsPanel,
	SaturationOptionsPanel,
} from "./RangePanel"
import { TextOptionsPanel } from "./TextOptionsPanel"
import type { EncodingChannel } from "../../../lib/types"

// Thin wrappers so every channel's panel entry is a zero-prop ComponentType.
// AxisOptionsPanel is shared by x, y, and r but needs its axis pre-selected;
// createElement avoids dragging JSX into a .ts file.
const XAxisOptionsPanel: ComponentType = () =>
	createElement(AxisOptionsPanel, { channel: "x" })
const YAxisOptionsPanel: ComponentType = () =>
	createElement(AxisOptionsPanel, { channel: "y" })
const RAxisOptionsPanel: ComponentType = () =>
	createElement(AxisOptionsPanel, { channel: "r" })

/** Per-channel options-panel components. Lives on the components side
 * (NOT in lib/) so `lib/channels` stays React-free — importing panel
 * components from lib would pull the sidebar tree into every pure
 * consumer of channel metadata. One entry per `EncodingChannel`. */
export const CHANNEL_PANELS: Record<EncodingChannel, ComponentType> = {
	x: XAxisOptionsPanel,
	y: YAxisOptionsPanel,
	r: RAxisOptionsPanel,
	facet: FacetOptionsPanel,
	facetRow: FacetRowOptionsPanel,
	facetCol: FacetColOptionsPanel,
	hue: ColorPanel,
	outlineHue: OutlineHueOptionsPanel,
	length: LengthOptionsPanel,
	connection: ConnectionOptionsPanel,
	opacity: OpacityOptionsPanel,
	area: AreaOptionsPanel,
	shape: ShapeOptionsPanel,
	angle: AngleOptionsPanel,
	saturation: SaturationOptionsPanel,
	brightness: BrightnessOptionsPanel,
	pattern: PatternOptionsPanel,
	text: TextOptionsPanel,
}
