import { google } from "@ai-sdk/google"
import { generateText, Output } from "ai"

import type { TraceAssessment, TraceReportContext, TraceRiskLevel } from "@/lib/tvm/types"
import { traceAssessmentSchema } from "@/lib/tvm/types"

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

function riskLevelFromScore(score: number): TraceRiskLevel {
  if (score >= 70) {
    return "high"
  }
  if (score >= 35) {
    return "medium"
  }
  return "low"
}

function compactReason(reason?: string): string | undefined {
  if (!reason) {
    return undefined
  }
  const normalized = reason.replace(/\s+/g, " ").trim()
  if (!normalized) {
    return undefined
  }
  if (normalized.length <= 260) {
    return normalized
  }
  return `${normalized.slice(0, 257)}...`
}

export async function generateTraceAssessment(
  reportContext: TraceReportContext
): Promise<TraceAssessment> {
  const { output } = await generateText({
    model: google("gemini-2.5-flash"),
    output: Output.object({
      name: "trace_assessment",
      description:
        "Conservative security assessment for a TON trace, with confidence and scam scoring.",
      schema: traceAssessmentSchema,
    }),
    system: [
      "You are a TON blockchain trace analyst.",
      "Return structured output only via the provided schema.",
      "Use a conservative scam scoring approach:",
      "- Scam score above 70 only for strong direct on-chain evidence of malicious behavior.",
      "- Low-information traces should keep scam scores low-to-medium.",
      "Confidence reflects your certainty in this assessment, not transaction success.",
      "Cite concrete evidence from the input context only.",
    ].join("\n"),
    prompt: [
      "Analyze this TON trace context and provide a security/risk assessment.",
      "Do not invent facts outside the data.",
      "",
      JSON.stringify(reportContext),
    ].join("\n"),
    temperature: 0.2,
  })

  const parsed = traceAssessmentSchema.parse(output)
  const scamScore = clampScore(parsed.scamScore)
  const confidence = clampScore(parsed.confidence)

  return {
    confidence,
    scamScore,
    riskLevel: riskLevelFromScore(scamScore),
    verdict: parsed.verdict.trim(),
    evidence: parsed.evidence.map((entry) => entry.trim()).filter(Boolean),
  }
}

export function buildFallbackAssessment(
  reportContext: TraceReportContext,
  reason?: string
): TraceAssessment {
  let scamScore = 8
  let confidence = 58

  const failedNodes = reportContext.traceDigest.filter((node) => !node.success).length
  const failedActions = reportContext.eventDigest.actions.filter(
    (action) => action.status === "failed"
  ).length

  if (reportContext.eventDigest.isScam) {
    scamScore += 55
    confidence += 8
  }
  if (!reportContext.transaction.success) {
    scamScore += 15
    confidence += 4
  }
  if (failedNodes > 0) {
    scamScore += Math.min(15, failedNodes * 3)
    confidence += 3
  }
  if (failedActions > 0) {
    scamScore += Math.min(10, failedActions * 4)
    confidence += 3
  }
  if (reportContext.eventDigest.inProgress) {
    scamScore += 6
    confidence -= 12
  }
  if (reportContext.traceDigest.length <= 1) {
    confidence -= 8
  } else if (reportContext.traceDigest.length >= 4) {
    confidence += 5
  }

  scamScore = clampScore(scamScore)
  confidence = clampScore(confidence)
  const riskLevel = riskLevelFromScore(scamScore)

  const evidence: string[] = []
  evidence.push(
    `Fallback heuristic used over ${reportContext.traceDigest.length} trace node(s) and ${reportContext.eventDigest.actions.length} action(s).`
  )
  evidence.push(
    `Transaction success: ${reportContext.transaction.success ? "true" : "false"}; failed nodes: ${failedNodes}; failed actions: ${failedActions}.`
  )
  if (reportContext.eventDigest.isScam) {
    evidence.push("TonAPI event payload includes isScam=true.")
  } else {
    evidence.push("TonAPI event payload does not explicitly mark this event as scam.")
  }
  if (reportContext.eventDigest.inProgress) {
    evidence.push(
      `Event is still in progress (progress=${reportContext.eventDigest.progress.toFixed(2)}), lowering certainty.`
    )
  }
  const compact = compactReason(reason)
  if (compact) {
    evidence.push(`AI scoring unavailable: ${compact}`)
  }

  let verdict = "Low-risk indicators dominate in this trace snapshot."
  if (riskLevel === "medium") {
    verdict = "Mixed indicators detected. Manual review is recommended."
  }
  if (riskLevel === "high") {
    verdict = "Strong risk indicators detected in this trace snapshot."
  }

  return {
    confidence,
    scamScore,
    riskLevel,
    verdict,
    evidence: evidence.slice(0, 8),
  }
}
