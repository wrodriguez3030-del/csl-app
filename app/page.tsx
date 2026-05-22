"use client"

import { useCallback, useEffect, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { LoadingOverlay } from "@/components/loading-overlay"
import { ToastNotification } from "@/components/toast-notification"
import { ConfigPage } from "@/components/config-page"
import { DashboardPage } from "@/components/dashboard-page"
import { SucursalesPage } from "@/components/sucursales-page"
import { EquiposPage } from "@/components/equipos-page"
import { TecnicosPage } from "@/components/tecnicos-page"
import { NuevoReportePage } from "@/components/nuevo-reporte-page"
import { ReportesPage } from "@/components/reportes-page"
import { HistorialEquiposPage } from "@/components/historial-equipos-page"
import { CatalogoPage } from "@/components/catalogo-page"
import { InventarioPage } from "@/components/inventario-page"
import { PiezasPolizaPage } from "@/components/piezas-poliza-page"
import { CredencialesPage } from "@/components/credenciales-page"
import { RecursosHumanosPage } from "@/components/recursos-humanos-page"
import { EmpleadosPage } from "@/components/empleados-page"
import { PulsosOperadorasPage } from "@/components/pulsos-operadoras-page"
import { PulsosLecturasPage } from "@/components/pulsos-lecturas-page"
import { PulsosSesionesPage } from "@/components/pulsos-sesiones-page"
import { PulsosAuditoriaPage } from "@/components/pulsos-auditoria-page"
import { PulseControlDashboardPage } from "@/components/pulse-control-dashboard-page"
import { PulsosEquiposPage } from "@/components/pulsos-equipos-page"
import { PulsosMantenimientoPage } from "@/components/pulsos-mantenimiento-page"
import { CosmiatriaClientesPage } from "@/components/cosmiatria-clientes-page"
import { CosmiatriaFichaPage } from "@/components/cosmiatria-ficha-page"
import { ConsentimientosPage } from "@/components/consentimientos-page"
import { ReportesFirmadosPage } from "@/components/reportes-firmados-page"
import { CertificadosRegaloPage } from "@/components/certificados-regalo-page"
import { CertificadosDepicenterPage } from "@/components/certificados-depicenter-page"
import { CertificadosRegaloImpresionPage } from "@/components/certificados-regalo-impresion-page"
import { CertificadosRegaloTalonarioPage } from "@/components/certificados-regalo-talonario-page"
import { CertificadosRegaloValidezPage } from "@/components/certificados-regalo-validez-page"
import { LoginPage } from "@/components/login-page"
import { AdminUsersPage } from "@/components/admin-users-page"
import { canAccessMenu, clearLocalSession, getSessionUser, type SystemUser } from "@/lib/security"
import { supabaseBrowser } from "@/lib/supabase-client"
import { useAutoRefresh } from "@/hooks/use-auto-refresh"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import type { Database, DatabasePulsos } from "@/lib/types"

export default function HomePage() {
  const {
    activeTab,
    apiUrl,
    setDb,
    setDbPulsos,
    setIsLoading,
    setLoadingMessage,
    showToast,
    setIsConnected,
    setActiveTab,
    setLastSyncAt,
    setIsSyncing,
    formOpenCount,
  } = useAppStore()

  const [user, setUser] = useState<SystemUser | null>(null)
  const [isReady, setIsReady] = useState(false)
  // Branding dinámico del tab del navegador: cuando el user está logueado,
  // el title del browser refleja su business (CSL o Depicenter).
  const business = useCurrentBusiness()
  useEffect(() => {
    if (typeof document === "undefined") return
    document.title = user
      ? `${business.name} · Sistema de Mantenimientos`
      : "Sistema Integral de Mantenimientos"
  }, [user, business.name])

  useEffect(() => {
    const sync = async () => {
      const {
        data: { session },
      } = await supabaseBrowser.auth.getSession()
      const localUser = getSessionUser()

      if (!session?.access_token) {
        if (localUser) clearLocalSession()
        setUser(null)
        setIsReady(true)
        return
      }

      if (!localUser) {
        setUser(null)
        setIsReady(true)
        return
      }

      setUser(localUser)
      setIsReady(true)
    }
    void sync()
    const authListener = supabaseBrowser.auth.onAuthStateChange(() => {
      void sync()
    })
    window.addEventListener("storage", sync as EventListener)
    window.addEventListener("csl-auth-changed", sync as EventListener)
    return () => {
      authListener.data.subscription.unsubscribe()
      window.removeEventListener("storage", sync as EventListener)
      window.removeEventListener("csl-auth-changed", sync as EventListener)
    }
  }, [])

  /**
   * Refresca el snapshot global del sistema.
   *
   * @param options.silent  Si es true, no muestra spinner global ni toast (modo
   *                        auto-refresh). Si es false, lo muestra (modo manual
   *                        cuando el usuario presiona el botón Actualizar).
   */
  const handleRefresh = useCallback(async (options: { silent?: boolean } = {}) => {
    const { silent = false } = options
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) {
      if (!silent) showToast("Configura la URL de la API primero", "error")
      return
    }

    setIsSyncing(true)
    if (!silent) {
      setIsLoading(true)
      setLoadingMessage("Actualizando datos...")
    }

    try {
      const result = await apiJsonp(normalized, { action: "getAllData" })
      if (result && result.ok && result.data) {
        setDb(result.data as Database)
        setIsConnected(true)
      } else {
        throw new Error((result as { error?: string })?.error || "Error del servidor")
      }

      const pulsos = await apiJsonp(normalized, { action: "getAllPulsosData" })
      if (pulsos && pulsos.ok) {
        setDbPulsos({
          operadoras: (pulsos.operadoras as DatabasePulsos["operadoras"]) || [],
          lecturasSemanales: (pulsos.lecturasSemanales as DatabasePulsos["lecturasSemanales"]) || [],
          sesionesCliente: (pulsos.sesionesCliente as DatabasePulsos["sesionesCliente"]) || [],
          auditoriasSemanales: (pulsos.auditoriasSemanales as DatabasePulsos["auditoriasSemanales"]) || [],
        })
      }
      setLastSyncAt(Date.now())
      if (!silent) showToast("Datos actualizados", "success")
    } catch (error) {
      // En modo silencioso no molestamos al usuario con toasts: la próxima
      // ronda volverá a intentar.
      if (!silent) showToast(error instanceof Error ? error.message : "Error al actualizar", "error")
    } finally {
      setIsSyncing(false)
      if (!silent) setIsLoading(false)
    }
  }, [apiUrl, setDb, setDbPulsos, setIsLoading, setLoadingMessage, showToast, setIsConnected, setLastSyncAt, setIsSyncing])

  // ---- Auto-refresh global del sistema ----
  // - cada 60s mientras el usuario tenga la pestaña activa
  // - al volver a la pestaña (visibilitychange / focus)
  // - se SALTA si hay un formulario abierto (formOpenCount > 0) para no
  //   interrumpir la captura del usuario.
  useAutoRefresh(
    () => handleRefresh({ silent: true }),
    {
      intervalMs: 60_000,
      enabled: Boolean(user) && activeTab !== "config",
      skipWhen: () => formOpenCount > 0,
    },
  )

  const renderPage = () => {
    if (!user) return null

    if (!canAccessMenu(user, activeTab)) {
      return (
        <div className="rounded-xl border p-6">
          <div className="text-lg font-semibold">Acceso denegado</div>
          <div className="text-sm text-muted-foreground mt-2">
            Tu usuario no tiene permiso para entrar a este menú.
          </div>
        </div>
      )
    }

    switch (activeTab) {
      case "config":
        return <ConfigPage />
      case "panel":
        return <DashboardPage />
      case "sucursales":
        return <SucursalesPage />
      case "equipos":
        return <EquiposPage />
      case "tecnicos":
        return <TecnicosPage />
      case "reporte":
        return <NuevoReportePage />
      case "reportes":
        return <ReportesPage />
      case "historial-equipos":
        return <HistorialEquiposPage />
      case "errores":
        return <CatalogoPage />
      case "inventario":
        return <InventarioPage />
      case "piezas-poliza":
        return <PiezasPolizaPage />
      case "credenciales":
        return <CredencialesPage />
      case "pulse-dashboard":
        return <PulseControlDashboardPage />
      case "pulse-equipos":
        return <PulsosEquiposPage />
      case "pulse-mantenimiento":
        return <PulsosMantenimientoPage />
      case "rrhh-solicitudes":
        return <RecursosHumanosPage />
      case "rrhh-empleados":
        return <EmpleadosPage />
      case "pulsos-operadoras":
        return <PulsosOperadorasPage />
      case "pulsos-lecturas":
        return <PulsosLecturasPage />
      case "pulsos-sesiones":
        return <PulsosSesionesPage />
      case "pulsos-auditoria":
        return <PulsosAuditoriaPage />
      case "cosmiatria-clientes":
        return <CosmiatriaClientesPage />
      case "cosmiatria-ficha":
        return <CosmiatriaFichaPage />
      case "consent-masajes":
        return <ConsentimientosPage kind="masajes" />
      case "consent-tatuajes-cejas":
        return <ConsentimientosPage kind="tatuajes" />
      case "reportes-firmados":
        return <ReportesFirmadosPage />
      case "cliente-certificados":
        return <CertificadosRegaloPage />
      case "cliente-certificados-depicenter":
        return <CertificadosDepicenterPage />
      case "cliente-certificados-imprimir":
        return <CertificadosRegaloImpresionPage />
      case "cliente-certificados-talonario":
        return <CertificadosRegaloTalonarioPage />
      case "cliente-certificados-validez":
        return <CertificadosRegaloValidezPage />
      case "admin-users":
        return <AdminUsersPage />
      default:
        return <ConfigPage />
    }
  }

  if (!isReady) return null

  if (!user) {
    return <LoginPage onLogin={(logged) => { setUser(logged); setActiveTab("panel") }} />
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <Sidebar />
      <LoadingOverlay />
      <ToastNotification />
      <div className="lg:pl-72">
        <Header onRefresh={activeTab !== "config" && !String(activeTab).startsWith("pulsos-") && !String(activeTab).startsWith("pulse-") ? handleRefresh : undefined} />
        {/* Layout centrado:
              - max-w-[1480px] como cap general para que en pantallas muy anchas el contenido no quede infinito
              - min-w-0 para que las tablas hijas no fuercen overflow horizontal del shell */}
        <main className="mx-auto min-w-0 max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 xl:px-10">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}
