/**
 * Toy HPO release (#600). Ontology: R ⊃ P (Phenotypic abnormality) ⊃ A ⊃ {C, D};
 * P ⊃ B ⊃ {E, X}; diamond F is_a C and E; R ⊃ INH (inheritance, outside P).
 * Deprecated Z replaced by E, deprecated Z2 replaced by Z (alias chain), alt id ALT of C.
 * Positive diseases: d1 {C}, d2 {D}, d3 {E}, d4 {C, E}, N = 4 (NOT, zero-frequency
 * and non-P rows excluded). Hand-computed IC = -ln(n/N): R 0, P 0, A ln(4/3),
 * B ln 2, C ln 2, D ln 4, E ln 2; F and X unannotated.
 */
export const T = {
  R: 'HP:0000001',
  A: 'HP:0000002',
  B: 'HP:0000003',
  C: 'HP:0000004',
  D: 'HP:0000005',
  E: 'HP:0000006',
  INH: 'HP:0000007',
  F: 'HP:0000008',
  Z: 'HP:0000009',
  ALT: 'HP:0000010',
  Z2: 'HP:0000011',
  X: 'HP:0000012',
  P: 'HP:0000118'
} as const

const iri = (id: string): string => `http://purl.obolibrary.org/obo/${id.replace(':', '_')}`
const prop = (pred: string, val: string): object => ({ pred, val })
const ALT_ID = 'http://www.geneontology.org/formats/oboInOwl#hasAlternativeId'
const REPLACED_BY = 'http://purl.obolibrary.org/obo/IAO_0100001'
const node = (id: string, meta?: object): object => ({
  id: iri(id),
  lbl: `label ${id}`,
  type: 'CLASS',
  ...(meta !== undefined ? { meta } : {})
})
const isA = (sub: string, obj: string): object => ({ sub: iri(sub), pred: 'is_a', obj: iri(obj) })
const deprecated = (id: string, by: string): object =>
  node(id, { deprecated: true, basicPropertyValues: [prop(REPLACED_BY, iri(by))] })

export const HP_JSON = JSON.stringify({
  graphs: [
    {
      meta: { version: 'http://purl.obolibrary.org/obo/hp/releases/2026-09-01/hp.json' },
      nodes: [
        node(T.R),
        node(T.P),
        node(T.INH),
        node(T.A),
        node(T.B),
        node(T.C, { basicPropertyValues: [prop(ALT_ID, T.ALT)] }),
        node(T.D),
        node(T.E),
        node(T.F),
        node(T.X),
        deprecated(T.Z, T.E),
        deprecated(T.Z2, T.Z)
      ],
      edges: [
        isA(T.P, T.R),
        isA(T.INH, T.R),
        isA(T.A, T.P),
        isA(T.B, T.P),
        isA(T.C, T.A),
        isA(T.D, T.A),
        isA(T.E, T.B),
        isA(T.X, T.B),
        isA(T.F, T.C),
        isA(T.F, T.E),
        isA(T.Z, T.A),
        { sub: iri(T.C), pred: 'http://purl.obolibrary.org/obo/BFO_0000050', obj: iri(T.B) }
      ]
    }
  ]
})

const hpoaRow = (disease: string, term: string, qualifier = '', aspect = 'P', freq = ''): string =>
  [disease, 'name', qualifier, term, 'PMID:1', 'PCS', '', freq, '', '', aspect, 'HPO:x'].join('\t')

export const PHENOTYPE_HPOA = [
  '#description: toy',
  '#version: 2026-09-01',
  'database_id\tdisease_name\tqualifier\thpo_id\treference\tevidence\tonset\tfrequency\tsex\tmodifier\taspect\tbiocuration',
  hpoaRow('OMIM:1', T.C, '', 'P', '3/4'),
  hpoaRow('OMIM:1', T.X, '', 'P', '0%'),
  hpoaRow('OMIM:2', T.D),
  hpoaRow('OMIM:2', T.X, '', 'P', 'HP:0040285'),
  hpoaRow('OMIM:3', T.E),
  hpoaRow('OMIM:3', T.X, '', 'P', '0/2'),
  hpoaRow('OMIM:4', T.C),
  hpoaRow('OMIM:4', T.E),
  hpoaRow('OMIM:4', T.D, 'NOT'),
  hpoaRow('OMIM:4', T.INH, '', 'I'),
  hpoaRow('OMIM:5', T.C, 'NOT')
].join('\n')

export const GENES_TO_PHENOTYPE = [
  'ncbi_gene_id\tgene_symbol\thpo_id\thpo_name\tfrequency\tdisease_id',
  `1\tGENE1\t${T.D}\tx\t-\tOMIM:2`,
  `1\tGENE1\t${T.X}\tx\t0/2\tOMIM:2`,
  `2\tGENE2\t${T.C}\tx\t-\tOMIM:4`,
  `2\tGENE2\t${T.E}\tx\t-\tOMIM:4`,
  `2\tGENE2\t${T.E}\tx\t-\tOMIM:3`,
  `2\tGENE2\t${T.D}\tx\t-\tOMIM:4`,
  `2\tGENE2\t${T.INH}\tx\t-\tOMIM:4`,
  `3\tGENE3\t${T.C}\tx\t-\tOMIM:5`,
  `3\tGENE3\t${T.D}\tx\t-\tOMIM:2`,
  `4\tNOTONLY\t${T.C}\tx\t-\tOMIM:5`
].join('\n')
