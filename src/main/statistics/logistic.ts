import { jStat } from 'jstat'

export interface LogisticResult {
  beta: number
  se: number
  p_value: number
  ci_lower: number
  ci_upper: number
  converged: boolean
  bse_max: number
}

/**
 * Standard logistic regression via IRLS.
 * Returns the coefficient for the first predictor (burden).
 */
export function logisticRegression(
  burden: number[],
  y: number[],
  covariates?: number[][]
): LogisticResult {
  const n = burden.length

  // Build design matrix X = [1, burden, covariates...]
  const p = 1 + 1 + (covariates ? covariates[0].length : 0) // intercept + burden + covariates
  const X: number[][] = []
  for (let i = 0; i < n; i++) {
    const row = [1, burden[i]]
    if (covariates) {
      row.push(...covariates[i])
    }
    X.push(row)
  }

  // Initialize beta = zeros
  const beta = new Array(p).fill(0)
  let converged = false
  const maxIter = 25
  const tol = 1e-8

  for (let iter = 0; iter < maxIter; iter++) {
    // mu = sigmoid(X * beta)
    const mu = new Array(n)
    for (let i = 0; i < n; i++) {
      let eta = 0
      for (let j = 0; j < p; j++) eta += X[i][j] * beta[j]
      mu[i] = 1 / (1 + Math.exp(-eta))
      // Clip to avoid numerical issues
      mu[i] = Math.max(1e-10, Math.min(1 - 1e-10, mu[i]))
    }

    // W = mu * (1 - mu) diagonal weights
    const W = mu.map((m: number) => m * (1 - m))

    // X^T W X (p x p matrix)
    const XtWX = matMul_XtWX(X, W, n, p)

    // X^T (y - mu)
    const XtYmu = new Array(p).fill(0)
    for (let j = 0; j < p; j++) {
      for (let i = 0; i < n; i++) {
        XtYmu[j] += X[i][j] * (y[i] - mu[i])
      }
    }

    // Solve XtWX * delta = XtYmu
    const XtWX_inv = invertMatrix(XtWX, p)
    if (!XtWX_inv) {
      return {
        beta: 0,
        se: Infinity,
        p_value: 1,
        ci_lower: -Infinity,
        ci_upper: Infinity,
        converged: false,
        bse_max: Infinity
      }
    }

    const delta = matVecMul(XtWX_inv, XtYmu, p)

    // Check convergence
    let maxDelta = 0
    for (let j = 0; j < p; j++) {
      maxDelta = Math.max(maxDelta, Math.abs(delta[j]))
    }

    for (let j = 0; j < p; j++) beta[j] += delta[j]

    if (maxDelta < tol) {
      converged = true
      break
    }
  }

  // Compute SE from final Fisher info (X^T W X)^(-1)
  const muFinal = new Array(n)
  for (let i = 0; i < n; i++) {
    let eta = 0
    for (let j = 0; j < p; j++) eta += X[i][j] * beta[j]
    muFinal[i] = 1 / (1 + Math.exp(-eta))
    muFinal[i] = Math.max(1e-10, Math.min(1 - 1e-10, muFinal[i]))
  }
  const Wfinal = muFinal.map((m: number) => m * (1 - m))
  const XtWX_final = matMul_XtWX(X, Wfinal, n, p)
  const cov = invertMatrix(XtWX_final, p)

  if (!cov) {
    return {
      beta: beta[1],
      se: Infinity,
      p_value: 1,
      ci_lower: -Infinity,
      ci_upper: Infinity,
      converged,
      bse_max: Infinity
    }
  }

  const ses = new Array(p)
  let bse_max = 0
  for (let j = 0; j < p; j++) {
    ses[j] = Math.sqrt(Math.max(0, cov[j][j]))
    bse_max = Math.max(bse_max, ses[j])
  }

  const burdenBeta = beta[1]
  const burdenSe = ses[1]
  const z = burdenBeta / burdenSe
  const pValue = twoSidedNormalP(z)

  return {
    beta: burdenBeta,
    se: burdenSe,
    p_value: pValue,
    ci_lower: burdenBeta - 1.96 * burdenSe,
    ci_upper: burdenBeta + 1.96 * burdenSe,
    converged,
    bse_max
  }
}

/**
 * Firth penalized logistic regression.
 * Modifies the score function with the hat matrix diagonal to handle
 * separation and small-sample bias.
 */
