export interface Message {
  job: string
  data: unknown
  retryCount: number
  lastAttemptedAt: number | null
  lastError: string | null
}
