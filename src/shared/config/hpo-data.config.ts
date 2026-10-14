/**
 * HPO reference data for the in-app phenotype similarity (`hpo_resnik`, #600).
 * Not bundled: downloaded from the HPO GitHub releases at runtime, preprocessed
 * into `hpo_similarity.db` and updatable. The web server reads an operator
 * supplied file instead (`envPath`).
 */
export const HPO_DATA_CONFIG = {
  /** Used when the GitHub API cannot name the latest release. */
  defaultTag: 'v2026-09-01',
  latestReleaseUrl:
    'https://api.github.com/repos/obophenotype/human-phenotype-ontology/releases/latest',
  downloadBaseUrl: 'https://github.com/obophenotype/human-phenotype-ontology/releases/download',
  assets: {
    ontology: 'hp.json',
    annotations: 'phenotype.hpoa',
    genes: 'genes_to_phenotype.txt'
  },
  dbFileName: 'hpo_similarity.db',
  /** Overrides the DB location (web server: operator-installed file). */
  envPath: 'VARLENS_HPO_DB_PATH',
  requestTimeoutMs: 5 * 60 * 1000
} as const

export type HpoAssetKey = keyof typeof HPO_DATA_CONFIG.assets
