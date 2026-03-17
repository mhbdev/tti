import type {
  DeterministicActionSummary,
  DeterministicEventSummary,
  DeterministicMessageSummary,
  DeterministicSnapshot,
  DeterministicTraceNode,
  DeterministicTransactionSummary,
  DeterministicValueFlowSummary,
  TraceReportContext,
} from "@/lib/tvm/types"
import type {
  TonApiAction,
  TonApiEvent,
  TonApiMessage,
  TonApiTrace,
  TonApiTransaction,
  TonApiValueFlow,
} from "@/lib/tvm/tonapi"

function asStringNumber(value: unknown, fallback = "0"): string {
  if (typeof value === "string" && value.length > 0) {
    return value
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString()
  }
  if (typeof value === "bigint") {
    return value.toString()
  }

  return fallback
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString()
  }

  return fallback
}

function normalizeMessage(message: TonApiMessage | undefined): DeterministicMessageSummary | undefined {
  if (!message) {
    return undefined
  }

  return {
    hash: asString(message.hash, ""),
    msgType: asString(message.msg_type, "unknown"),
    source: message.source?.address,
    sourceName: message.source?.name,
    destination: message.destination?.address,
    destinationName: message.destination?.name,
    valueNanoTon: asStringNumber(message.value, "0"),
    opCode: message.op_code,
    decodedOpName: message.decoded_op_name,
    createdAt: message.created_at != null ? asString(message.created_at, "") : undefined,
    bounce: message.bounce,
    bounced: message.bounced,
  }
}

function inferDirection(transaction: TonApiTransaction): "inbound" | "outbound" | "internal" {
  const inType = transaction.in_msg?.msg_type
  if (inType === "ext_in_msg") {
    return "inbound"
  }
  if (inType === "ext_out_msg") {
    return "outbound"
  }
  return "internal"
}

function normalizeTransaction(
  transaction: TonApiTransaction,
  interfaces: string[] | undefined
): DeterministicTransactionSummary {
  return {
    hash: transaction.hash,
    account: transaction.account.address,
    accountName: transaction.account.name,
    lt: asStringNumber(transaction.lt),
    utime: asString(transaction.utime, ""),
    success: Boolean(transaction.success),
    aborted: Boolean(transaction.aborted),
    destroyed: Boolean(transaction.destroyed),
    transactionType: asString(transaction.transaction_type, "unknown"),
    totalFeesNanoTon: asStringNumber(transaction.total_fees),
    endBalanceNanoTon: asStringNumber(transaction.end_balance),
    outMessagesCount: transaction.out_msgs?.length ?? 0,
    interfaces: interfaces ?? [],
    inMessage: normalizeMessage(transaction.in_msg),
    computePhase: transaction.compute_phase
      ? {
          skipped: Boolean(transaction.compute_phase.skipped),
          gasUsed:
            transaction.compute_phase.gas_used != null
              ? asStringNumber(transaction.compute_phase.gas_used)
              : undefined,
          gasFeesNanoTon:
            transaction.compute_phase.gas_fees != null
              ? asStringNumber(transaction.compute_phase.gas_fees)
              : undefined,
          vmSteps: transaction.compute_phase.vm_steps,
          exitCode: transaction.compute_phase.exit_code,
          exitCodeDescription: transaction.compute_phase.exit_code_description,
        }
      : undefined,
    actionPhase: transaction.action_phase
      ? {
          success: transaction.action_phase.success,
          resultCode: transaction.action_phase.result_code,
          totalActions: transaction.action_phase.total_actions,
          skippedActions: transaction.action_phase.skipped_actions,
          totalFeesNanoTon:
            transaction.action_phase.total_fees != null
              ? asStringNumber(transaction.action_phase.total_fees)
              : undefined,
          fwdFeesNanoTon:
            transaction.action_phase.fwd_fees != null
              ? asStringNumber(transaction.action_phase.fwd_fees)
              : undefined,
        }
      : undefined,
  }
}

