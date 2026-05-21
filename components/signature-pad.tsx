"use client"

import { useRef, useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Eraser } from "lucide-react"

interface SignaturePadProps {
  label: string
  value?: string
  onChange: (dataUrl: string) => void
}

export function SignaturePad({ label, value, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [isEmpty, setIsEmpty] = useState(!value)

  const initCanvas = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    // Fondo blanco para que la firma se vea bien en PDF
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "#000000"
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    initCanvas(canvas)
    if (value) {
      const img = new Image()
      img.onload = () => {
        const ctx = canvas.getContext("2d")
        if (ctx) ctx.drawImage(img, 0, 0)
      }
      img.src = value
    }
  }, [])

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      }
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const pos = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    setDrawing(true)
    setIsEmpty(false)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!drawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const pos = getPos(e, canvas)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
  }

  const endDraw = () => {
    if (!drawing) return
    setDrawing(false)
    const canvas = canvasRef.current
    if (!canvas) return
    onChange(canvas.toDataURL("image/png"))
  }

  const clear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    initCanvas(canvas)
    setIsEmpty(true)
    onChange("")
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        {!isEmpty && (
          <Button variant="ghost" size="sm" onClick={clear} className="h-6 px-2 text-xs gap-1 text-muted-foreground">
            <Eraser className="h-3 w-3" /> Borrar
          </Button>
        )}
      </div>
      <div className="relative rounded-lg border border-border overflow-hidden">
        <canvas
          ref={canvasRef}
          width={400}
          height={120}
          className="w-full touch-none cursor-crosshair"
          style={{ background: "#ffffff" }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-xs text-muted-foreground/40">Firma aquí</p>
          </div>
        )}
      </div>
    </div>
  )
}
