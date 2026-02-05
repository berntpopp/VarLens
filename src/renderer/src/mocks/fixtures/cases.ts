import type { Case } from '../../../../main/database/types'

export const mockCases: Case[] = [
  {
    id: 1,
    name: 'Patient_001_WES',
    file_path: '/mock/data/patient_001.json',
    file_size: 2456789,
    variant_count: 10, // Cancer genetics panel (8 original + 2 shared: PTEN, FBN1)
    created_at: Date.now() - 86400000 * 3 // 3 days ago
  },
  {
    id: 2,
    name: 'Patient_002_Trio',
    file_path: '/mock/data/patient_002.json',
    file_size: 3124567,
    variant_count: 14, // Neurodevelopmental (11 original + 3 shared: BRCA2, CFTR, ATM)
    created_at: Date.now() - 86400000 * 2 // 2 days ago
  },
  {
    id: 3,
    name: 'Patient_003_Panel',
    file_path: '/mock/data/patient_003.json',
    file_size: 567890,
    variant_count: 15, // Connective tissue (12 original + 3 shared: BRCA2, TP53, PTEN)
    created_at: Date.now() - 86400000 // 1 day ago
  }
]
