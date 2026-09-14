/**
 * Evenly spaced tick positions for a continuous axis whose BOTH bounds the
 * user pinned (Scale range min + max). d3's `scale.ticks(n)` treats `n` as
 * a density hint and snaps to "nice" 1/2/5 steps, so a pinned 0.04–0.24
 * axis asked for 6 ticks yields 0.05, 0.10, 0.15, 0.20 — neither the count
 * nor the ends the user typed. When the ends are deliberate, the honest
 * layout is `count` ticks from min to max inclusive, both ends included.
 *
 * Values are rounded to 12 significant digits so `0.04 + 2 × 0.04` reads
 * `0.12`, not `0.12000000000000001`. Temporal callers pass epoch ms and
 * wrap the result back into Dates.
 */
export const evenlySpacedTicks = (
	lo: number,
	hi: number,
	count: number
): number[] => {
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) return []
	const n = Math.floor(count)
	if (n <= 0) return []
	if (n === 1 || lo === hi) return [lo]
	const step = (hi - lo) / (n - 1)
	const out: number[] = []
	for (let i = 0; i < n; i++) {
		// Land the last tick exactly on `hi` rather than on `lo + (n-1)·step`,
		// which can drift a hair off after float accumulation.
		const v = i === n - 1 ? hi : lo + i * step
		out.push(Number(v.toPrecision(12)))
	}
	return out
}
