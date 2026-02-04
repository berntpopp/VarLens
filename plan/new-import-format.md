# New Import Format Support

## Task Overview

Add support for a new JSON export format produced by the varvis-connector export script, in addition to the existing Varvis columnar API format.

## File Format Comparison

### Existing Format (Columnar/Varvis API)
```json
{
  "<case_id>": {
    "header": [
      { "id": "Chr", "title": "Chr", "dataDictionary": {...}, ... },
      ...
    ],
    "data": [
      [50562020, 0, "1", 12345, "T", "C", ...],  // Positional tuples
      ...
    ]
  }
}
```

### New Format (Object-based Export)
```json
{
  "metadata": {
    "export_date": "...",
    "total_variants": 3293,
    "panel_filter": "Skelett_Morbid_2024"
  },
  "samples": {
    "<sample_id>": {
      "variants": [
        { "chr": "1", "pos": 1342153, "ref": "T", "alt": "C", ... }  // Named objects
      ]
    }
  }
}
```

## Implementation Status

### Completed

1. **Format Detection** (`ImportService.detectFormat()`)
   - Examines top-level JSON keys to identify format type
   - Returns `'columnar'` or `'object'` with the appropriate case/sample key
   - Resolves immediately when format is detected (no waiting for stream close)

2. **Object Format Mapper** (`ObjectFormatMapper.ts`)
   - New Transform stream that maps object-based variants to database schema
   - Handles `hpo_match` array conversion to comma-separated string
   - Validates required fields (chr, pos, ref, alt)

3. **ImportService Refactoring**
   - Split into `importColumnarFormat()` and `importObjectFormat()` methods
   - Automatic format routing based on detection
   - Updated `extractDictionaries()` to accept caseIdKey parameter

4. **Format Validation (Option C)**
   - `extractCaseId()` now validates against 'metadata'/'samples' keys
   - Throws descriptive error for unrecognized formats

### Files Modified

- `src/main/import/ImportService.ts` - Core format detection and routing
- `src/main/import/transforms/ObjectFormatMapper.ts` - New file
- `vitest.config.ts` - Test configuration updates
- `tests/main/import/ImportService.test.ts` - Environment directive added

## Problems Encountered

### 1. Stream Cleanup Hanging (RESOLVED)

**Problem:** Original code used `stream.on('close', ...)` to resolve promises, but 'close' events don't fire reliably after `stream.destroy()` on piped streams.

**Solution:** Refactored all stream-based methods to:
- Resolve promises immediately when result is found
- Use cleanup function that removes listeners before destroying
- Use 'end' event as fallback
- Track `resolved` flag to prevent double resolution

### 2. Vitest Test Timeouts (UNRESOLVED)

**Problem:** ImportService tests timeout (60s) when run with vitest, but the same code works when run directly with `tsx` (~41s for 251 variants).

**Investigation:**
- Tested format detection, FieldMapper, BatchAccumulator individually - all work
- Full pipeline works with mock database in isolation
- Full pipeline works with real DatabaseService when run via tsx
- Only fails when run through vitest test runner

**Attempted Fixes:**
- Added `@vitest-environment node` directive to test file
- Tried `pool: 'forks'` and `pool: 'threads'` configurations
- Increased `testTimeout` and `hookTimeout`
- Removed `environmentMatchGlobs` configuration

**Suspected Causes:**
- Vitest's module transformation may affect stream-json behavior
- Test isolation mechanism may interfere with stream pipelines
- Native module (better-sqlite3) interaction with test runner

**Next Steps:**
- Try running tests with `--no-isolate` flag
- Check if vitest's VM isolation affects stream backpressure
- Consider mocking the database for unit tests vs integration tests
- Test with older vitest version to rule out regression

### 3. Missing Dependencies

**Problem:** `bottleneck` module was missing.

**Solution:** Installed with `npm install bottleneck`.

## Test Files

New export format test files added to `test-data/`:
- `LB26-0434_Skelett.json.gz` - 3,293 variants with panel filter
- `LB26-0434.json.gz` - 63,551 variants without panel filter

## Manual Testing

The import functionality works correctly when tested manually:
1. Run `npm run rebuild:electron && npm run dev`
2. Import either test file via the UI
3. Variants should import successfully

## Code Quality

- All new code follows existing patterns and TypeScript strict mode
- No lint errors in new/modified files
- Pre-existing lint errors in other files (unrelated)
