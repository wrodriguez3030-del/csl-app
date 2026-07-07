"use client"

import { useAppStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { CheckCircle2, XCircle, Info } from "lucide-react"

export function ToastNotification() {
  const { toast, hideToast } = useAppStore()

  if (!toast) return null

  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-success" />,
    error: <XCircle className="h-5 w-5 text-destructive" />,
    info: <Info className="h-5 w-5 text-primary" />,
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        // z-[200]: por encima de los Dialog/Sheet/overlay (z-50) y del toast
        // primitivo de shadcn (z-[100]). Antes quedaba en z-50 y el overlay del
        // modal (portaleado al final del <body>) lo tapaba: los mensajes de
        // error/éxito eran invisibles con un modal abierto → parecía que "no
        // pasaba nada". role=alert para que lectores de pantalla lo anuncien.
        "fixed bottom-6 right-6 z-[200] flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border transition-all duration-300",
        "bg-card text-card-foreground border-border",
        toast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      )}
      onClick={hideToast}
    >
      {icons[toast.type]}
      <span className="text-sm font-medium">{toast.message}</span>
    </div>
  )
}
