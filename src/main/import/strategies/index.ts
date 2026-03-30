/**
 * Import strategies - register all strategies on import
 */
export type { ImportStrategy, FormatInfo, StrategyContext, FileFormat } from './ImportStrategy'
export { StrategyRegistry, UnsupportedFormatError, importRegistry } from './StrategyRegistry'

// Import strategies to trigger self-registration
import './ColumnarStrategy'
import './ObjectStrategy'
import './SimpleStrategy'
