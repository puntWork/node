export interface Message {
  job: string
  data: unknown
  retryCount: number
  lastAttemptedAt: number | null
  lastError: string | null
}

export interface WorkerOpts {
  timeout?: number
  verbose?: boolean
  topic?: string
  worker?: string
  group?: string
  ts?: number
  maxRetries?: number
}
