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
        "prose prose-sm prose-neutral max-w-none dark:prose-invert",
        "prose-headings:tracking-normal prose-headings:text-foreground",
        "prose-h2:mb-2 prose-h2:mt-6 prose-h2:border-b prose-h2:border-border prose-h2:pb-1 prose-h2:text-[0.95rem] prose-h2:font-semibold",
        "prose-h3:mb-1 prose-h3:mt-4 prose-h3:text-sm prose-h3:font-medium",
        "prose-p:my-2 prose-p:leading-6 prose-p:text-foreground",
        "prose-ul:my-2 prose-ul:pl-5 prose-li:my-1 prose-li:text-foreground/90",
        "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.75rem]",
        "prose-pre:overflow-x-auto prose-pre:rounded-md prose-pre:border prose-pre:border-border prose-pre:bg-muted/40 prose-pre:p-3",
        "prose-table:my-3 prose-table:w-full prose-table:text-xs",
        "prose-th:border-b prose-th:border-border prose-th:px-2 prose-th:py-1.5 prose-th:text-left prose-th:font-medium",
        "prose-td:border-b prose-td:border-border/60 prose-td:px-2 prose-td:py-1.5 prose-td:align-top",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
