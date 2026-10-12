/** The import wizard's source choices (step 1). */
import { mdiFileDocument, mdiFileMultiple, mdiFolderOpen, mdiZipBox } from '@mdi/js'
import type { ImportSourceOption } from './ImportSourceSelector.vue'

export const IMPORT_SOURCES: ImportSourceOption[] = [
  { mode: 'single', icon: mdiFileDocument, title: 'Single File', subtitle: 'JSON / VCF' },
  { mode: 'files', icon: mdiFileMultiple, title: 'Multiple Files', subtitle: 'Select files' },
  { mode: 'folder', icon: mdiFolderOpen, title: 'Folder', subtitle: 'All files in folder' },
  { mode: 'zip', icon: mdiZipBox, title: 'ZIP Archive', subtitle: 'Extract & import' }
]
