"use client"

import { useAppStore } from "@/lib/store"
import { Loader2 } from "lucide-react"

export function LoadingOverlay() {
  const { isLoading, loadingMessage } = useAppStore()

  if (!isLoading) return null

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">{loadingMessage}</p>
      </div>
    </div>
  )
}
