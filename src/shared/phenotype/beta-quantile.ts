/**
 * Beta distribution quantile for the conservative exclusion frequency f_excl
 * (spec §3). Build-time only, so plain bisection on the regularized incomplete
 * beta (Lentz continued fraction, Numerical Recipes §6.4) is fast enough.
 */

/** ln Γ(x) for x > 0 (Lanczos, g = 7; ~1e-15 relative). */
function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
  x -= 1
  let s = c[0]
  for (let i = 1; i < 9; i++) s += c[i] / (x + i)
  const t = x + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(s)
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  d = 1 / (Math.abs(d) < tiny ? tiny : d)
  let h = d
  for (let m = 1; m <= 300; m++) {
    for (const num of [
      (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m)),
      (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))
    ]) {
      d = 1 + num * d
      d = 1 / (Math.abs(d) < tiny ? tiny : d)
      c = 1 + num / c
      if (Math.abs(c) < tiny) c = tiny
      h *= d * c
    }
    if (Math.abs(d * c - 1) < 1e-15) break
  }
  return h
}

/** Regularized incomplete beta I_x(a, b). */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  )
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b
}

/** The q-quantile of Beta(a, b), to ~1e-12. */
export function betaQuantile(q: number, a: number, b: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 45; i++) {
    const mid = (lo + hi) / 2
    if (betaCdf(mid, a, b) < q) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
