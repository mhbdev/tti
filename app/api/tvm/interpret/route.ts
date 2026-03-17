import { google } from "@ai-sdk/google"
import { streamText } from "ai"
import { NextResponse } from "next/server"
import { ZodError } from "zod"

import { interpretRequestSchema } from "@/lib/tvm/types"

export const maxDuration = 60
type InterpretRequest = ReturnType<typeof interpretRequestSchema.parse>

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

function buildFallbackInterpretation({
  txHash,
  reason,
  reportContext,
  assessment,
}: {
  txHash: string
  reason: string
  reportContext: InterpretRequest["reportContext"]
  assessment: InterpretRequest["assessment"]
}): string {
  const failedNodes = reportContext.traceDigest.filter((node) => !node.success).length
  const failedActions = reportContext.eventDigest.actions.filter(
    (action) => action.status === "failed"
  ).length

  return [
    "## Summary",
    `Fallback interpretation generated because live AI streaming was unavailable (${reason}).`,
    `Transaction hash: \`${txHash}\``,
    `Risk level: **${assessment.riskLevel}** | Scam score: **${assessment.scamScore}/100** | Confidence: **${assessment.confidence}/100**`,
    "",
    "## Execution Path",
    `Trace nodes observed: ${reportContext.traceDigest.length}.`,
    `Failed nodes: ${failedNodes}. Primary transaction success: ${reportContext.transaction.success}.`,
    "",
    "## Action Breakdown",
    `Actions observed: ${reportContext.eventDigest.actions.length}. Failed actions: ${failedActions}.`,
    reportContext.eventDigest.actions.length
      ? reportContext.eventDigest.actions
          .slice(0, 8)
          .map(
            (action, index) =>
              `${index + 1}. ${action.type} (${action.status})${
                action.description ? ` - ${action.description}` : ""
              }`
          )
          .join("\n")
      : "No high-level actions were returned by TonAPI for this trace.",
    "",
    "## Fees and Value Flow",
    reportContext.eventDigest.valueFlow.length
      ? reportContext.eventDigest.valueFlow
          .slice(0, 8)
          .map(
            (flow) =>
              `- ${flow.account}: ton=${flow.tonNanoTon} nanoTON, fees=${flow.feesNanoTon} nanoTON`
          )
          .join("\n")
      : "No event-level value flow rows available.",
    "",
    "## Risks and Anomalies",
    reportContext.eventDigest.isScam
      ? "- TonAPI marks this event as scam."
      : "- TonAPI does not explicitly mark this event as scam.",
    reportContext.eventDigest.inProgress
      ? `- Event is still in progress (progress=${reportContext.eventDigest.progress.toFixed(2)}), so interpretation certainty is reduced.`
      : "- Event is finalized according to TonAPI.",
    failedNodes > 0 ? `- ${failedNodes} trace node(s) indicate unsuccessful execution.` : "- No failed trace nodes were detected.",
    failedActions > 0 ? `- ${failedActions} action(s) are marked failed.` : "- No failed actions detected at event level.",
    "",
    "## Confidence and Scam Scoring",
    ...assessment.evidence.map((entry) => `- ${entry}`),
    "",
  ].join("\n")
}

export async function POST(request: Request) {
  try {
    const payload = await request.json()
    const parsed = interpretRequestSchema.parse(payload)

    const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
    if (!key) {
      return new Response(
        buildFallbackInterpretation({
          txHash: parsed.prompt,
          reason: "GOOGLE_GENERATIVE_AI_API_KEY missing",
          reportContext: parsed.reportContext,
          assessment: parsed.assessment,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          },
        }
      )
    }

    const result = streamText({
      model: google("gemini-2.5-flash"),
      system: [
        "You are an expert TON TVM trace interpreter.",
        "Produce a structured markdown report with concise, factual language.",
        "Use exactly these sections in order:",
        "## Summary",
        "## Execution Path",
        "## Action Breakdown",
        "## Fees and Value Flow",
        "## Risks and Anomalies",
        "## Confidence and Scam Scoring",
        "Keep analysis grounded in provided data only.",
        "When evidence is weak, say it explicitly.",
        "Align confidence and scam discussion with provided numeric scores.",
      ].join("\n"),
      prompt: [
        `User input hash: ${parsed.prompt}`,
        "",
        "Structured assessment:",
        JSON.stringify(parsed.assessment),
        "",
        "Deterministic context:",
        JSON.stringify(parsed.reportContext),
        "",
        "Generate the final markdown interpretation.",
      ].join("\n"),
      temperature: 0.2,
      maxRetries: 1,
      timeout: 20000,
    })

    const encoder = new TextEncoder()
    const textStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let emitted = false
        try {
          for await (const chunk of result.textStream) {
            emitted = true
            controller.enqueue(encoder.encode(chunk))
          }
        } catch (streamError) {
          const reason =
            streamError instanceof Error ? streamError.message : "AI stream failed unexpectedly"
          const fallback = buildFallbackInterpretation({
            txHash: parsed.prompt,
            reason,
            reportContext: parsed.reportContext,
            assessment: parsed.assessment,
          })
          if (!emitted) {
            controller.enqueue(encoder.encode(fallback))
          } else {
            controller.enqueue(
              encoder.encode(
                `\n\n## Stream Interruption\nLive AI stream stopped early (${reason}).\n\n${fallback}`
              )
            )
          }
        } finally {
          controller.close()
        }
      },
    })

    return new Response(textStream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "Invalid request body.", error.message)
    }
    if (error instanceof Error) {
      return errorResponse(500, "Failed to stream interpretation.", error.message)
    }
    return errorResponse(500, "Unexpected interpretation error.")
  }
}
