import type { TraceReportPayload } from "@/lib/tvm/types"
import { formatNanoTon, formatUnixTime } from "@/lib/tvm/format"

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function markdownTable(headers: string[], rows: string[][]): string {
  const headerLine = `| ${headers.map(escapeCell).join(" | ")} |`
  const separator = `| ${headers.map(() => "---").join(" | ")} |`
  const body = rows.map((row) => `| ${row.map((cell) => escapeCell(cell)).join(" | ")} |`)
  return [headerLine, separator, ...body].join("\n")
}

export function buildTraceReportMarkdown(payload: TraceReportPayload, interpretation: string): string {
  const tx = payload.deterministic.transaction
  const assessment = payload.assessment
  const generatedAt = new Date().toISOString()

  const lines: string[] = [
    "# TVM Trace Interpretation Report",
    "",
    `- Generated At: ${generatedAt}`,
    `- Network: ${payload.network}`,
    `- Canonical Transaction Hash: ${payload.canonicalTxHash}`,
    `- Assessment Source: ${payload.assessmentSource}`,
    ...(payload.assessmentNote ? [`- Assessment Note: ${payload.assessmentNote}`] : []),
    "",
    "## Structured Assessment",
    "",
    `- Confidence: ${assessment.confidence}/100`,
    `- Scam Score: ${assessment.scamScore}/100`,
    `- Risk Level: ${assessment.riskLevel}`,
    `- Verdict: ${assessment.verdict}`,
    "",
    "### Evidence",
    "",
    ...assessment.evidence.map((item) => `- ${item}`),
    "",
    "## Deterministic Transaction Summary",
    "",
    markdownTable(
      ["Field", "Value"],
      [
        ["Account", tx.account],
        ["Account Name", tx.accountName ?? "N/A"],
        ["Transaction Type", tx.transactionType],
        ["Success", String(tx.success)],
        ["Aborted", String(tx.aborted)],
        ["Destroyed", String(tx.destroyed)],
        ["LT", tx.lt],
        ["Timestamp", formatUnixTime(tx.utime)],
        ["Total Fees", `${tx.totalFeesNanoTon} (${formatNanoTon(tx.totalFeesNanoTon)})`],
        ["End Balance", `${tx.endBalanceNanoTon} (${formatNanoTon(tx.endBalanceNanoTon)})`],
        ["Out Messages", String(tx.outMessagesCount)],
      ]
    ),
    "",
    `## Trace Nodes (${payload.deterministic.traceNodes.length})`,
    "",
    markdownTable(
      ["Depth", "Tx Hash", "Account", "Type", "Direction", "Success", "Fees (nanoTON)", "Gas Used", "Exit Code"],
      payload.deterministic.traceNodes.map((node) => [
        String(node.depth),
        node.hash,
        node.account,
        node.transactionType,
        node.direction,
        String(node.success),
        node.totalFeesNanoTon,
        node.gasUsed ?? "N/A",
        node.exitCode != null ? String(node.exitCode) : "N/A",
      ])
    ),
    "",
    `## Event Actions (${payload.deterministic.event.actions.length})`,
    "",
    markdownTable(
      ["Type", "Status", "Description", "Value", "Base Transactions"],
      payload.deterministic.event.actions.map((action) => [
        action.type,
        action.status,
        action.description ?? "N/A",
        action.value ?? "N/A",
        action.baseTransactions.join(", ") || "N/A",
      ])
    ),
    "",
    `## Value Flow (${payload.deterministic.event.valueFlow.length})`,
    "",
    markdownTable(
      ["Account", "TON (nanoTON)", "TON", "Fees (nanoTON)", "Fees"],
      payload.deterministic.event.valueFlow.map((flow) => [
        flow.account,
        flow.tonNanoTon,
        formatNanoTon(flow.tonNanoTon),
        flow.feesNanoTon,
        formatNanoTon(flow.feesNanoTon),
      ])
    ),
    "",
    "## Streamed Interpretation",
    "",
    interpretation.trim() || "_No interpretation was produced._",
    "",
  ]

  return lines.join("\n")
}
