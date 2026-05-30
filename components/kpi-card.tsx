"use client"

import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import type { LucideIcon } from "lucide-react"
import { fmtN } from "@/lib/fmt"

interface KpiCardProps {
  title: string
  value: number | string
  icon: LucideIcon
  variant?: "primary" | "success" | "warning" | "destructive"
  description?: string
}

export function KpiCard({
  title,
  value,
  icon: Icon,
  variant = "primary",
  description,
}: KpiCardProps) {
  const variantStyles = {
    primary: "from-cyan-50 via-white to-white border-cyan-100",
    success: "from-emerald-50 via-white to-white border-emerald-100",
    warning: "from-amber-50 via-white to-white border-amber-100",
    destructive: "from-rose-50 via-white to-white border-rose-100",
  }

  const iconStyles = {
    primary: "text-cyan-700 bg-cyan-50 ring-cyan-100",
    success: "text-emerald-700 bg-emerald-50 ring-emerald-100",
    warning: "text-amber-700 bg-amber-50 ring-amber-100",
    destructive: "text-rose-700 bg-rose-50 ring-rose-100",
  }

  return (
    <Card className={cn("relative overflow-hidden border bg-gradient-to-br py-0", variantStyles[variant])}>
      <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-cyan-100/70 blur-2xl" />
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
            <p className="font-heading text-4xl font-black tracking-[-0.06em] text-foreground">
              {typeof value === "number" ? fmtN(value) : value}
            </p>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <div className={cn("rounded-2xl p-3 ring-1", iconStyles[variant])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
