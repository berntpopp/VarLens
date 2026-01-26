declare module 'stream-json' {
  import { Transform } from 'node:stream'

  export function parser(options?: {
    packKeys?: boolean
    packStrings?: boolean
    packNumbers?: boolean
    streamKeys?: boolean
    streamStrings?: boolean
    streamNumbers?: boolean
    jsonStreaming?: boolean
  }): Transform

  export interface StreamData {
    name?: string
    value?: unknown
  }
}

declare module 'stream-json/filters/Pick' {
  import { Transform } from 'node:stream'

  export function pick(options: { filter: string | string[] }): Transform
}

declare module 'stream-json/streamers/StreamArray' {
  import { Transform } from 'node:stream'

  export function streamArray(): Transform
}
