/**
 * Toy HPO release (#600). Ontology: R ⊃ A ⊃ {C, D}; R ⊃ B ⊃ E; plus a
 * deprecated term Z replaced by E, and alt id ALT of C. Diseases: d1 {C}, d2 {D}, d3 {E}, d4 {C, E}, N = 4.
 * Hand-computed IC = -ln(n/N): R 0, A ln(4/3), B ln 2, C ln 2, D ln 4, E ln 2.
 */
export const T = {
  R: 'HP:0000001',
  A: 'HP:0000002',
  B: 'HP:0000003',
  C: 'HP:0000004',
  D: 'HP:0000005',
  E: 'HP:0000006',
  Z: 'HP:0000009',
  ALT: 'HP:0000010'
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

export const HP_JSON = JSON.stringify({
  graphs: [
    {
      meta: { version: 'http://purl.obolibrary.org/obo/hp/releases/2026-09-01/hp.json' },
      nodes: [
        node(T.R),
        node(T.A),
        node(T.B),
        node(T.C, { basicPropertyValues: [prop(ALT_ID, T.ALT)] }),
        node(T.D),
        node(T.E),
        node(T.Z, { deprecated: true, basicPropertyValues: [prop(REPLACED_BY, iri(T.E))] })
      ],
      edges: [
        isA(T.A, T.R),
        isA(T.B, T.R),
        isA(T.C, T.A),
        isA(T.D, T.A),
        isA(T.E, T.B),
        isA(T.Z, T.A),
        { sub: iri(T.C), pred: 'http://purl.obolibrary.org/obo/BFO_0000050', obj: iri(T.B) }
      ]
    }
  ]
})

const hpoaRow = (disease: string, term: string, qualifier = '', aspect = 'P'): string =>
  [disease, 'name', qualifier, term, 'PMID:1', 'PCS', '', '', '', '', aspect, 'HPO:x'].join('\t')

export const PHENOTYPE_HPOA = [
  '#description: toy',
  '#version: 2026-09-01',
  'database_id\tdisease_name\tqualifier\thpo_id\treference\tevidence\tonset\tfrequency\tsex\tmodifier\taspect\tbiocuration',
  hpoaRow('OMIM:1', T.C),
  hpoaRow('OMIM:2', T.D),
  hpoaRow('OMIM:3', T.E),
  hpoaRow('OMIM:4', T.C),
  hpoaRow('OMIM:4', T.E),
  hpoaRow('OMIM:4', T.D, 'NOT'),
  hpoaRow('OMIM:5', 'HP:0000007', '', 'I')
].join('\n')

export const GENES_TO_PHENOTYPE = [
  'ncbi_gene_id\tgene_symbol\thpo_id\thpo_name\tfrequency\tdisease_id',
  `1\tGENE1\t${T.D}\tx\t-\tOMIM:2`,
  `2\tGENE2\t${T.C}\tx\t-\tOMIM:4`,
  `2\tGENE2\t${T.E}\tx\t-\tOMIM:4`,
  `2\tGENE2\t${T.E}\tx\t-\tOMIM:3`
].join('\n')
