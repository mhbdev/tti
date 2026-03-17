import JSONbig from "json-bigint"

type TonApiErrorBody = {
  error?: string
  error_code?: number
}

const jsonBig = JSONbig({
  strict: true,
  storeAsString: true,
})

const TONAPI_REQUEST_TIMEOUT_MS = 12_000
const TONAPI_MAX_ATTEMPTS = 3

export class TonApiHttpError extends Error {
  status: number
  errorCode?: number
  details?: string

  constructor({
    status,
    message,
    errorCode,
    details,
  }: {
    status: number
    message: string
    errorCode?: number
    details?: string
  }) {
    super(message)
    this.name = "TonApiHttpError"
    this.status = status
    this.errorCode = errorCode
    this.details = details
  }
}

function mapTonApiMessage(status: number, fallback: string): string {
  if (status === 404) {
    return "The transaction or trace was not found on TonAPI."
  }
  if (status === 429) {
    return "TonAPI rate limit reached. Retry in a moment."
  }
  if (status === 401 || status === 403) {
    return "TonAPI authentication failed. Verify TONAPI_API_KEY."
  }
  if (status >= 500) {
    return "TonAPI is currently unavailable. Retry shortly."
  }

  return fallback
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const message = error.message.toLowerCase()
  return (
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("enetunreach") ||
    message.includes("econnrefused") ||
    message.includes("socket")
  )
}

function getTonApiBaseUrl(): string {
  const fromEnv = process.env.TONAPI_BASE_URL?.trim()
  if (fromEnv) {
    return fromEnv.endsWith("/") ? fromEnv.slice(0, -1) : fromEnv
  }

  return "https://tonapi.io"
}

function getTonApiHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/json",
  }
  const key = process.env.TONAPI_API_KEY?.trim()
  if (key) {
    headers.Authorization = `Bearer ${key}`
  }

  return headers
}

async function parseTonApiResponseBody<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text) {
    return {} as T
  }

  try {
    return jsonBig.parse(text) as T
  } catch {
    return JSON.parse(text) as T
  }
}

export async function tonApiGet<T>(path: string): Promise<T> {
  const url = `${getTonApiBaseUrl()}${path}`
  let lastError: unknown = undefined

  for (let attempt = 1; attempt <= TONAPI_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TONAPI_REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: getTonApiHeaders(),
        cache: "no-store",
        signal: controller.signal,
      })

      const parsed = await parseTonApiResponseBody<TonApiErrorBody | T>(response)
      if (!response.ok) {
        const errorBody =
          typeof parsed === "object" && parsed !== null ? (parsed as TonApiErrorBody) : {}
        const details =
          typeof errorBody.error === "string" ? errorBody.error : response.statusText
        const tonApiError = new TonApiHttpError({
          status: response.status,
          errorCode: errorBody.error_code,
          details,
          message: mapTonApiMessage(response.status, details || "TonAPI request failed."),
        })
        lastError = tonApiError

        if (attempt < TONAPI_MAX_ATTEMPTS && isRetryableStatus(response.status)) {
          await delay(attempt * 350)
          continue
        }
        throw tonApiError
      }

      return parsed as T
    } catch (error) {
      lastError = error
      if (attempt < TONAPI_MAX_ATTEMPTS && isRetryableNetworkError(error)) {
        await delay(attempt * 350)
        continue
      }

      if (error instanceof TonApiHttpError) {
        throw error
      }
      throw new TonApiHttpError({
        status: 503,
        message: "TonAPI network connection failed.",
        details: error instanceof Error ? error.message : "Unknown network error",
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  if (lastError instanceof TonApiHttpError) {
    throw lastError
  }
  throw new TonApiHttpError({
    status: 503,
    message: "TonAPI network connection failed.",
    details: lastError instanceof Error ? lastError.message : "Unknown network error",
  })
}

export interface TonApiAccountAddress {
  address: string
  name?: string
  is_scam?: boolean
  is_wallet?: boolean
}

export interface TonApiMessage {
  msg_type: string
  source?: TonApiAccountAddress
  destination?: TonApiAccountAddress
  value?: string | number
  hash?: string
  op_code?: string
  decoded_op_name?: string
  created_at?: string | number
  bounce?: boolean
  bounced?: boolean
}

export interface TonApiComputePhase {
  skipped: boolean
  gas_used?: string | number
  gas_fees?: string | number
  vm_steps?: number
  exit_code?: number
  exit_code_description?: string
}

export interface TonApiActionPhase {
  success?: boolean
  result_code?: number
  total_actions?: number
  skipped_actions?: number
  total_fees?: string | number
  fwd_fees?: string | number
}

export interface TonApiTransaction {
  hash: string
  lt?: string | number
  utime?: string | number
  account: TonApiAccountAddress
  success?: boolean
  aborted?: boolean
  destroyed?: boolean
  transaction_type?: string
  total_fees?: string | number
  end_balance?: string | number
  in_msg?: TonApiMessage
  out_msgs?: TonApiMessage[]
  compute_phase?: TonApiComputePhase
  action_phase?: TonApiActionPhase
}

export interface TonApiTrace {
  transaction: TonApiTransaction
  interfaces?: string[]
  children?: TonApiTrace[]
}

export interface TonApiAction {
  type: string
  status: "ok" | "failed"
  simple_preview?: {
    name?: string
    description?: string
    value?: string
    accounts?: TonApiAccountAddress[]
  }
  base_transactions?: string[]
}

export interface TonApiValueFlowJetton {
  account: TonApiAccountAddress
  jetton?: {
    address?: string
    symbol?: string
  }
  qty?: string | number
  quantity?: string | number
}

export interface TonApiValueFlow {
  account: TonApiAccountAddress
  ton?: string | number
  fees?: string | number
  jettons?: TonApiValueFlowJetton[]
}

export interface TonApiEvent {
  event_id: string
  timestamp?: string | number
  actions?: TonApiAction[]
  value_flow?: TonApiValueFlow[]
  is_scam?: boolean
  in_progress?: boolean
  progress?: number
}

export function createTonApiClient() {
  return {
    getTrace(traceIdOrTxHash: string) {
      return tonApiGet<TonApiTrace>(`/v2/traces/${encodeURIComponent(traceIdOrTxHash)}`)
    },
    getEvent(eventIdOrTxHash: string) {
      return tonApiGet<TonApiEvent>(`/v2/events/${encodeURIComponent(eventIdOrTxHash)}`)
    },
    getTransaction(transactionHash: string) {
      return tonApiGet<TonApiTransaction>(
        `/v2/blockchain/transactions/${encodeURIComponent(transactionHash)}`
      )
    },
  }
}
