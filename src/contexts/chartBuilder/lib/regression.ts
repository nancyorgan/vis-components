/** Polynomial least-squares regression (linear = degree 1) with pointwise
 * confidence intervals for the mean response. Powers the scatter plot's
 * regression-line overlay. Self-contained — no dependency beyond stdlib.
 *
 * Numerical approach: x values are centered and scaled to unit variance
 * before building the Vandermonde design matrix, so the normal equations stay
 * well-conditioned even for offset data (e.g. years 2000–2026) and higher
 * degrees. The reported `coefficients` are mapped back to original x units;
 * `predict`/`ciAt` evaluate in the stable centered basis. */

export type RegressionFit = {
	/** Polynomial coefficients in ORIGINAL x units: y = c0 + c1·x + c2·x² … */
	coefficients: number[]
	/** Fitted mean response at x. */
	predict: (x: number) => number
	/** Pointwise confidence interval for the MEAN response at x, at
	 * `level` in (0, 1) (e.g. 0.95). Returns null when the fit is saturated
	 * (n ≤ degree + 1, no residual degrees of freedom) or level is invalid. */
	ciAt: (x: number, level: number) => [number, number] | null
	/** [min, max] of the x values the fit was computed from. */
	xExtent: [number, number]
	/** Number of points used in the fit. */
	n: number
}

/** Fit a degree-`degree` polynomial to `points` by least squares. Returns
 * null when the fit is underdetermined or degenerate: fewer than degree + 1
 * finite points, zero x-variance, or a singular solve. */
export const fitPolynomial = (
	points: Array<[number, number]>,
	degree: number
): RegressionFit | null => {
	const deg = Math.max(1, Math.floor(degree))
	const pts = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
	const n = pts.length
	const p = deg + 1
	if (n < p) return null

	const xs = pts.map(([x]) => x)
	const ys = pts.map(([, y]) => y)
	const meanX = xs.reduce((a, b) => a + b, 0) / n
	const sdX = Math.sqrt(xs.reduce((a, x) => a + (x - meanX) ** 2, 0) / n)
	if (!(sdX > 0)) return null
	const t = (x: number): number => (x - meanX) / sdX

	// Design matrix rows in the centered basis: [1, t, t², …, t^deg].
	const row = (x: number): number[] => {
		const r: number[] = []
		let v = 1
		const tx = t(x)
		for (let k = 0; k < p; k++) {
			r.push(v)
			v *= tx
		}
		return r
	}

	// Normal equations: A = XᵀX (p×p), b = Xᵀy.
	const A: number[][] = Array.from({ length: p }, () =>
		new Array<number>(p).fill(0)
	)
	const b = new Array<number>(p).fill(0)
	for (let i = 0; i < n; i++) {
		const r = row(xs[i])
		for (let j = 0; j < p; j++) {
			b[j] += r[j] * ys[i]
			for (let k = 0; k < p; k++) {
				A[j][k] += r[j] * r[k]
			}
		}
	}

	const Ainv = invertMatrix(A)
	if (!Ainv) return null
	const coefT = Ainv.map((rw) => rw.reduce((acc, v, j) => acc + v * b[j], 0))
	if (coefT.some((c) => !Number.isFinite(c))) return null

	const predict = (x: number): number => {
		const tx = t(x)
		let v = 1
		let acc = 0
		for (let k = 0; k < p; k++) {
			acc += coefT[k] * v
			v *= tx
		}
		return acc
	}

	// Residual mean square (needs residual degrees of freedom).
	const df = n - p
	let s2: number | null = null
	if (df > 0) {
		const sse = pts.reduce((acc, [x, y]) => acc + (y - predict(x)) ** 2, 0)
		s2 = sse / df
	}

	const ciAt = (x: number, level: number): [number, number] | null => {
		if (s2 === null || !(level > 0 && level < 1)) return null
		const v = row(x)
		// vᵀ A⁻¹ v — the leverage of the prediction point.
		let quad = 0
		for (let j = 0; j < p; j++) {
			for (let k = 0; k < p; k++) {
				quad += v[j] * Ainv[j][k] * v[k]
			}
		}
		if (!(quad >= 0)) return null
		const se = Math.sqrt(s2 * quad)
		const tq = tQuantile(1 - (1 - level) / 2, df)
		if (!Number.isFinite(tq)) return null
		const yhat = predict(x)
		return [yhat - tq * se, yhat + tq * se]
	}

	return {
		coefficients: uncenterCoefficients(coefT, meanX, sdX),
		predict,
		ciAt,
		xExtent: [Math.min(...xs), Math.max(...xs)],
		n,
	}
}

