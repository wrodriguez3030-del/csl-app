"use client"

import { useEffect, useMemo, useState } from "react"
import { useAppStore } from "@/lib/store"
import { Activity, CheckCircle2, Loader2, LogOut, Menu, RefreshCw, ShieldCheck, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { TabId } from "@/lib/types"
import { logout } from "@/lib/security"
import { useSessionUser } from "@/hooks/use-session-user"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { BusinessLogo } from "@/components/business-logo"
import { cn } from "@/lib/utils"

const pageMeta: Partial<Record<TabId, { title: string; description: string; eyebrow: string }>> = {
  config: { title: "Configuración", description: "Conexión, seguridad y parámetros del sistema", eyebrow: "Sistema" },
  panel: { title: "Dashboard Ejecutivo", description: "Resumen general de mantenimiento, equipos, inventario y reportes", eyebrow: "Mantenimiento" },
  sucursales: { title: "Sucursales", description: "Gestión de sedes, estado operativo y datos base", eyebrow: "Gestión" },
  equipos: { title: "Equipos", description: "Inventario técnico, pulsos, estado e historial", eyebrow: "Mantenimiento" },
  tecnicos: { title: "Técnicos", description: "Personal técnico activo para reportes e intervenciones", eyebrow: "Mantenimiento" },
  credenciales: { title: "Sistema de Credenciales", description: "Usuarios, PIN, correos y contraseñas por sucursal", eyebrow: "Gestión" },
  reporte: { title: "Nuevo Reporte", description: "Registro de intervención, piezas y cierre técnico", eyebrow: "Mantenimiento" },
  reportes: { title: "Lista de Reportes", description: "Historial técnico, búsqueda, edición e impresión", eyebrow: "Mantenimiento" },
  "historial-equipos": { title: "Historial por equipo", description: "Resumen de mantenimientos, piezas y frecuencia por equipo", eyebrow: "Mantenimiento" },
  errores: { title: "Consulta código errores", description: "Consulta rápida de códigos de error y soluciones técnicas", eyebrow: "Mantenimiento" },
  inventario: { title: "Inventario y piezas", description: "Control de inventario, piezas y repuestos", eyebrow: "Mantenimiento" },
  "piezas-poliza": { title: "Lista piezas póliza", description: "Piezas pendientes y recibidas por suplidor", eyebrow: "Mantenimiento" },
  "pulse-dashboard": { title: "PulseControl CSL", description: "Panel integrado de control de pulsos GentleYAG", eyebrow: "Láser" },
  "pulse-equipos": { title: "Equipos GentleYAG", description: "11 equipos controlados por sucursal y cabina", eyebrow: "PulseControl" },
  "pulsos-operadoras": { title: "Operadoras", description: "Operadoras activas vinculadas a sucursal", eyebrow: "PulseControl" },
  "pulsos-lecturas": { title: "Lecturas semanales", description: "Lecturas de pantalla por equipo y semana", eyebrow: "PulseControl" },
  "pulsos-sesiones": { title: "Registro de servicios", description: "Disparos reportados por operadora", eyebrow: "PulseControl" },
  "pulsos-auditoria": { title: "Auditoría / IA", description: "Comparativo Disp. Láser vs Disp. Operador", eyebrow: "PulseControl" },
  "pulsos-cuadre": { title: "Cuadre semanal", description: "Asistente para subir Excel AgendaPro + fotos de pantalla y persistir el snapshot de la semana", eyebrow: "PulseControl" },
  "pulse-mantenimiento": { title: "Mantenimiento Pulse", description: "Resumen de intervenciones relacionadas a equipos láser", eyebrow: "PulseControl" },
  "rrhh-solicitudes": { title: "Solicitudes de empleo", description: "Formulario y seguimiento de candidatos", eyebrow: "Recursos humanos" },
  "rrhh-empleados": { title: "Empleados", description: "Empleados generados desde solicitudes aprobadas", eyebrow: "Recursos humanos" },
  "cosmiatria-clientes": { title: "Clientes Cosmiatría", description: "Base de clientes, teléfonos, sucursales y fichas", eyebrow: "Cosmiatría" },
  "cosmiatria-ficha": { title: "Ficha Dermatología", description: "Ficha dermo-cosmiátrica con firma digital", eyebrow: "Cosmiatría" },
  "consent-masajes": { title: "Consentimiento Masajes", description: "Registro, firmas y PDF para terapias corporales", eyebrow: "Consentimientos" },
  "consent-tatuajes-cejas": { title: "Consentimiento Eliminacion de Tatuajes y Cejas", description: "Autorizacion informada para procedimientos laser", eyebrow: "Consentimientos" },
  "reportes-firmados": { title: "Reportes de Consentimientos y Fichas", description: "Vista centralizada de fichas dermatológicas y consentimientos firmados", eyebrow: "Clientes y Consentimientos" },
  "cliente-certificados": { title: "CF Regalo Digital", description: "Certificados digitales en PDF y registro emitido", eyebrow: "Atención a cliente" },
  "cliente-certificados-depicenter": { title: "Certificado Digital Depicenter", description: "Emisión, validación y PDF con plantilla Depicenter", eyebrow: "Atención a cliente" },
  "cliente-certificados-imprimir": { title: "CF de Regalo para imprimir", description: "Impresión de campos sobre certificado físico", eyebrow: "Atención a cliente" },
  "cliente-certificados-talonario": { title: "CF Talonario Pre-impreso", description: "Impresión calibrada para talonario", eyebrow: "Atención a cliente" },
  "cliente-certificados-validez": { title: "Validar Certificados", description: "Consulta de validez y cambio de estado", eyebrow: "Atención a cliente" },
  "admin-users": { title: "Gestión de Usuarios", description: "Crear, editar y administrar usuarios y permisos (solo superadmin)", eyebrow: "Administración" },
}

interface HeaderProps {
  onRefresh?: () => void
}

export function Header({ onRefresh }: HeaderProps) {
  const { activeTab, setSidebarOpen, isLoading, isConnected, lastSyncAt, isSyncing } = useAppStore()
  const user = useSessionUser()
  // Multi-tenant branding: idéntico fallback que Sidebar.
  const business = useCurrentBusiness()
  const meta = pageMeta[activeTab] || pageMeta.panel!

  const isPulse = useMemo(() => String(activeTab).startsWith("pulsos-") || String(activeTab).startsWith("pulse-"), [activeTab])

  // Re-render cada 30s para mantener fresca la frase "hace X" sin cambiar el reloj.
  const [, tick] = useState(0)
  useEffect(() => {
    const interval = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  const syncLabel = useMemo(() => {
    if (isSyncing) return "Actualizando…"
    if (!lastSyncAt) return ""
    const diffSec = Math.max(0, Math.floor((Date.now() - lastSyncAt) / 1000))
    if (diffSec < 30) return "Actualizado ahora"
    if (diffSec < 60) return `Hace ${diffSec}s`
    if (diffSec < 3600) return `Hace ${Math.floor(diffSec / 60)} min`
    const date = new Date(lastSyncAt)
    return `Actualizado a las ${date.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}`
  }, [lastSyncAt, isSyncing])

  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--brand-border)] bg-white/85 backdrop-blur-xl">
      <div className="flex min-h-[78px] items-center gap-4 px-4 py-3 lg:px-7">
        <Button data-csl-sidebar-toggle variant="ghost" size="icon" className="h-11 w-11" onClick={() => setSidebarOpen(true)}>
          <Menu className="h-5 w-5" />
          <span className="sr-only">Abrir menú</span>
        </Button>

        <div className="hidden h-11 w-20 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 ring-1 ring-[color:var(--brand-border)] sm:flex">
          <BusinessLogo business={business} className="h-full w-full object-contain" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-2">
            <span className="csl-kicker">{meta.eyebrow}</span>
            {isPulse ? <span className="csl-new-badge">NEW</span> : null}
          </div>
          <h1 className="font-heading text-xl font-black tracking-tight text-[color:var(--brand-primary-dark)] sm:text-2xl">{meta.title}</h1>
          <p className="mt-0.5 hidden max-w-2xl text-[13px] text-slate-500 sm:block">{meta.description}</p>
        </div>

        <div className="hidden items-center gap-2 xl:flex">
          <div className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1",
            isConnected
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : "bg-amber-50 text-amber-700 ring-amber-200"
          )}>
            {isConnected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {isConnected ? "Conectado" : "Sin verificar"}
          </div>
          {syncLabel ? (
            <div className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1",
              isSyncing
                ? "bg-cyan-50 text-cyan-700 ring-cyan-200"
                : "bg-slate-50 text-slate-600 ring-slate-200"
            )}>
              {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {syncLabel}
            </div>
          ) : null}
          {user ? (
            <div className="rounded-full bg-[color:var(--brand-bg-subtle)] px-3 py-1.5 ring-1 ring-[color:var(--brand-border)]">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[color:var(--brand-primary-dark)]">
                <ShieldCheck className="h-3.5 w-3.5 text-[color:var(--brand-primary)]" />
                {user.nombre}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {onRefresh && !isPulse && (
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading} className="gap-2 rounded-full">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Actualizar</span>
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={logout} className="gap-2 rounded-full">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Salir</span>
          </Button>
        </div>
      </div>
      {isPulse ? <div className="h-px bg-gradient-to-r from-transparent via-[color:var(--brand-primary)]/50 to-transparent" /> : null}
    </header>
  )
}
