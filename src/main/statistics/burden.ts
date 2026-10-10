import type { LogisticBurdenResult, SampleBurdenData, WeightScheme } from './types'
import { hasCompleteCovariates } from './contingency'
import { computeBurdenScore } from './weights'
import { logisticRegression, firthLogisticRegression } from './logistic'

export function logisticBurdenTest(
  samples: SampleBurdenData[],
  weightScheme: WeightScheme
): LogisticBurdenResult {
  // A sample lacking a selected covariate (NaN; null once serialised) must not enter the fit.
  // contingency.ts computes the frequencies over the same samples.
  const complete = samples.filter((s) => hasCompleteCovariates(s.covariate_values))
  const result = fitLogisticBurden(complete, weightScheme)
  const missing = samples.length - complete.length
  return missing > 0 ? { ...result, n_missing_covariate: missing } : result
}

function fitLogisticBurden(
  samples: SampleBurdenData[],
  weightScheme: WeightScheme
): LogisticBurdenResult {
  if (samples.length === 0) {
    return {
      p_value: null,
      beta: null,
      se: null,
      ci_lower: null,
      ci_upper: null,
      used_firth: false,
      warning: 'NO_SAMPLES'
    }
  }

  const burdens = samples.map((s) =>
    computeBurdenScore(s.dosages, s.variant_mafs, s.variant_cadds, weightScheme)
  )
  const phenotypes = samples.map((s) => s.group)
  const covariates =
    samples[0].covariate_values.length > 0 ? samples.map((s) => s.covariate_values) : undefined

  if (burdens.every((b) => b === 0)) {
    return {
      p_value: null,
      beta: null,
      se: null,
      ci_lower: null,
      ci_upper: null,
      used_firth: false,
      warning: 'ZERO_BURDEN'
    }
  }

  const stdResult = logisticRegression(burdens, phenotypes, covariates)

  if (stdResult.converged && stdResult.bse_max <= 100) {
    return {
      p_value: stdResult.p_value,
      beta: stdResult.beta,
      se: stdResult.se,
      ci_lower: stdResult.ci_lower,
      ci_upper: stdResult.ci_upper,
      used_firth: false
    }
  }

  const firthResult = firthLogisticRegression(burdens, phenotypes, covariates)
  const warning = !stdResult.converged ? 'PERFECT_SEPARATION' : 'QUASI_SEPARATION'

  if (!firthResult.converged) {
    return {
      p_value: null,
      beta: null,
      se: null,
      ci_lower: null,
      ci_upper: null,
      used_firth: true,
      warning: 'FIRTH_CONVERGE_FAIL'
    }
  }

  return {
    p_value: firthResult.p_value,
    beta: firthResult.beta,
    se: firthResult.se,
    ci_lower: firthResult.ci_lower,
    ci_upper: firthResult.ci_upper,
    used_firth: true,
    warning
  }
}