/** Expand Σ cT_k · ((x − m)/s)^k into plain powers of x. */
const uncenterCoefficients = (
	coefT: number[],
	meanX: number,
	sdX: number
): number[] => {
	const p = coefT.length
	const out = new Array<number>(p).fill(0)
	// basis = coefficients (in x) of ((x − m)/s)^k, built incrementally.
	let basis = [1]
	for (let k = 0; k < p; k++) {
		for (const [i, element] of basis.entries()) {
			out[i] += coefT[k] * element
		}
		// Multiply basis by (x − m)/s for the next power.
		const next = new Array<number>(basis.length + 1).fill(0)
		for (const [i, element] of basis.entries()) {
			next[i + 1] += element / sdX
			next[i] -= (element * meanX) / sdX
		}
		basis = next
	}
	return out
}

/** Invert a small symmetric positive-definite matrix by Gauss–Jordan with
 * partial pivoting. Returns null when singular / ill-conditioned. */
const invertMatrix = (M: number[][]): number[][] | null => {
	const p = M.length
	const a = M.map((r) => [...r])
	const inv: number[][] = Array.from({ length: p }, (_, i) =>
		Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))
	)
	for (let col = 0; col < p; col++) {
		let pivot = col
		for (let r = col + 1; r < p; r++) {
			if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
		}
		const pv = a[pivot][col]
		if (!Number.isFinite(pv) || Math.abs(pv) < 1e-12) return null
		if (pivot !== col) {
			;[a[col], a[pivot]] = [a[pivot], a[col]]
			;[inv[col], inv[pivot]] = [inv[pivot], inv[col]]
		}
		const d = a[col][col]
		for (let j = 0; j < p; j++) {
			a[col][j] /= d
			inv[col][j] /= d
		}
		for (let r = 0; r < p; r++) {
			if (r === col) continue
			const f = a[r][col]
			if (f === 0) continue
			for (let j = 0; j < p; j++) {
				a[r][j] -= f * a[col][j]
				inv[r][j] -= f * inv[col][j]
			}
		}
	}
	return inv
}

/** Standard normal quantile (inverse CDF) via Acklam's rational
 * approximation — relative error < 1.2e-9 over (0, 1). */
export const normalQuantile = (p: number): number => {
	if (!(p > 0 && p < 1)) return NaN
	// Coefficients from Peter Acklam's algorithm.
	const a1 = -3.969683028665376e1
	const a2 = 2.209460984245205e2
	const a3 = -2.759285104469687e2
	const a4 = 1.38357751867269e2
	const a5 = -3.066479806614716e1
	const a6 = 2.506628277459239
	const b1 = -5.447609879822406e1
	const b2 = 1.615858368580409e2
	const b3 = -1.556989798598866e2
	const b4 = 6.680131188771972e1
	const b5 = -1.328068155288572e1
	const c1 = -7.784894002430293e-3
	const c2 = -3.223964580411365e-1
	const c3 = -2.400758277161838
	const c4 = -2.549732539343734
	const c5 = 4.374664141464968
	const c6 = 2.938163982698783
	const d1 = 7.784695709041462e-3
	const d2 = 3.224671290700398e-1
	const d3 = 2.445134137142996
	const d4 = 3.754408661907416
	const pLow = 0.02425
	if (p < pLow) {
		const q = Math.sqrt(-2 * Math.log(p))
		return (
			(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
			((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
		)
	}
	if (p > 1 - pLow) return -normalQuantile(1 - p)
	const q = p - 0.5
	const r = q * q
	return (
		((((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q) /
		(((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
	)
}

/** Student-t quantile. Exact closed forms for df = 1, 2; Cornish–Fisher
 * expansion around the normal quantile otherwise (fine for plotting: a few
 * decimal places at small df, converging to exact as df grows). */
export const tQuantile = (p: number, df: number): number => {
	if (!(p > 0 && p < 1) || df < 1) return NaN
	if (df === 1) return Math.tan(Math.PI * (p - 0.5))
	if (df === 2) {
		const u = 2 * p - 1
		return (u * Math.SQRT2) / Math.sqrt(1 - u * u)
	}
	const z = normalQuantile(p)
	const z3 = z ** 3
	const z5 = z ** 5
	const z7 = z ** 7
	const z9 = z ** 9
	return (
		z +
		(z3 + z) / (4 * df) +
		(5 * z5 + 16 * z3 + 3 * z) / (96 * df ** 2) +
		(3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df ** 3) +
		(79 * z9 + 776 * z7 + 1482 * z5 - 1920 * z3 - 945 * z) / (92160 * df ** 4)
	)
}

/** Evenly spaced sample points across `[lo, hi]`, inclusive of both ends.
 * The renderer draws the fitted curve / CI band through these. */
export const sampleRange = (lo: number, hi: number, count = 100): number[] => {
	if (!(Number.isFinite(lo) && Number.isFinite(hi)) || hi < lo) return []
	if (hi === lo) return [lo]
	const c = Math.max(2, Math.floor(count))
	return Array.from({ length: c }, (_, i) => lo + ((hi - lo) * i) / (c - 1))
}
