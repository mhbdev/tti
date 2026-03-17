import type { TraceRiskLevel } from "@/lib/tvm/types"

const NANO_TON_BASE = BigInt("1000000000")

export function shortHash(hash: string, start = 8, end = 6): string {
  if (!hash || hash.length <= start + end + 3) {
    return hash
  }
  return `${hash.slice(0, start)}...${hash.slice(-end)}`
}

export function formatUnixTime(value: string): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "N/A"
  }

  const date = new Date(numeric * 1000)
  if (Number.isNaN(date.getTime())) {
    return "N/A"
  }
  return date.toLocaleString()
}

export function formatNanoTon(value: string): string {
  const sanitized = value.trim()
  if (!sanitized) {
    return "0 TON"
  }

  try {
    const isNegative = sanitized.startsWith("-")
    const abs = BigInt(isNegative ? sanitized.slice(1) : sanitized)
    const whole = abs / NANO_TON_BASE
    const fractional = (abs % NANO_TON_BASE)
      .toString()
      .padStart(9, "0")
      .replace(/0+$/, "")

    const tonString = fractional ? `${whole.toString()}.${fractional}` : whole.toString()
    return `${isNegative ? "-" : ""}${tonString} TON`
  } catch {
    return `${value} nanoTON`
  }
}

export function toRiskLabel(riskLevel: TraceRiskLevel): string {
  if (riskLevel === "high") {
    return "High"
  }
  if (riskLevel === "medium") {
    return "Medium"
  }
  return "Low"
}