function flattenTrace(
  node: TonApiTrace,
  depth: number,
  acc: DeterministicTraceNode[],
  parentHash?: string
) {
  const tx = node.transaction
  acc.push({
    depth,
    hash: tx.hash,
    parentHash,
    account: tx.account.address,
    accountName: tx.account.name,
    success: Boolean(tx.success),
    aborted: Boolean(tx.aborted),
    transactionType: asString(tx.transaction_type, "unknown"),
    direction: inferDirection(tx),
    totalFeesNanoTon: asStringNumber(tx.total_fees),
    gasUsed:
      tx.compute_phase?.gas_used != null ? asStringNumber(tx.compute_phase.gas_used) : undefined,
    vmSteps: tx.compute_phase?.vm_steps,
    exitCode: tx.compute_phase?.exit_code,
  })

  for (const child of node.children ?? []) {
    flattenTrace(child, depth + 1, acc, tx.hash)
  }
}

function normalizeAction(action: TonApiAction): DeterministicActionSummary {
  return {
    type: action.type,
    status: action.status,
    name: action.simple_preview?.name,
    description: action.simple_preview?.description,
    value: action.simple_preview?.value,
    accounts: (action.simple_preview?.accounts ?? [])
      .map((account) => account.address)
      .filter(Boolean),
    baseTransactions: (action.base_transactions ?? []).filter(Boolean),
  }
}

function normalizeValueFlow(flow: TonApiValueFlow): DeterministicValueFlowSummary {
  return {
    account: flow.account.address,
    accountName: flow.account.name,
    tonNanoTon: asStringNumber(flow.ton),
    feesNanoTon: asStringNumber(flow.fees),
    jettons: (flow.jettons ?? []).map((jetton) => ({
      jettonSymbol: jetton.jetton?.symbol,
      jettonAddress: jetton.jetton?.address,
      quantity: asStringNumber(jetton.qty ?? jetton.quantity),
      account: jetton.account.address,
    })),
  }
}

function normalizeEvent(event: TonApiEvent): DeterministicEventSummary {
  return {
    eventId: event.event_id,
    timestamp: asString(event.timestamp, ""),
    inProgress: Boolean(event.in_progress),
    progress:
      typeof event.progress === "number" && Number.isFinite(event.progress)
        ? event.progress
        : 0,
    isScam: Boolean(event.is_scam),
    actions: (event.actions ?? []).map(normalizeAction),
    valueFlow: (event.value_flow ?? []).map(normalizeValueFlow),
  }
}

export function buildDeterministicSnapshot({
  trace,
  event,
  transaction,
}: {
  trace: TonApiTrace
  event: TonApiEvent
  transaction: TonApiTransaction
}): DeterministicSnapshot {
  const traceNodes: DeterministicTraceNode[] = []
  flattenTrace(trace, 0, traceNodes)

  return {
    transaction: normalizeTransaction(transaction, trace.interfaces),
    traceNodes,
    event: normalizeEvent(event),
  }
}

export function buildReportContext(
  deterministic: DeterministicSnapshot,
  canonicalTxHash: string
): TraceReportContext {
  return {
    network: "mainnet",
    canonicalTxHash,
    transaction: {
      account: deterministic.transaction.account,
      success: deterministic.transaction.success,
      transactionType: deterministic.transaction.transactionType,
      outMessagesCount: deterministic.transaction.outMessagesCount,
      totalFeesNanoTon: deterministic.transaction.totalFeesNanoTon,
    },
    traceDigest: deterministic.traceNodes.map((node) => ({
      depth: node.depth,
      hash: node.hash,
      account: node.account,
      success: node.success,
      transactionType: node.transactionType,
      direction: node.direction,
      totalFeesNanoTon: node.totalFeesNanoTon,
      gasUsed: node.gasUsed,
      exitCode: node.exitCode,
    })),
    eventDigest: {
      eventId: deterministic.event.eventId,
      actions: deterministic.event.actions.map((action) => ({
        type: action.type,
        status: action.status,
        description: action.description,
        value: action.value,
        baseTransactions: action.baseTransactions,
      })),
      valueFlow: deterministic.event.valueFlow.map((flow) => ({
        account: flow.account,
        tonNanoTon: flow.tonNanoTon,
        feesNanoTon: flow.feesNanoTon,
      })),
      inProgress: deterministic.event.inProgress,
      progress: deterministic.event.progress,
      isScam: deterministic.event.isScam,
    },
  }
}