export function firthLogisticRegression(
  burden: number[],
  y: number[],
  covariates?: number[][]
): LogisticResult {
  const n = burden.length
  const p = 1 + 1 + (covariates ? covariates[0].length : 0)
  const X: number[][] = []
  for (let i = 0; i < n; i++) {
    const row = [1, burden[i]]
    if (covariates) row.push(...covariates[i])
    X.push(row)
  }

  let beta = new Array(p).fill(0)
  let converged = false
  const maxIter = 50
  const tol = 1e-8

  for (let iter = 0; iter < maxIter; iter++) {
    const mu = new Array(n)
    for (let i = 0; i < n; i++) {
      let eta = 0
      for (let j = 0; j < p; j++) eta += X[i][j] * beta[j]
      mu[i] = 1 / (1 + Math.exp(-eta))
      mu[i] = Math.max(1e-10, Math.min(1 - 1e-10, mu[i]))
    }

    const W = mu.map((m: number) => m * (1 - m))
    const I = matMul_XtWX(X, W, n, p)
    const I_inv = invertMatrix(I, p)
    if (!I_inv) {
      return {
        beta: 0,
        se: Infinity,
        p_value: 1,
        ci_lower: -Infinity,
        ci_upper: Infinity,
        converged: false,
        bse_max: Infinity
      }
    }

    // Hat matrix diagonal h_i = x_i^T I^(-1) x_i * w_i
    const h = new Array(n)
    for (let i = 0; i < n; i++) {
      let val = 0
      for (let j = 0; j < p; j++) {
        for (let k = 0; k < p; k++) {
          val += X[i][j] * I_inv[j][k] * X[i][k]
        }
      }
      h[i] = val * W[i]
    }

    // Modified score: U* = X^T (y - mu + h * (0.5 - mu))
    const Ustar = new Array(p).fill(0)
    for (let j = 0; j < p; j++) {
      for (let i = 0; i < n; i++) {
        Ustar[j] += X[i][j] * (y[i] - mu[i] + h[i] * (0.5 - mu[i]))
      }
    }

    const delta = matVecMul(I_inv, Ustar, p)

    // Step halving if needed
    let step = 1.0
    for (let halving = 0; halving < 25; halving++) {
      const betaTry = beta.map((b: number, j: number) => b + step * delta[j])
      // Check finite
      let ok = true
      for (let j = 0; j < p; j++) {
        if (!isFinite(betaTry[j])) {
          ok = false
          break
        }
      }
      if (ok) {
        beta = betaTry
        break
      }
      step *= 0.5
    }

    let maxDelta = 0
    for (let j = 0; j < p; j++) maxDelta = Math.max(maxDelta, Math.abs(step * delta[j]))

    if (maxDelta < tol) {
      converged = true
      break
    }
  }

  // Compute SE
  const muFinal = new Array(n)
  for (let i = 0; i < n; i++) {
    let eta = 0
    for (let j = 0; j < p; j++) eta += X[i][j] * beta[j]
    muFinal[i] = 1 / (1 + Math.exp(-eta))
    muFinal[i] = Math.max(1e-10, Math.min(1 - 1e-10, muFinal[i]))
  }
  const Wfinal = muFinal.map((m: number) => m * (1 - m))
  const I_final = matMul_XtWX(X, Wfinal, n, p)
  const cov = invertMatrix(I_final, p)

  if (!cov) {
    return {
      beta: beta[1],
      se: Infinity,
      p_value: 1,
      ci_lower: -Infinity,
      ci_upper: Infinity,
      converged,
      bse_max: Infinity
    }
  }

  const ses = new Array(p)
  let bse_max = 0
  for (let j = 0; j < p; j++) {
    ses[j] = Math.sqrt(Math.max(0, cov[j][j]))
    bse_max = Math.max(bse_max, ses[j])
  }

  const burdenBeta = beta[1]
  const burdenSe = ses[1]
  const z = burdenBeta / burdenSe
  const pValue = twoSidedNormalP(z)

  return {
    beta: burdenBeta,
    se: burdenSe,
    p_value: pValue,
    ci_lower: burdenBeta - 1.96 * burdenSe,
    ci_upper: burdenBeta + 1.96 * burdenSe,
    converged,
    bse_max
  }
}

// Helper: X^T W X where W is diagonal
function matMul_XtWX(X: number[][], W: number[], n: number, p: number): number[][] {
  const result: number[][] = Array.from({ length: p }, () => new Array(p).fill(0))
  for (let j = 0; j < p; j++) {
    for (let k = j; k < p; k++) {
      let sum = 0
      for (let i = 0; i < n; i++) {
        sum += X[i][j] * W[i] * X[i][k]
      }
      result[j][k] = sum
      result[k][j] = sum
    }
  }
  return result
}

// Helper: matrix-vector multiplication
function matVecMul(A: number[][], v: number[], p: number): number[] {
  const result = new Array(p).fill(0)
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      result[i] += A[i][j] * v[j]
    }
  }
  return result
}

// Helper: invert a p x p matrix using Gauss-Jordan elimination
function invertMatrix(mat: number[][], p: number): number[][] | null {
  // Create augmented matrix [mat | I]
  const aug: number[][] = Array.from({ length: p }, (_, i) => {
    const row = new Array(2 * p).fill(0)
    for (let j = 0; j < p; j++) row[j] = mat[i][j]
    row[p + i] = 1
    return row
  })

  for (let col = 0; col < p; col++) {
    // Partial pivoting
    let maxVal = Math.abs(aug[col][col])
    let maxRow = col
    for (let row = col + 1; row < p; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col])
        maxRow = row
      }
    }
    if (maxVal < 1e-15) return null

    if (maxRow !== col) {
      const tmp = aug[col]
      aug[col] = aug[maxRow]
      aug[maxRow] = tmp
    }

    const pivot = aug[col][col]
    for (let j = 0; j < 2 * p; j++) aug[col][j] /= pivot

    for (let row = 0; row < p; row++) {
      if (row === col) continue
      const factor = aug[row][col]
      for (let j = 0; j < 2 * p; j++) {
        aug[row][j] -= factor * aug[col][j]
      }
    }
  }

  return aug.map((row) => row.slice(p))
}

/**
 * Two-sided normal p-value 2*Q(|z|). `1 - cdf` cancels to 0 beyond |z| ~ 8.3, so the
 * upper tail uses Laplace's continued fraction for the Mills ratio (relative error ~1e-15).
 */
export function twoSidedNormalP(z: number): number {
  const x = Math.abs(z)
  if (Number.isNaN(x)) return NaN
  if (x < 3) return 2 * (1 - jStat.normal.cdf(x, 0, 1))
  let t = x
  for (let k = 200; k >= 1; k--) t = x + k / t
  return (2 * Math.exp((-x * x) / 2)) / (Math.sqrt(2 * Math.PI) * t)
}
