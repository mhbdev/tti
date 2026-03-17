"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

type MarkdownViewProps = {
  content: string
  className?: string
}

export function MarkdownView({ content, className }: MarkdownViewProps) {
  return (
    <div
      className={cn(
        "prose prose-neutral max-w-none text-sm dark:prose-invert",
        "prose-headings:font-semibold prose-h2:mt-6 prose-h2:border-b prose-h2:pb-1",
        "prose-p:leading-6 prose-li:leading-6 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-xs",
        "prose-pre:overflow-x-auto prose-pre:rounded-md prose-pre:border prose-pre:bg-muted/40",
        "prose-table:block prose-table:w-full prose-table:overflow-x-auto prose-th:bg-muted/60",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
