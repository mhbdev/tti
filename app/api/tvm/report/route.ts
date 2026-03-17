import { NextResponse } from "next/server"
import { ZodError } from "zod"

import { buildFallbackAssessment, generateTraceAssessment } from "@/lib/tvm/assessment"
import { buildDeterministicSnapshot, buildReportContext } from "@/lib/tvm/normalize"
import { createTonApiClient, TonApiHttpError } from "@/lib/tvm/tonapi"
import {
  reportRequestSchema,
  type DeterministicSnapshot,
  type TraceReportPayload,
} from "@/lib/tvm/types"

export const maxDuration = 60

function errorResponse(status: number, message: string, details?: string) {
  return NextResponse.json(
    {
      error: message,
      details,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  )
}

function isRecoverableTonApiFailure(error: unknown): boolean {
  if (!(error instanceof TonApiHttpError)) {
    return false
  }
  return error.status === 429 || error.status >= 500
}

function buildUnavailableSnapshot(txHash: string): DeterministicSnapshot {
  return {
    transaction: {
      hash: txHash,
      account: "N/A",
      accountName: "Unavailable",
      lt: "0",
      utime: "0",
      success: false,
      aborted: false,
      destroyed: false,
      transactionType: "Unknown",
      totalFeesNanoTon: "0",
      endBalanceNanoTon: "0",
      outMessagesCount: 0,
      interfaces: [],
    },
    traceNodes: [],
    event: {
      eventId: txHash,
      timestamp: "0",
      inProgress: false,
      progress: 0,
      isScam: false,
      actions: [],
      valueFlow: [],
    },
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json()
    const { txHash } = reportRequestSchema.parse(payload)

    const tonApi = createTonApiClient()
    let canonicalTxHash = txHash
    let deterministic: DeterministicSnapshot
    let networkNote: string | undefined

    try {
      const [trace, event] = await Promise.all([
        tonApi.getTrace(txHash),
        tonApi.getEvent(txHash),
      ])

      canonicalTxHash = trace.transaction.hash || txHash
      const transaction = await tonApi.getTransaction(canonicalTxHash)

      deterministic = buildDeterministicSnapshot({
        trace,
        event,
        transaction,
      })
    } catch (tonApiError) {
      if (tonApiError instanceof TonApiHttpError && tonApiError.status === 404) {
        return errorResponse(404, tonApiError.message, tonApiError.details)
      }
      if (!isRecoverableTonApiFailure(tonApiError)) {
        if (tonApiError instanceof TonApiHttpError) {
          return errorResponse(tonApiError.status, tonApiError.message, tonApiError.details)
        }
        throw tonApiError
      }

      deterministic = buildUnavailableSnapshot(txHash)
      networkNote =
        tonApiError instanceof TonApiHttpError
          ? `TonAPI temporarily unavailable: ${tonApiError.message}${tonApiError.details ? ` (${tonApiError.details})` : ""}`
          : "TonAPI temporarily unavailable."
    }

    const reportContext = buildReportContext(deterministic, canonicalTxHash)

    let assessmentSource: "ai" | "fallback" = "fallback"
    let assessmentNote: string | undefined
    let assessment = buildFallbackAssessment(reportContext)

    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
      try {
        assessment = await generateTraceAssessment(reportContext)
        assessmentSource = "ai"
      } catch (assessmentError) {
        assessmentSource = "fallback"
        if (assessmentError instanceof Error) {
          assessmentNote = `AI assessment unavailable. ${assessmentError.message}`
          assessment = buildFallbackAssessment(reportContext, assessmentError.message)
        } else {
          assessmentNote = "AI assessment unavailable due to an unexpected error."
          assessment = buildFallbackAssessment(
            reportContext,
            "Unexpected AI assessment error"
          )
        }
      }
    } else {
      assessmentNote =
        "GOOGLE_GENERATIVE_AI_API_KEY is not configured. Using deterministic fallback assessment."
      assessment = buildFallbackAssessment(
        reportContext,
        "GOOGLE_GENERATIVE_AI_API_KEY missing"
      )
    }

    if (networkNote) {
      assessmentSource = "fallback"
      assessmentNote = assessmentNote
        ? `${networkNote} ${assessmentNote}`
        : networkNote
      assessment = buildFallbackAssessment(reportContext, networkNote)
    }

    const response: TraceReportPayload = {
      network: "mainnet",
      canonicalTxHash,
      deterministic,
      assessment,
      assessmentSource,
      assessmentNote,
      reportContext,
    }

    return NextResponse.json(response, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "Invalid request body.", error.message)
    }

    if (error instanceof TonApiHttpError) {
      return errorResponse(error.status, error.message, error.details)
    }

    if (error instanceof Error) {
      return errorResponse(500, "Failed to build TVM trace report.", error.message)
    }

    return errorResponse(500, "Unexpected error while building TVM trace report.")
  }
}
