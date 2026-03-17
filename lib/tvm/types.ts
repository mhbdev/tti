import { z } from "zod"

export type Network = "mainnet"

const HEX64_REGEX = /^[A-Fa-f0-9]{64}$/
const BASE64URL_TX_REGEX = /^[A-Za-z0-9_-]{43,120}$/

export function normalizeTxHashInput(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return trimmed.slice(2)
  }

  return trimmed
}

export function isValidTxHash(value: string): boolean {
  return HEX64_REGEX.test(value) || BASE64URL_TX_REGEX.test(value)
}

export const txHashSchema = z
  .string()
  .min(1, "Transaction hash is required")
  .transform(normalizeTxHashInput)
  .refine(isValidTxHash, {
    message:
      "Enter a valid TON transaction hash (64 hex chars or base64url hash).",
  })

export type TraceRiskLevel = "low" | "medium" | "high"

export interface DeterministicMessageSummary {
  hash: string
  msgType: string
  source?: string
  sourceName?: string
  destination?: string
  destinationName?: string
  valueNanoTon: string
  opCode?: string
  decodedOpName?: string
  createdAt?: string
  bounce?: boolean
  bounced?: boolean
}

export interface DeterministicTransactionSummary {
  hash: string
  account: string
  accountName?: string
  lt: string
  utime: string
  success: boolean
  aborted: boolean
  destroyed: boolean
  transactionType: string
  totalFeesNanoTon: string
  endBalanceNanoTon: string
  outMessagesCount: number
  interfaces: string[]
  inMessage?: DeterministicMessageSummary
  computePhase?: {
    skipped: boolean
    gasUsed?: string
    gasFeesNanoTon?: string
    vmSteps?: number
    exitCode?: number
    exitCodeDescription?: string
  }
  actionPhase?: {
    success?: boolean
    resultCode?: number
    totalActions?: number
    skippedActions?: number
    totalFeesNanoTon?: string
    fwdFeesNanoTon?: string
  }
}

export type TraceMessageDirection = "inbound" | "outbound" | "internal"

export interface DeterministicTraceNode {
  depth: number
  hash: string
  parentHash?: string
  account: string
  accountName?: string
  success: boolean
  aborted: boolean
  transactionType: string
  direction: TraceMessageDirection
  totalFeesNanoTon: string
  gasUsed?: string
  vmSteps?: number
  exitCode?: number
}

export interface DeterministicActionSummary {
  type: string
  status: "ok" | "failed"
  name?: string
  description?: string
  value?: string
  accounts: string[]
  baseTransactions: string[]
}

export interface DeterministicValueFlowSummary {
  account: string
  accountName?: string
  tonNanoTon: string
  feesNanoTon: string
  jettons: Array<{
    jettonSymbol?: string
    jettonAddress?: string
    quantity: string
    account: string
  }>
}

export interface DeterministicEventSummary {
  eventId: string
  timestamp: string
  inProgress: boolean
  progress: number
  isScam: boolean
  actions: DeterministicActionSummary[]
  valueFlow: DeterministicValueFlowSummary[]
}

export interface DeterministicSnapshot {
  transaction: DeterministicTransactionSummary
  traceNodes: DeterministicTraceNode[]
  event: DeterministicEventSummary
}

export interface TraceAssessment {
  confidence: number
  scamScore: number
  riskLevel: TraceRiskLevel
  verdict: string
  evidence: string[]
}

export const traceAssessmentSchema = z.object({
  confidence: z.number().int().min(0).max(100),
  scamScore: z.number().int().min(0).max(100),
  riskLevel: z.enum(["low", "medium", "high"]),
  verdict: z.string().min(1).max(600),
  evidence: z.array(z.string().min(1).max(500)).min(1).max(8),
})

export interface TraceReportContext {
  network: Network
  canonicalTxHash: string
  transaction: {
    account: string
    success: boolean
    transactionType: string
    outMessagesCount: number
    totalFeesNanoTon: string
  }
  traceDigest: Array<{
    depth: number
    hash: string
    account: string
    success: boolean
    transactionType: string
    direction: TraceMessageDirection
    totalFeesNanoTon: string
    gasUsed?: string
    exitCode?: number
  }>
  eventDigest: {
    eventId: string
    actions: Array<{
      type: string
      status: "ok" | "failed"
      description?: string
      value?: string
      baseTransactions: string[]
    }>
    valueFlow: Array<{
      account: string
      tonNanoTon: string
      feesNanoTon: string
    }>
    inProgress: boolean
    progress: number
    isScam: boolean
  }
}

export interface TraceReportPayload {
  network: Network
  canonicalTxHash: string
  deterministic: DeterministicSnapshot
  assessment: TraceAssessment
  assessmentSource: "ai" | "fallback"
  assessmentNote?: string
  reportContext: TraceReportContext
}

export const reportRequestSchema = z.object({
  txHash: txHashSchema,
})

export const interpretRequestSchema = z.object({
  prompt: z.string().min(1),
  reportContext: z.object({
    network: z.literal("mainnet"),
    canonicalTxHash: z.string().min(1),
    transaction: z.object({
      account: z.string().min(1),
      success: z.boolean(),
      transactionType: z.string().min(1),
      outMessagesCount: z.number().int().min(0),
      totalFeesNanoTon: z.string().min(1),
    }),
    traceDigest: z.array(
      z.object({
        depth: z.number().int().min(0),
        hash: z.string().min(1),
        account: z.string().min(1),
        success: z.boolean(),
        transactionType: z.string().min(1),
        direction: z.enum(["inbound", "outbound", "internal"]),
        totalFeesNanoTon: z.string().min(1),
        gasUsed: z.string().optional(),
        exitCode: z.number().int().optional(),
      })
    ),
    eventDigest: z.object({
      eventId: z.string().min(1),
      actions: z.array(
        z.object({
          type: z.string().min(1),
          status: z.enum(["ok", "failed"]),
          description: z.string().optional(),
          value: z.string().optional(),
          baseTransactions: z.array(z.string()),
        })
      ),
      valueFlow: z.array(
        z.object({
          account: z.string().min(1),
          tonNanoTon: z.string().min(1),
          feesNanoTon: z.string().min(1),
        })
      ),
      inProgress: z.boolean(),
      progress: z.number(),
      isScam: z.boolean(),
    }),
  }),
  assessment: traceAssessmentSchema,
})
