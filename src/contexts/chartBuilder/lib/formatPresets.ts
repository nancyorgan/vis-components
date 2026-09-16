/** Dropdown value for the "Auto" preset in every format dropdown. Selecting
 *  it clears the stored spec to "" — the empty string is what every
 *  formatter reads as "fall back to the default format", so it can't be the
 *  option value itself (that's the "— Pick a preset —" placeholder). */
export const FORMAT_PRESET_AUTO = "__auto__"

/** Maps a raw format-dropdown selection onto the spec to store: the Auto
 *  sentinel clears to "", the placeholder is a no-op (returns null), any
 *  other value is the spec verbatim. */
export const formatPresetSelection = (value: string): string | null => {
	if (value === FORMAT_PRESET_AUTO) return ""
	if (value === "") return null
	return value
}
