// Exact one-sided Clopper–Pearson lower bound (spec §11.5.4).

/** ln Γ(x), Lanczos (g = 7, n = 9), |error| < 1e-13 for x > 0. */
function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
  const z = x - 1
  let s = c[0]
  for (let i = 1; i < 9; i++) s += c[i] / (z + i)
  const t = z + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(s)
}

/** Continued fraction for I_x(a, b) (modified Lentz). */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m
    for (const num of [
      (m * (b - m) * x) / ((a + m2 - 1) * (a + m2)),
      (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    ]) {
      d = 1 + num * d
      if (Math.abs(d) < tiny) d = tiny
      c = 1 + num / c
      if (Math.abs(c) < tiny) c = tiny
      d = 1 / d
      h *= d * c
    }
    if (Math.abs(d * c - 1) < 1e-15) return h
  }
  return h
}

/** Regularized incomplete beta I_x(a, b). */
export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lnFront = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log1p(-x)
  if (x < (a + 1) / (a + b + 2)) return (Math.exp(lnFront) * betaContinuedFraction(x, a, b)) / a
  return 1 - (Math.exp(lnFront) * betaContinuedFraction(1 - x, b, a)) / b
}

/** Beta(a, b) quantile by bisection on the (monotone) regularized incomplete beta. */
export function betaQuantile(p: number, a: number, b: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 200 && hi - lo > 1e-15; i++) {
    const mid = (lo + hi) / 2
    if (regularizedBeta(mid, a, b) < p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * One-sided (1 − alpha) Clopper–Pearson lower bound for x successes in n trials:
 * 0 when x = 0, else the alpha quantile of Beta(x, n − x + 1) (= alpha^(1/n) when x = n).
 */
export function clopperPearsonLower(x: number, n: number, alpha = 0.025): number {
  if (!Number.isInteger(x) || !Number.isInteger(n) || n < 1 || x < 0 || x > n) {
    throw new Error(`invalid binomial counts x=${x} n=${n}`)
  }
  if (x === 0) return 0
  if (x === n) return alpha ** (1 / n)
  return betaQuantile(alpha, x, n - x + 1)
}
