export interface Message {
  job: string
  data: any
  retryCount: number
  lastAttemptedAt: number | null
  lastError: string | null
}
