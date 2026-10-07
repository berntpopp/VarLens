#!/usr/bin/env node
/**
 * VarLens Synthetic Variant Simulator CLI
 *
 * Usage:
 *   npx tsx scripts/simulate-variants.ts [options]
 *
 * Examples:
 *   npx tsx scripts/simulate-variants.ts --samples 5 --preset panel --formats simple-json,vcf --gzip
 *   npx tsx scripts/simulate-variants.ts --samples 100 --preset smoke --out .tmp/smoke-cohort
 */
import { resolve } from 'node:path'
import { simulateCohort } from '../src/main/simulator/engine'
import type {
  SimulatorFormat,
  SimulatorOptions,
  SimulatorPreset
} from '../src/main/simulator/types'

function printHelp(): void {
  console.log(`
VarLens Synthetic Variant Simulator

Generates biologically plausible, deterministic synthetic genetic variants
in VarLens simple-JSON, columnar-JSON, VCF, and XLSX formats.

Usage:
  npx tsx scripts/simulate-variants.ts [options]

Options:
  -n, --samples <count>       Number of samples to generate (default: 1)
  -p, --preset <preset>       Preset profile: 'panel' (~3.7k), 'exome' (~30k), 'smoke' (~100) (default: 'panel')
  -v, --variants <count>      Exact variant count per sample (overrides preset)
      --variants-min <min>    Minimum variants per sample (randomized range)
      --variants-max <max>    Maximum variants per sample (randomized range)
  -f, --formats <list>        Comma-separated formats: 'simple-json', 'columnar-json', 'vcf', 'xlsx' (default: 'simple-json')
  -o, --out <dir>             Output directory (default: 'tests/.cache/simulated-cohort')
  -s, --seed <number>         Deterministic master PRNG seed (default: 20261006)
      --shared-fraction <0..1>  Share of each sample drawn from cohort-shared sites (default: 0.9)
  -w, --workers <count>       Worker thread count (default: auto)
      --no-gzip               Do not gzip JSON and VCF files
  -h, --help                  Show this help message
`)
}

function parseCliArgs(args: string[]): SimulatorOptions {
  let samples = 1
  let preset: SimulatorPreset = 'panel'
  let variantsPerSample: number | undefined
  let variantsMin: number | undefined
  let variantsMax: number | undefined
  let formats: SimulatorFormat[] = ['simple-json']
  let outDir = 'tests/.cache/simulated-cohort'
  let seed = 20261006
  let workers: number | undefined
  let sharedFraction: number | undefined
  let gzip = true

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-h' || arg === '--help') {
      printHelp()
      process.exit(0)
    } else if (arg === '-n' || arg === '--samples') {
      samples = parseInt(args[++i], 10)
    } else if (arg === '-p' || arg === '--preset') {
      preset = args[++i] as SimulatorPreset
    } else if (arg === '-v' || arg === '--variants') {
      variantsPerSample = parseInt(args[++i], 10)
    } else if (arg === '--variants-min') {
      variantsMin = parseInt(args[++i], 10)
    } else if (arg === '--variants-max') {
      variantsMax = parseInt(args[++i], 10)
    } else if (arg === '-f' || arg === '--formats') {
      formats = args[++i].split(',').map((f) => f.trim()) as SimulatorFormat[]
    } else if (arg === '-o' || arg === '--out') {
      outDir = args[++i]
    } else if (arg === '-s' || arg === '--seed') {
      seed = parseInt(args[++i], 10)
    } else if (arg === '--shared-fraction') {
      sharedFraction = parseFloat(args[++i])
    } else if (arg === '-w' || arg === '--workers') {
      workers = parseInt(args[++i], 10)
    } else if (arg === '--no-gzip') {
      gzip = false
    }
  }

  return {
    samples,
    preset,
    variantsPerSample,
    variantsMin,
    variantsMax,
    formats,
    outDir: resolve(process.cwd(), outDir),
    seed,
    workers,
    sharedFraction,
    gzip
  }
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2))

  console.log(`Starting VarLens Variant Simulator:`)
  console.log(`  Samples:     ${options.samples}`)
  console.log(`  Preset:      ${options.preset}`)
  console.log(`  Formats:     ${options.formats.join(', ')} (gzip: ${options.gzip})`)
  console.log(`  Out dir:     ${options.outDir}`)
  console.log(`  Master seed: ${options.seed}`)

  const startTime = Date.now()

  options.onProgress = (prog) => {
    process.stdout.write(
      `\r  [${prog.currentSample}/${prog.totalSamples}] ${prog.currentVariants} variants generated (${prog.rateVariantsPerSec} var/s)`
    )
  }

  const manifest = await simulateCohort(options)
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log(`\nSimulation complete!`)
  console.log(`  Total samples:  ${manifest.totalSamples}`)
  console.log(`  Total variants: ${manifest.totalVariants}`)
  console.log(`  Elapsed time:   ${totalElapsed}s`)
  console.log(`  Manifest:       ${options.outDir}/manifest.json`)
  console.log(`  Sample IDs:     ${options.outDir}/samples.txt`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nSimulation failed:`, err)
    process.exit(1)
  })
}
