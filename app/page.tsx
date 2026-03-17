"use client"

import { FormEvent, useMemo, useState } from "react"
import { useCompletion } from "@ai-sdk/react"

import { MarkdownView } from "@/components/tvm/markdown-view"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Progress,
  ProgressLabel,
} from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buildTraceReportMarkdown } from "@/lib/tvm/export-markdown"
import { formatNanoTon, formatUnixTime, shortHash, toRiskLabel } from "@/lib/tvm/format"
import { cn } from "@/lib/utils"
import {
  isValidTxHash,
  normalizeTxHashInput,
  type TraceReportPayload,
  type TraceRiskLevel,
} from "@/lib/tvm/types"

import { Spinner } from "@/components/ui/spinner"

async function getResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string; details?: string }
    if (typeof data.error === "string") {
      return data.details ? `${data.error} ${data.details}` : data.error
    }
  } catch {
    // Intentionally ignored. Fallback is returned.
  }
  return fallback
}

function riskBadgeVariant(level: TraceRiskLevel): "destructive" | "secondary" | "outline" {
  if (level === "high") {
    return "destructive"
  }
  if (level === "medium") {
    return "secondary"
  }
  return "outline"
}

export default function Home() {
  const [txHash, setTxHash] = useState("")
  const [submittedHash, setSubmittedHash] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [isFetchingReport, setIsFetchingReport] = useState(false)
  const [report, setReport] = useState<TraceReportPayload | null>(null)

  const {
    completion,
    complete,
    setCompletion,
    stop,
    isLoading: isInterpreting,
    error: interpretationError,
  } = useCompletion({
    api: "/api/tvm/interpret",
    streamProtocol: "text",
  })

  const hasSubmitted = submittedHash !== null

  const busy = isFetchingReport || isInterpreting

  const canExport = useMemo(() => {
    return Boolean(report)
  }, [report])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = normalizeTxHashInput(txHash)
    if (!isValidTxHash(normalized)) {
      setValidationError(
        "Please provide a valid TON transaction hash (64 hex chars or base64url hash)."
      )
      return
    }

    setValidationError(null)
    setReportError(null)
    setSubmittedHash(normalized)
    setReport(null)
    setCompletion("")
    stop()
    setIsFetchingReport(true)

    try {
      const reportResponse = await fetch("/api/tvm/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          txHash: normalized,
        }),
      })

      if (!reportResponse.ok) {
        throw new Error(
          await getResponseError(reportResponse, "Failed to generate deterministic report.")
        )
      }

      const nextReport = (await reportResponse.json()) as TraceReportPayload
      setReport(nextReport)
      setIsFetchingReport(false)

      await complete(normalized, {
        body: {
          reportContext: nextReport.reportContext,
          assessment: nextReport.assessment,
        },
      })
    } catch (error) {
      setIsFetchingReport(false)
      if (error instanceof Error) {
        setReportError(error.message)
      } else {
        setReportError("Unexpected error while processing the transaction.")
      }
    }
  }

  function handleDownloadReport() {
    if (!report) {
      return
    }

    const markdown = buildTraceReportMarkdown(report, completion)
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    anchor.href = url
    anchor.download = `tvm-trace-report-${report.canonicalTxHash.slice(0, 12)}-${ts}.md`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,oklch(0.98_0.02_250),oklch(1_0_0)_45%,oklch(0.98_0.015_230))] dark:bg-[radial-gradient(circle_at_top,oklch(0.26_0.03_256),oklch(0.15_0_0)_45%)]">
      <main
        className={cn(
          "mx-auto flex w-full max-w-6xl flex-col px-4 transition-all duration-500",
          hasSubmitted ? "py-10" : "min-h-screen justify-center py-12"
        )}
      >
        <section className={cn("mx-auto w-full max-w-3xl", hasSubmitted ? "mb-8" : "mb-0")}>
          <Card className="border-foreground/10 shadow-sm backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-base">TON TVM Trace Interpreter</CardTitle>
              <CardDescription>
                Enter a transaction hash to fetch deterministic trace data and generate an AI
                interpretation using Gemini 2.5 Flash.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={handleSubmit}>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={txHash}
                    onChange={(event) => setTxHash(event.target.value)}
                    placeholder="Transaction hash (hex or base64url)"
                    className="h-10 font-mono text-xs"
                    disabled={busy}
                    aria-invalid={Boolean(validationError)}
                  />
                  <Button type="submit" className="h-10 sm:w-36" disabled={busy}>
                    {busy ? (
                      <>
                        <Spinner />
                        Processing
                      </>
                    ) : (
                      "Analyze"
                    )}
                  </Button>
                </div>
                {validationError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Invalid Input</AlertTitle>
                    <AlertDescription>{validationError}</AlertDescription>
                  </Alert>
                ) : null}
              </form>
            </CardContent>
          </Card>
        </section>

        {hasSubmitted ? (
          <section className="space-y-4">
            {reportError ? (
              <Alert variant="destructive">
                <AlertTitle>Request Failed</AlertTitle>
                <AlertDescription>{reportError}</AlertDescription>
              </Alert>
            ) : null}

            {interpretationError ? (
              <Alert variant="destructive">
                <AlertTitle>Interpretation Stream Error</AlertTitle>
                <AlertDescription>{interpretationError.message}</AlertDescription>
              </Alert>
            ) : null}

            {isFetchingReport ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-44" />
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-5/6" />
                    <Skeleton className="h-3 w-3/4" />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-44" />
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Skeleton className="h-24 w-full" />
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {report ? (
              <>
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card className="lg:col-span-1">
                    <CardHeader>
                      <CardTitle>AI Assessment</CardTitle>
                      <CardDescription>Conservative risk scoring from deterministic data.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={riskBadgeVariant(report.assessment.riskLevel)}>
                          {toRiskLabel(report.assessment.riskLevel)} Risk
                        </Badge>
                        <Badge variant="outline">
                          {report.assessmentSource === "ai" ? "AI Scoring" : "Fallback Scoring"}
                        </Badge>
                        <Badge variant="outline">
                          Scam Score {report.assessment.scamScore}/100
                        </Badge>
                        <Badge variant="outline">
                          Confidence {report.assessment.confidence}/100
                        </Badge>
                      </div>
                      <p className="text-sm leading-6">{report.assessment.verdict}</p>
                      {report.assessmentNote ? (
                        <Alert>
                          <AlertTitle>Assessment Note</AlertTitle>
                          <AlertDescription>{report.assessmentNote}</AlertDescription>
                        </Alert>
                      ) : null}
                      <Progress value={report.assessment.scamScore}>
                        <ProgressLabel>Scam Score</ProgressLabel>
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                          {report.assessment.scamScore}/100
                        </span>
                      </Progress>
                      <Progress value={report.assessment.confidence}>
                        <ProgressLabel>Confidence</ProgressLabel>
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                          {report.assessment.confidence}/100
                        </span>
                      </Progress>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Evidence</p>
                        <ul className="list-disc space-y-1 pl-4 text-xs/relaxed text-muted-foreground">
                          {report.assessment.evidence.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle>Transaction Overview</CardTitle>
                      <CardDescription>
                        Canonical hash:{" "}
                        <span className="font-mono">{report.canonicalTxHash}</span>
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="rounded-md border p-3">
                          <p className="text-xs text-muted-foreground">Account</p>
                          <p className="mt-1 font-mono text-xs">
                            {shortHash(report.deterministic.transaction.account, 14, 10)}
                          </p>
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="text-xs text-muted-foreground">Type</p>
                          <p className="mt-1 text-xs font-medium">
                            {report.deterministic.transaction.transactionType}
                          </p>
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="text-xs text-muted-foreground">Status</p>
                          <p className="mt-1 text-xs font-medium">
                            {report.deterministic.transaction.success ? "Success" : "Failure"}
                          </p>
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="text-xs text-muted-foreground">Total Fees</p>
                          <p className="mt-1 text-xs font-medium">
                            {formatNanoTon(report.deterministic.transaction.totalFeesNanoTon)}
                          </p>
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="text-xs text-muted-foreground">End Balance</p>
                          <p className="mt-1 text-xs font-medium">
                            {formatNanoTon(report.deterministic.transaction.endBalanceNanoTon)}
                          </p>
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="text-xs text-muted-foreground">Timestamp</p>
                          <p className="mt-1 text-xs font-medium">
                            {formatUnixTime(report.deterministic.transaction.utime)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Deterministic Data</CardTitle>
                    <CardDescription>
                      TonAPI transaction, trace, and event snapshots used for analysis.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="transaction">
                      <TabsList>
                        <TabsTrigger value="transaction">Transaction</TabsTrigger>
                        <TabsTrigger value="trace">
                          Trace Nodes ({report.deterministic.traceNodes.length})
                        </TabsTrigger>
                        <TabsTrigger value="actions">
                          Actions ({report.deterministic.event.actions.length})
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="transaction">
                        <Table>
                          <TableBody>
                            <TableRow>
                              <TableHead>Hash</TableHead>
                              <TableCell className="font-mono text-xs">
                                {report.deterministic.transaction.hash}
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableHead>Logical Time</TableHead>
                              <TableCell>{report.deterministic.transaction.lt}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableHead>Interfaces</TableHead>
                              <TableCell>
                                {report.deterministic.transaction.interfaces.length
                                  ? report.deterministic.transaction.interfaces.join(", ")
                                  : "N/A"}
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableHead>In Message</TableHead>
                              <TableCell className="font-mono text-xs">
                                {report.deterministic.transaction.inMessage?.hash || "N/A"}
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableHead>Compute Exit Code</TableHead>
                              <TableCell>
                                {report.deterministic.transaction.computePhase?.exitCode ?? "N/A"}
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableHead>Gas Used</TableHead>
                              <TableCell>
                                {report.deterministic.transaction.computePhase?.gasUsed ?? "N/A"}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </TabsContent>

                      <TabsContent value="trace">
                        <ScrollArea className="h-96 rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Depth</TableHead>
                                <TableHead>Hash</TableHead>
                                <TableHead>Account</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Direction</TableHead>
                                <TableHead>Success</TableHead>
                                <TableHead>Fees</TableHead>
                                <TableHead>Gas Used</TableHead>
                                <TableHead>Exit</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {report.deterministic.traceNodes.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                                    Trace nodes are unavailable for this request.
                                  </TableCell>
                                </TableRow>
                              ) : (
                                report.deterministic.traceNodes.map((node) => (
                                  <TableRow key={`${node.hash}-${node.depth}`}>
                                    <TableCell>{node.depth}</TableCell>
                                    <TableCell className="font-mono text-xs">{shortHash(node.hash)}</TableCell>
                                    <TableCell className="font-mono text-xs">
                                      {shortHash(node.account, 8, 6)}
                                    </TableCell>
                                    <TableCell>{node.transactionType}</TableCell>
                                    <TableCell>{node.direction}</TableCell>
                                    <TableCell>{node.success ? "yes" : "no"}</TableCell>
                                    <TableCell>{formatNanoTon(node.totalFeesNanoTon)}</TableCell>
                                    <TableCell>{node.gasUsed ?? "N/A"}</TableCell>
                                    <TableCell>{node.exitCode ?? "N/A"}</TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      </TabsContent>

                      <TabsContent value="actions">
                        <div className="space-y-3">
                          {report.deterministic.event.actions.length === 0 ? (
                            <Empty className="border">
                              <EmptyHeader>
                                <EmptyTitle>No Actions Detected</EmptyTitle>
                                <EmptyDescription>
                                  This trace does not include high-level TonAPI event actions.
                                </EmptyDescription>
                              </EmptyHeader>
                            </Empty>
                          ) : (
                            report.deterministic.event.actions.map((action, index) => (
                              <Card key={`${action.type}-${index}`} size="sm">
                                <CardHeader>
                                  <CardTitle>{action.type}</CardTitle>
                                  <CardDescription>
                                    Status: {action.status}{" "}
                                    {action.value ? `| Value: ${action.value}` : ""}
                                  </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-1 text-xs/relaxed text-muted-foreground">
                                  <p>{action.description ?? "No description available."}</p>
                                  <p>
                                    Base Transactions:{" "}
                                    {action.baseTransactions.length
                                      ? action.baseTransactions.map((tx) => shortHash(tx)).join(", ")
                                      : "N/A"}
                                  </p>
                                </CardContent>
                              </Card>
                            ))
                          )}
                        </div>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <CardTitle>LLM Interpretation</CardTitle>
                        <CardDescription>
                          Streamed markdown narrative aligned with deterministic trace data.
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {isInterpreting ? (
                          <Badge variant="secondary">
                            <Spinner className="mr-1" />
                            Streaming
                          </Badge>
                        ) : (
                          <Badge variant="outline">Ready</Badge>
                        )}
                        <Button
                          variant="outline"
                          onClick={stop}
                          disabled={!isInterpreting}
                        >
                          Stop
                        </Button>
                        <Button onClick={handleDownloadReport} disabled={!canExport}>
                          Download Report (.md)
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {completion ? (
                      <MarkdownView content={completion} />
                    ) : (
                      <Empty className="border">
                        <EmptyHeader>
                          <EmptyTitle>Waiting For Interpretation</EmptyTitle>
                          <EmptyDescription>
                            The streamed analysis will appear here after deterministic loading.
                          </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                          {isInterpreting ? (
                            <div className="inline-flex items-center gap-2 text-muted-foreground">
                              <Spinner />
                              Generating interpretation...
                            </div>
                          ) : null}
                        </EmptyContent>
                      </Empty>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  )
}
