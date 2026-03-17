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
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Progress, ProgressLabel } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
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
import {
  isValidTxHash,
  normalizeTxHashInput,
  type TraceReportPayload,
  type TraceRiskLevel,
} from "@/lib/tvm/types"

async function getResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string; details?: string }
    if (typeof data.error === "string") {
      return data.details ? `${data.error} ${data.details}` : data.error
    }
  } catch {
    // Fall through to fallback text.
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

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium text-foreground">{value}</span>
    </div>
  )
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

  const busy = isFetchingReport || isInterpreting
  const hasReport = Boolean(report)
  const canExport = useMemo(() => Boolean(report), [report])

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
    <div className="min-h-screen bg-background">
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-6 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            TVM Trace Interpreter
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Analyze TON transaction traces with deterministic TonAPI data and streamed
            model-assisted interpretation.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-12">
          <aside className="min-w-0 space-y-6 lg:col-span-4">
            <Card className="border shadow-none">
              <CardHeader>
                <CardTitle>Analysis Input</CardTitle>
                <CardDescription>
                  Submit a transaction hash to fetch and interpret the trace.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <Input
                    value={txHash}
                    onChange={(event) => setTxHash(event.target.value)}
                    placeholder="Transaction hash (hex or base64url)"
                    className="h-9 font-mono text-xs"
                    disabled={busy}
                    aria-invalid={Boolean(validationError)}
                  />

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Button type="submit" className="h-9 w-full" disabled={busy}>
                      {busy ? (
                        <>
                          <Spinner />
                          Processing
                        </>
                      ) : (
                        "Analyze"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 w-full"
                      onClick={stop}
                      disabled={!isInterpreting}
                    >
                      Stop
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 w-full"
                      onClick={handleDownloadReport}
                      disabled={!canExport}
                    >
                      Download
                    </Button>
                  </div>

                  {submittedHash ? (
                    <p className="text-xs text-muted-foreground">
                      Last request: <span className="font-mono">{shortHash(submittedHash, 12, 10)}</span>
                    </p>
                  ) : null}
                </form>

                {validationError ? (
                  <Alert variant="destructive" className="mt-3">
                    <AlertTitle>Invalid Input</AlertTitle>
                    <AlertDescription>{validationError}</AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border shadow-none">
              <CardHeader>
                <CardTitle>Assessment</CardTitle>
                <CardDescription>Scam risk and confidence scoring for the current trace.</CardDescription>
              </CardHeader>
              <CardContent>
                {isFetchingReport ? (
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : hasReport && report ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={riskBadgeVariant(report.assessment.riskLevel)}>
                        {toRiskLabel(report.assessment.riskLevel)} Risk
                      </Badge>
                      <Badge variant="outline">
                        {report.assessmentSource === "ai" ? "AI" : "Fallback"}
                      </Badge>
                      <Badge variant="outline">{report.assessment.scamScore}/100 Scam</Badge>
                      <Badge variant="outline">{report.assessment.confidence}/100 Confidence</Badge>
                    </div>

                    <p className="text-sm leading-6 text-foreground">{report.assessment.verdict}</p>

                    {report.assessmentNote ? (
                      <Alert>
                        <AlertTitle>Note</AlertTitle>
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

                    <Separator />

                    <div className="space-y-1">
                      <p className="text-xs font-medium text-foreground">Evidence</p>
                      <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                        {report.assessment.evidence.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <Empty className="rounded-md border">
                    <EmptyHeader>
                      <EmptyTitle>No Assessment Yet</EmptyTitle>
                      <EmptyDescription>
                        Run an analysis to view scam scoring and confidence details.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>

            <Card className="border shadow-none">
              <CardHeader>
                <CardTitle>Quick Facts</CardTitle>
                <CardDescription>High-level transaction metadata for quick review.</CardDescription>
              </CardHeader>
              <CardContent>
                {isFetchingReport ? (
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-5/6" />
                    <Skeleton className="h-3 w-4/5" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                ) : hasReport && report ? (
                  <div className="space-y-1">
                    <FactRow label="Canonical Hash" value={shortHash(report.canonicalTxHash, 14, 10)} />
                    <FactRow
                      label="Account"
                      value={shortHash(report.deterministic.transaction.account, 12, 8)}
                    />
                    <FactRow
                      label="Transaction Type"
                      value={report.deterministic.transaction.transactionType}
                    />
                    <FactRow
                      label="Status"
                      value={report.deterministic.transaction.success ? "Success" : "Failure"}
                    />
                    <FactRow
                      label="Total Fees"
                      value={formatNanoTon(report.deterministic.transaction.totalFeesNanoTon)}
                    />
                    <FactRow
                      label="Timestamp"
                      value={formatUnixTime(report.deterministic.transaction.utime)}
                    />
                  </div>
                ) : (
                  <Empty className="rounded-md border">
                    <EmptyHeader>
                      <EmptyTitle>No Transaction Data</EmptyTitle>
                      <EmptyDescription>
                        Submit a hash to populate quick metadata and status.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
          </aside>

          <section className="min-w-0 space-y-6 lg:col-span-8">
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

            <Card className="border shadow-none">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>Deterministic Data</CardTitle>
                    <CardDescription>
                      TonAPI transaction, trace, and event snapshots used for interpretation.
                    </CardDescription>
                  </div>
                  {report ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {report.deterministic.traceNodes.length} Trace Node(s)
                      </Badge>
                      <Badge variant="outline">
                        {report.deterministic.event.actions.length} Action(s)
                      </Badge>
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                {isFetchingReport ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-72 w-full" />
                  </div>
                ) : report ? (
                  <Tabs defaultValue="transaction">
                    <TabsList className="w-full justify-start">
                      <TabsTrigger value="transaction">Transaction</TabsTrigger>
                      <TabsTrigger value="trace">Trace</TabsTrigger>
                      <TabsTrigger value="actions">Actions</TabsTrigger>
                    </TabsList>

                    <TabsContent value="transaction">
                      <Table>
                        <TableBody>
                          <TableRow>
                            <TableHead className="w-40">Hash</TableHead>
                            <TableCell className="font-mono text-xs">
                              {report.deterministic.transaction.hash}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableHead className="w-40">Logical Time</TableHead>
                            <TableCell>{report.deterministic.transaction.lt}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableHead className="w-40">Interfaces</TableHead>
                            <TableCell>
                              {report.deterministic.transaction.interfaces.length
                                ? report.deterministic.transaction.interfaces.join(", ")
                                : "N/A"}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableHead className="w-40">In Message</TableHead>
                            <TableCell className="font-mono text-xs">
                              {report.deterministic.transaction.inMessage?.hash ?? "N/A"}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableHead className="w-40">Compute Exit Code</TableHead>
                            <TableCell>
                              {report.deterministic.transaction.computePhase?.exitCode ?? "N/A"}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableHead className="w-40">Gas Used</TableHead>
                            <TableCell>
                              {report.deterministic.transaction.computePhase?.gasUsed ?? "N/A"}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </TabsContent>

                    <TabsContent value="trace">
                      <ScrollArea className="h-[360px] rounded-md border">
                        <Table className="min-w-[860px] table-fixed">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-14">Depth</TableHead>
                              <TableHead className="w-28">Hash</TableHead>
                              <TableHead className="w-24">Account</TableHead>
                              <TableHead className="w-28">Type</TableHead>
                              <TableHead className="w-20">Direction</TableHead>
                              <TableHead className="w-16">Success</TableHead>
                              <TableHead className="w-24">Fees</TableHead>
                              <TableHead className="w-20">Gas</TableHead>
                              <TableHead className="w-16">Exit</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {report.deterministic.traceNodes.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
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
                      <ScrollArea className="h-[360px] rounded-md border">
                        <Table className="min-w-[860px] table-fixed">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-28">Type</TableHead>
                              <TableHead className="w-16">Status</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead className="w-32">Value</TableHead>
                              <TableHead className="w-40">Base Transactions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {report.deterministic.event.actions.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                                  This trace does not include high-level TonAPI event actions.
                                </TableCell>
                              </TableRow>
                            ) : (
                              report.deterministic.event.actions.map((action, index) => (
                                <TableRow key={`${action.type}-${index}`}>
                                  <TableCell>{action.type}</TableCell>
                                  <TableCell>{action.status}</TableCell>
                                  <TableCell>{action.description ?? "N/A"}</TableCell>
                                  <TableCell>{action.value ?? "N/A"}</TableCell>
                                  <TableCell className="font-mono text-xs">
                                    {action.baseTransactions.length
                                      ? action.baseTransactions.map((tx) => shortHash(tx)).join(", ")
                                      : "N/A"}
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </TabsContent>
                  </Tabs>
                ) : (
                  <Empty className="rounded-md border">
                    <EmptyHeader>
                      <EmptyTitle>No Data Yet</EmptyTitle>
                      <EmptyDescription>
                        Submit a transaction hash to load deterministic transaction, trace, and event data.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>

            <Card className="border shadow-none">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>Interpretation</CardTitle>
                    <CardDescription>
                      Streamed markdown narrative aligned with deterministic data.
                    </CardDescription>
                  </div>
                  <Badge variant={isInterpreting ? "secondary" : "outline"}>
                    {isInterpreting ? "Streaming" : "Idle"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {completion ? (
                  <MarkdownView content={completion} />
                ) : isInterpreting ? (
                  <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner />
                    Generating interpretation...
                  </div>
                ) : (
                  <Empty className="rounded-md border">
                    <EmptyHeader>
                      <EmptyTitle>No Interpretation Yet</EmptyTitle>
                      <EmptyDescription>
                        The interpretation appears here after deterministic data is loaded.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
    </div>
  )
}
