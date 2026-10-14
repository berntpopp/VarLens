/**
 * HPO reference data for the in-app phenotype similarity (`hpo_resnik`, #600).
 * Not bundled: downloaded from the HPO GitHub releases at runtime, preprocessed
 * into `hpo_similarity.db` and updatable. The web server reads an operator
 * supplied file instead (`envPath`).
 */
export const HPO_DATA_CONFIG = {
  /** Used when the GitHub API cannot name the latest release; pinned digests keep it fail-closed. */
  defaultRelease: {
    tag: 'v2026-09-01',
    digests: {
      'hp.json': 'a7b3a012e7b4007a35a7cf8da35f2373b54cc16907f80d13d62470d31f833501',
      'phenotype.hpoa': 'e89aa39c8f97bf5a52c5d160f9250a603681d630ade8ec2679d84ac5aece1f72',
      'genes_to_phenotype.txt': '507a17bff9c49e6329fbd88b1f91734fa7e9fdea5c06304044c0892eb6ab248c'
    } as Record<string, string>
  },
  /** Release tags look like `v2026-09-01`; anything else is refused. */
  tagPattern: /^v\d{4}-\d{2}-\d{2}$/,
  latestReleaseUrl:
    'https://api.github.com/repos/obophenotype/human-phenotype-ontology/releases/latest',
  /** `<url>/<tag>`: a specific release (headless build `--tag`). */
  releaseByTagUrl:
    'https://api.github.com/repos/obophenotype/human-phenotype-ontology/releases/tags',
  downloadBaseUrl: 'https://github.com/obophenotype/human-phenotype-ontology/releases/download',
  assets: {
    ontology: 'hp.json',
    annotations: 'phenotype.hpoa',
    genes: 'genes_to_phenotype.txt'
  },
  dbFileName: 'hpo_similarity.db',
  /**
   * Preprocessing version stored in the DB meta; bump when the build changes
   * what lands in the DB so installed data reports "needs update".
   */
  builderVersion: 2,
  /** Phenotypic abnormality: only its subtree enters IC, gene sets and patient profiles. */
  phenotypeRoot: 'HP:0000118',
  /** HPO frequency term "Excluded" (0 %): an annotation of absence. */
  excludedFrequency: 'HP:0040285',
  /**
   * Overrides the DB location (web server: operator-installed file, built with
   * `npm run build:hpo-db -- [--out <path>] [--tag vYYYY-MM-DD]`).
   */
  envPath: 'VARLENS_HPO_DB_PATH',
  requestTimeoutMs: 5 * 60 * 1000,
  /** Per-file cap; the v2026-09-01 assets are 21-36 MB. */
  maxDownloadBytes: 256 * 1024 * 1024
} as const

export type HpoAssetKey = keyof typeof HPO_DATA_CONFIG.assets
