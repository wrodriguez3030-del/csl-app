"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { LoadingOverlay } from "@/components/loading-overlay"
import { ToastNotification } from "@/components/toast-notification"
import {
  ComisionDashboardPage, ComisionHistorialPage, ComisionSucursalesPage,
  ComisionProductosPage, ComisionLaserPage, ComisionClientesPage,
} from "@/components/comision/comision-pages"
import {
  RrhhReclutamientoPage, RrhhOnboardingPage, RrhhEvaluacionPage,
  RrhhDisciplinaPage, RrhhCapacitacionPage, RrhhComunicacionPage,
} from "@/components/hr/rrhh-desarrollo-pages"
import {
  BiDashboardPage, BiVentasPage, BiGastosPage, BiRentabilidadPage,
  BiProyeccionesPage, BiInversionesPage, BiAlertasPage, BiReportesPage,
} from "@/components/bi-finance/bi-finance-pages"
import { canAccessMenu, clearLocalSession, getFirstAllowedMenu, getSessionUser, refreshSessionUser, type SystemUser } from "@/lib/security"
import { supabaseBrowser } from "@/lib/supabase-client"
import { useAutoRefresh } from "@/hooks/use-auto-refresh"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import type { Database, DatabasePulsos } from "@/lib/types"

/**
 * Las 90 pantallas se cargan CUANDO SE ABREN, no al entrar.
 *
 * Antes se importaban todas de golpe y el navegador se bajaba 6,4 MB —un solo
 * trozo de 2,4 MB— aunque la persona tuviera un único menú: los tres kioskos de
 * ponche descargaban nómina, BI, compras y comisiones para no usarlas nunca.
 *
 * `ssr: false` porque todas son de cliente y viven dentro del `switch` de abajo.
 */
const carga = () => <div className="p-8 text-sm text-muted-foreground">Cargando…</div>

const AdminPermisosPage = dynamic(() => import("@/components/admin-permisos-page").then((m) => m.AdminPermisosPage), { ssr: false, loading: carga })
const AdminUsersPage = dynamic(() => import("@/components/admin-users-page").then((m) => m.AdminUsersPage), { ssr: false, loading: carga })
const AgendaProIntegracionPage = dynamic(() => import("@/components/agendapro-integracion-page").then((m) => m.AgendaProIntegracionPage), { ssr: false, loading: carga })
const BiAsistentePage = dynamic(() => import("@/components/bi-finance/bi-asistente-page").then((m) => m.BiAsistentePage), { ssr: false, loading: carga })
const BiConfigPage = dynamic(() => import("@/components/bi-finance/bi-config-page").then((m) => m.BiConfigPage), { ssr: false, loading: carga })
const CatalogoPage = dynamic(() => import("@/components/catalogo-page").then((m) => m.CatalogoPage), { ssr: false, loading: carga })
const CertificadosDepicenterPage = dynamic(() => import("@/components/certificados-depicenter-page").then((m) => m.CertificadosDepicenterPage), { ssr: false, loading: carga })
const CertificadosRegaloImpresionPage = dynamic(() => import("@/components/certificados-regalo-impresion-page").then((m) => m.CertificadosRegaloImpresionPage), { ssr: false, loading: carga })
const CertificadosRegaloPage = dynamic(() => import("@/components/certificados-regalo-page").then((m) => m.CertificadosRegaloPage), { ssr: false, loading: carga })
const CertificadosRegaloTalonarioPage = dynamic(() => import("@/components/certificados-regalo-talonario-page").then((m) => m.CertificadosRegaloTalonarioPage), { ssr: false, loading: carga })
const CertificadosRegaloValidezPage = dynamic(() => import("@/components/certificados-regalo-validez-page").then((m) => m.CertificadosRegaloValidezPage), { ssr: false, loading: carga })
const ComisionAnalisisPage = dynamic(() => import("@/components/comision/finanzas/comision-analisis-page").then((m) => m.ComisionAnalisisPage), { ssr: false, loading: carga })
const ComisionCalculoPage = dynamic(() => import("@/components/comision/comision-calculo-page").then((m) => m.ComisionCalculoPage), { ssr: false, loading: carga })
const ComisionFinanzasPage = dynamic(() => import("@/components/comision/finanzas/comision-finanzas-page").then((m) => m.ComisionFinanzasPage), { ssr: false, loading: carga })
const ComisionImportarPage = dynamic(() => import("@/components/comision/comision-importar-page").then((m) => m.ComisionImportarPage), { ssr: false, loading: carga })
const ComisionLiquidacionPage = dynamic(() => import("@/components/comision/comision-liquidacion-page").then((m) => m.ComisionLiquidacionPage), { ssr: false, loading: carga })
const ComisionPrestadoresPage = dynamic(() => import("@/components/comision/comision-prestadores-page").then((m) => m.ComisionPrestadoresPage), { ssr: false, loading: carga })
const ComisionReglasPage = dynamic(() => import("@/components/comision/comision-reglas-page").then((m) => m.ComisionReglasPage), { ssr: false, loading: carga })
const ComisionRentabilidadPage = dynamic(() => import("@/components/comision/finanzas/comision-rentabilidad-page").then((m) => m.ComisionRentabilidadPage), { ssr: false, loading: carga })
const ComisionReportesPage = dynamic(() => import("@/components/comision/comision-reportes-page").then((m) => m.ComisionReportesPage), { ssr: false, loading: carga })
const ComisionSinPrestadorPage = dynamic(() => import("@/components/comision/comision-sin-prestador-page").then((m) => m.ComisionSinPrestadorPage), { ssr: false, loading: carga })
const ComprasDashboardPage = dynamic(() => import("@/components/compras-dashboard-page").then((m) => m.ComprasDashboardPage), { ssr: false, loading: carga })
const ComprasFacturasPage = dynamic(() => import("@/components/compras-facturas-page").then((m) => m.ComprasFacturasPage), { ssr: false, loading: carga })
const ComprasGastosMenoresPage = dynamic(() => import("@/components/compras-gastos-menores-page").then((m) => m.ComprasGastosMenoresPage), { ssr: false, loading: carga })
const ComprasPagosPage = dynamic(() => import("@/components/compras-pagos-page").then((m) => m.ComprasPagosPage), { ssr: false, loading: carga })
const ComprasRecurrentesPage = dynamic(() => import("@/components/compras-recurrentes-page").then((m) => m.ComprasRecurrentesPage), { ssr: false, loading: carga })
const ConfigPage = dynamic(() => import("@/components/config-page").then((m) => m.ConfigPage), { ssr: false, loading: carga })
const ConsentimientosPage = dynamic(() => import("@/components/consentimientos-page").then((m) => m.ConsentimientosPage), { ssr: false, loading: carga })
const ControlTratamientosPage = dynamic(() => import("@/components/control-tratamientos-page").then((m) => m.ControlTratamientosPage), { ssr: false, loading: carga })
const CosmiatriaClientesPage = dynamic(() => import("@/components/cosmiatria-clientes-page").then((m) => m.CosmiatriaClientesPage), { ssr: false, loading: carga })
const CosmiatriaFichaPage = dynamic(() => import("@/components/cosmiatria-ficha-page").then((m) => m.CosmiatriaFichaPage), { ssr: false, loading: carga })
const CredencialesPage = dynamic(() => import("@/components/credenciales-page").then((m) => m.CredencialesPage), { ssr: false, loading: carga })
const DashboardPage = dynamic(() => import("@/components/dashboard-page").then((m) => m.DashboardPage), { ssr: false, loading: carga })
const EmpleadosPage = dynamic(() => import("@/components/empleados-page").then((m) => m.EmpleadosPage), { ssr: false, loading: carga })
const EquiposPage = dynamic(() => import("@/components/equipos-page").then((m) => m.EquiposPage), { ssr: false, loading: carga })
const HistorialEquiposPage = dynamic(() => import("@/components/historial-equipos-page").then((m) => m.HistorialEquiposPage), { ssr: false, loading: carga })
const InventarioPage = dynamic(() => import("@/components/inventario-page").then((m) => m.InventarioPage), { ssr: false, loading: carga })
const KioskPonchePage = dynamic(() => import("@/components/hr/rrhh-ponche-page").then((m) => m.KioskPonchePage), { ssr: false, loading: carga })
const LoginPage = dynamic(() => import("@/components/login-page").then((m) => m.LoginPage), { ssr: false, loading: carga })
const NuevoReportePage = dynamic(() => import("@/components/nuevo-reporte-page").then((m) => m.NuevoReportePage), { ssr: false, loading: carga })
const PiezasPolizaPage = dynamic(() => import("@/components/piezas-poliza-page").then((m) => m.PiezasPolizaPage), { ssr: false, loading: carga })
const ProdCatalogoPage = dynamic(() => import("@/components/productos/prod-catalogo-page").then((m) => m.ProdCatalogoPage), { ssr: false, loading: carga })
const ProdConteoHistoricoPage = dynamic(() => import("@/components/productos/prod-conteo-historico-page").then((m) => m.ProdConteoHistoricoPage), { ssr: false, loading: carga })
const ProdConteoPage = dynamic(() => import("@/components/productos/prod-conteo-page").then((m) => m.ProdConteoPage), { ssr: false, loading: carga })
const ProdImportarPage = dynamic(() => import("@/components/productos/prod-importar-page").then((m) => m.ProdImportarPage), { ssr: false, loading: carga })
const ProdReportePage = dynamic(() => import("@/components/productos/prod-reporte-page").then((m) => m.ProdReportePage), { ssr: false, loading: carga })
const PulseControlDashboardPage = dynamic(() => import("@/components/pulse-control-dashboard-page").then((m) => m.PulseControlDashboardPage), { ssr: false, loading: carga })
const PulsosAuditoriaPage = dynamic(() => import("@/components/pulsos-auditoria-page").then((m) => m.PulsosAuditoriaPage), { ssr: false, loading: carga })
const PulsosCuadreSemanalPage = dynamic(() => import("@/components/pulsos-cuadre-semanal-page").then((m) => m.PulsosCuadreSemanalPage), { ssr: false, loading: carga })
const PulsosEquiposPage = dynamic(() => import("@/components/pulsos-equipos-page").then((m) => m.PulsosEquiposPage), { ssr: false, loading: carga })
const PulsosLecturasPage = dynamic(() => import("@/components/pulsos-lecturas-page").then((m) => m.PulsosLecturasPage), { ssr: false, loading: carga })
const PulsosMantenimientoPage = dynamic(() => import("@/components/pulsos-mantenimiento-page").then((m) => m.PulsosMantenimientoPage), { ssr: false, loading: carga })
const PulsosOperadorasPage = dynamic(() => import("@/components/pulsos-operadoras-page").then((m) => m.PulsosOperadorasPage), { ssr: false, loading: carga })
const PulsosSesionesPage = dynamic(() => import("@/components/pulsos-sesiones-page").then((m) => m.PulsosSesionesPage), { ssr: false, loading: carga })
const RecursosHumanosPage = dynamic(() => import("@/components/recursos-humanos-page").then((m) => m.RecursosHumanosPage), { ssr: false, loading: carga })
const ReportesFirmadosPage = dynamic(() => import("@/components/reportes-firmados-page").then((m) => m.ReportesFirmadosPage), { ssr: false, loading: carga })
const ReportesPage = dynamic(() => import("@/components/reportes-page").then((m) => m.ReportesPage), { ssr: false, loading: carga })
const ReqMatAprobacionesPage = dynamic(() => import("@/components/req-mat-aprobaciones-page").then((m) => m.ReqMatAprobacionesPage), { ssr: false, loading: carga })
const ReqMatConsolidadoPage = dynamic(() => import("@/components/req-mat-consolidado-page").then((m) => m.ReqMatConsolidadoPage), { ssr: false, loading: carga })
const ReqMatDashboardPage = dynamic(() => import("@/components/req-mat-dashboard-page").then((m) => m.ReqMatDashboardPage), { ssr: false, loading: carga })
const ReqMatInventarioHistoricoPage = dynamic(() => import("@/components/req-mat-inventario-historico-page").then((m) => m.ReqMatInventarioHistoricoPage), { ssr: false, loading: carga })
const ReqMatInventarioPage = dynamic(() => import("@/components/req-mat-inventario-page").then((m) => m.ReqMatInventarioPage), { ssr: false, loading: carga })
const ReqMatMaterialesPage = dynamic(() => import("@/components/req-mat-materiales-page").then((m) => m.ReqMatMaterialesPage), { ssr: false, loading: carga })
const ReqMatMisPage = dynamic(() => import("@/components/req-mat-mis-page").then((m) => m.ReqMatMisPage), { ssr: false, loading: carga })
const ReqMatNuevaPage = dynamic(() => import("@/components/req-mat-nueva-page").then((m) => m.ReqMatNuevaPage), { ssr: false, loading: carga })
const RrhhAsistenciaPage = dynamic(() => import("@/components/hr/rrhh-asistencia-page").then((m) => m.RrhhAsistenciaPage), { ssr: false, loading: carga })
const RrhhAuditoriaPage = dynamic(() => import("@/components/hr/rrhh-auditoria-page").then((m) => m.RrhhAuditoriaPage), { ssr: false, loading: carga })
const RrhhConfigModalidadesPage = dynamic(() => import("@/components/hr/rrhh-config-modalidades-page").then((m) => m.RrhhConfigModalidadesPage), { ssr: false, loading: carga })
const RrhhContratosPage = dynamic(() => import("@/components/hr/rrhh-contratos-page").then((m) => m.RrhhContratosPage), { ssr: false, loading: carga })
const RrhhDashboardPage = dynamic(() => import("@/components/hr/rrhh-dashboard-page").then((m) => m.RrhhDashboardPage), { ssr: false, loading: carga })
const RrhhDashboardPonchePage = dynamic(() => import("@/components/hr/rrhh-dashboard-ponche-page").then((m) => m.RrhhDashboardPonchePage), { ssr: false, loading: carga })
const RrhhDiasLaboradosPage = dynamic(() => import("@/components/hr/rrhh-dias-laborados-page").then((m) => m.RrhhDiasLaboradosPage), { ssr: false, loading: carga })
const RrhhDobleSueldoPage = dynamic(() => import("@/components/hr/rrhh-doble-sueldo-page").then((m) => m.RrhhDobleSueldoPage), { ssr: false, loading: carga })
const RrhhDocumentosPage = dynamic(() => import("@/components/hr/rrhh-documentos-page").then((m) => m.RrhhDocumentosPage), { ssr: false, loading: carga })
const RrhhHorariosPage = dynamic(() => import("@/components/hr/rrhh-horarios-page").then((m) => m.RrhhHorariosPage), { ssr: false, loading: carga })
const RrhhIncentivosPage = dynamic(() => import("@/components/hr/rrhh-incentivos-page").then((m) => m.RrhhIncentivosPage), { ssr: false, loading: carga })
const RrhhLiquidacionesPage = dynamic(() => import("@/components/hr/rrhh-liquidaciones-page").then((m) => m.RrhhLiquidacionesPage), { ssr: false, loading: carga })
const RrhhNominaPage = dynamic(() => import("@/components/hr/rrhh-nomina-page").then((m) => m.RrhhNominaPage), { ssr: false, loading: carga })
const RrhhPdfPrestacionesPage = dynamic(() => import("@/components/hr/rrhh-pdf-prestaciones-page").then((m) => m.RrhhPdfPrestacionesPage), { ssr: false, loading: carga })
const RrhhPermisosPage = dynamic(() => import("@/components/hr/rrhh-permisos-page").then((m) => m.RrhhPermisosPage), { ssr: false, loading: carga })
const RrhhPonchePage = dynamic(() => import("@/components/hr/rrhh-ponche-page").then((m) => m.RrhhPonchePage), { ssr: false, loading: carga })
const RrhhPrestamosPage = dynamic(() => import("@/components/hr/rrhh-prestamos-page").then((m) => m.RrhhPrestamosPage), { ssr: false, loading: carga })
const RrhhReportesPage = dynamic(() => import("@/components/hr/rrhh-reportes-page").then((m) => m.RrhhReportesPage), { ssr: false, loading: carga })
const RrhhTxtBancariosPage = dynamic(() => import("@/components/hr/rrhh-txt-bancarios-page").then((m) => m.RrhhTxtBancariosPage), { ssr: false, loading: carga })
const RrhhVacacionesPage = dynamic(() => import("@/components/hr/rrhh-vacaciones-page").then((m) => m.RrhhVacacionesPage), { ssr: false, loading: carga })
const SucursalesPage = dynamic(() => import("@/components/sucursales-page").then((m) => m.SucursalesPage), { ssr: false, loading: carga })
const TecnicosPage = dynamic(() => import("@/components/tecnicos-page").then((m) => m.TecnicosPage), { ssr: false, loading: carga })

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
    setActiveBusinessSlug,
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

      // Re-sincroniza menús/permisos desde csl_user_profiles (fuente de verdad)
      // en cada carga. Sin esto, el sidebar usaba el snapshot de localStorage
      // congelado al login y los cambios de permisos no se reflejaban hasta un
      // logout+login manual. Si el refresco falla (red), se usa el snapshot
      // local; si el usuario quedó inactivo, refreshSessionUser cierra sesión y
      // onAuthStateChange vuelve a disparar este sync.
      const refreshed = await refreshSessionUser()
      const effectiveUser = refreshed ?? getSessionUser()
      if (!effectiveUser) {
        setUser(null)
        setIsReady(true)
        return
      }

      setUser(effectiveUser)
      setIsReady(true)
      // Inicializa el business activo al del usuario logueado SOLO si aún no
      // hay uno fijado (primer load). Nunca arranca en "Todos". No pisa una
      // selección hecha por el superadmin durante la sesión.
      if (!useAppStore.getState().activeBusinessSlug && effectiveUser.businessSlug) {
        setActiveBusinessSlug(effectiveUser.businessSlug)
      }
    }
    void sync()
    const authListener = supabaseBrowser.auth.onAuthStateChange((event) => {
      // TOKEN_REFRESHED (refresco periódico del token cada ~hora) no cambia la
      // identidad → NO re-sincronizar: evita el parpadeo "actualizando" y el
      // churn de consultas que amplificaba los falsos "sesión inválida".
      if (event === "TOKEN_REFRESHED") return
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

  // Si el usuario está logueado pero el activeTab actual no es accesible
  // (caso típico: el store default es "panel" pero este usuario no tiene
  // Dashboard), redirige al primer menú permitido. Evita mostrar la
  // pantalla de "Acceso denegado" cuando hay otras opciones disponibles.
  useEffect(() => {
    if (!user) return
    if (!canAccessMenu(user, activeTab)) {
      const first = getFirstAllowedMenu(user)
      if (first && first !== activeTab) setActiveTab(first)
    }
  }, [user, activeTab, setActiveTab])

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

    // El botón "Actualizar" también re-sincroniza menús/permisos desde la DB,
    // no solo los datos de pantalla. Así un cambio de permisos se refleja sin
    // requerir logout. refreshSessionUser actualiza localStorage + emite el
    // evento que reconstruye el sidebar (vía useSessionUser). No bloqueante.
    try {
      const refreshed = await refreshSessionUser()
      if (refreshed) setUser(refreshed)
    } catch {
      /* error transitorio: se mantiene la sesión actual */
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
          pulseReadings: (pulsos.pulseReadings as DatabasePulsos["pulseReadings"]) || [],
          operatorShots: (pulsos.operatorShots as DatabasePulsos["operatorShots"]) || [],
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
  }, [apiUrl, setDb, setDbPulsos, setIsLoading, setLoadingMessage, showToast, setIsConnected, setLastSyncAt, setIsSyncing, setUser])

  // ---- Cambio de business activo (switcher superadmin) ----
  // Limpia cache + store en memoria y recarga, para que NUNCA queden datos
  // del tenant anterior visibles ni cacheados.
  useEffect(() => {
    const onBusinessChange = () => {
      invalidateReadCache()
      setDb({ sucursales: [], equipos: [], reportes: [], piezas: [], tecnicos: [] })
      setDbPulsos({ operadoras: [], lecturasSemanales: [], sesionesCliente: [], auditoriasSemanales: [], pulseReadings: [], operatorShots: [] })
      // Los filtros de incentivos se PERSISTEN, y la sucursal y el prestador son
      // de un negocio concreto: al cambiar de tenant quedaban apuntando a una
      // sucursal que allí no existe y todo salía en cero, con el desplegable en
      // blanco y sin ningún aviso. El período sí se conserva: no depende del negocio.
      const f = useAppStore.getState().commissionFilters
      if (f && (f.branch || f.provider)) {
        useAppStore.getState().setCommissionFilters({ ...f, branch: "", provider: "" })
      }
      // Lo mismo con el filtro del BI financiero, que también se persiste
      // (`bi-finance-filters-v3`) y guarda una sucursal de un negocio concreto.
      try { window.localStorage.removeItem("bi-finance-filters-v3") } catch { /* modo privado */ }
      void handleRefresh()
    }
    window.addEventListener("csl-business-changed", onBusinessChange)
    return () => window.removeEventListener("csl-business-changed", onBusinessChange)
  }, [handleRefresh, setDb, setDbPulsos])

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
      // Si hay otro menú permitido, el useEffect superior ya está redirigiendo —
      // mostramos un loading discreto en vez del bloqueo. Solo bloqueamos cuando
      // el usuario no tiene NINGÚN menú asignado.
      const fallback = getFirstAllowedMenu(user)
      if (fallback) {
        return (
          <div className="rounded-xl border p-6 text-sm text-muted-foreground">
            Redirigiendo a tu primer menú permitido…
          </div>
        )
      }
      return (
        <div className="rounded-xl border p-6">
          <div className="text-lg font-semibold">No tienes menús asignados</div>
          <div className="text-sm text-muted-foreground mt-2">
            Contacta al administrador para que te asigne acceso a los módulos.
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
      case "req-mat-nueva":
        return <ReqMatNuevaPage />
      case "req-mat-mis":
        return <ReqMatMisPage />
      case "req-mat-consolidado":
        return <ReqMatConsolidadoPage />
      case "req-mat-aprobaciones":
        return <ReqMatAprobacionesPage />
      case "req-mat-materiales":
        return <ReqMatMaterialesPage />
      case "req-mat-inventario":
        return <ReqMatInventarioPage />
      case "req-mat-inventario-historico":
        return <ReqMatInventarioHistoricoPage />
      case "req-mat-dashboard":
        return <ReqMatDashboardPage />
      case "prod-catalogo":
        return <ProdCatalogoPage />
      case "prod-importar":
        return <ProdImportarPage />
      case "prod-reporte":
        return <ProdReportePage />
      case "prod-conteo":
        return <ProdConteoPage />
      case "prod-conteo-historico":
        return <ProdConteoHistoricoPage />
      case "compras-dashboard":
        return <ComprasDashboardPage />
      case "compras-facturas":
        return <ComprasFacturasPage />
      case "compras-pagos":
        return <ComprasPagosPage />
      case "compras-gastos-menores":
        return <ComprasGastosMenoresPage />
      case "compras-recurrentes":
        return <ComprasRecurrentesPage />
      case "comision-dashboard":
        return <ComisionDashboardPage />
      case "comision-finanzas":
        return <ComisionFinanzasPage />
      case "comision-rentabilidad":
        return <ComisionRentabilidadPage />
      case "comision-analisis":
        return <ComisionAnalisisPage />
      case "comision-importar":
        return <ComisionImportarPage />
      case "comision-sucursales":
        return <ComisionSucursalesPage />
      case "comision-prestadores":
        return <ComisionPrestadoresPage />
      case "comision-productos":
        return <ComisionProductosPage />
      case "comision-laser":
        return <ComisionLaserPage />
      case "comision-clientes":
        return <ComisionClientesPage />
      case "comision-sin-prestador":
        return <ComisionSinPrestadorPage />
      case "comision-calculo":
        return <ComisionCalculoPage />
      case "comision-liquidacion":
        return <ComisionLiquidacionPage />
      case "comision-reglas":
        return <ComisionReglasPage />
      case "comision-historial":
        return <ComisionHistorialPage />
      case "comision-reportes":
        return <ComisionReportesPage />
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
      case "rrhh-dashboard":
        return <RrhhDashboardPage />
      case "rrhh-contratos":
        return <RrhhContratosPage />
      case "rrhh-documentos":
        return <RrhhDocumentosPage />
      case "rrhh-dashboard-ponche":
        return <RrhhDashboardPonchePage />
      case "rrhh-ponche":
        return <RrhhPonchePage />
      case "rrhh-kiosko-ponche":
        return <KioskPonchePage />
      case "rrhh-config-modalidades":
        return <RrhhConfigModalidadesPage />
      case "rrhh-asistencia":
        return <RrhhAsistenciaPage />
      case "rrhh-horarios":
        return <RrhhHorariosPage />
      case "rrhh-permisos":
        return <RrhhPermisosPage />
      case "rrhh-nomina":
        return <RrhhNominaPage />
      case "rrhh-dias-laborados":
        return <RrhhDiasLaboradosPage />
      case "rrhh-incentivos":
        return <RrhhIncentivosPage />
      case "rrhh-vacaciones":
        return <RrhhVacacionesPage />
      case "rrhh-doble-sueldo":
        return <RrhhDobleSueldoPage />
      case "rrhh-prestamos":
        return <RrhhPrestamosPage />
      case "rrhh-txt-bancarios":
        return <RrhhTxtBancariosPage />
      case "rrhh-liquidaciones":
        return <RrhhLiquidacionesPage />
      case "rrhh-pdf-prestaciones":
        return <RrhhPdfPrestacionesPage />
      case "rrhh-reclutamiento":
        return <RrhhReclutamientoPage />
      case "rrhh-onboarding":
        return <RrhhOnboardingPage />
      case "rrhh-evaluacion":
        return <RrhhEvaluacionPage />
      case "rrhh-disciplina":
        return <RrhhDisciplinaPage />
      case "rrhh-capacitacion":
        return <RrhhCapacitacionPage />
      case "rrhh-comunicacion":
        return <RrhhComunicacionPage />
      case "rrhh-reportes":
        return <RrhhReportesPage />
      case "rrhh-auditoria":
        return <RrhhAuditoriaPage />
      case "pulsos-operadoras":
        return <PulsosOperadorasPage />
      case "pulsos-lecturas":
        return <PulsosLecturasPage />
      case "pulsos-sesiones":
        return <PulsosSesionesPage />
      case "pulsos-auditoria":
        return <PulsosAuditoriaPage />
      case "pulsos-cuadre":
        return <PulsosCuadreSemanalPage />
      case "control-tratamientos":
        return <ControlTratamientosPage />
      case "cosmiatria-clientes":
        return <CosmiatriaClientesPage />
      case "cosmiatria-ficha":
        return <CosmiatriaFichaPage />
      case "consent-masajes":
        return <ConsentimientosPage kind="masajes" />
      case "consent-peeling":
        return <ConsentimientosPage kind="peeling" />
      case "consent-tatuajes-cejas":
        return <ConsentimientosPage kind="tatuajes" />
      case "consent-depilacion-laser":
        return <ConsentimientosPage kind="depilacion-laser" />
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
      case "bi-fin-dashboard":
        return <BiDashboardPage />
      case "bi-fin-asistente":
        return <BiAsistentePage />
      case "bi-fin-ventas":
        return <BiVentasPage />
      case "bi-fin-gastos":
        return <BiGastosPage />
      case "bi-fin-rentabilidad":
        return <BiRentabilidadPage />
      case "bi-fin-proyecciones":
        return <BiProyeccionesPage />
      case "bi-fin-inversiones":
        return <BiInversionesPage />
      case "bi-fin-alertas":
        return <BiAlertasPage />
      case "bi-fin-reportes":
        return <BiReportesPage />
      case "bi-fin-config":
        return <BiConfigPage />
      case "admin-users":
        return <AdminUsersPage />
      case "admin-permisos":
        return <AdminPermisosPage />
      case "admin-agendapro":
        return <AgendaProIntegracionPage />
      default:
        return <ConfigPage />
    }
  }

  if (!isReady) return null

  if (!user) {
    return <LoginPage onLogin={(logged) => {
      setUser(logged)
      // Default tab tras login: primer menú permitido (no asumir "panel"
      // porque muchos usuarios no tienen acceso al Dashboard Ejecutivo).
      const first = getFirstAllowedMenu(logged)
      if (first) setActiveTab(first)
    }} />
  }

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <Sidebar />
      <LoadingOverlay />
      <ToastNotification />
      {/* data-csl-main: el padding-left lo controla app/globals.css con
          media queries explícitas (< 1180px → 0; ≥ 1180px → 18rem).
          No depende de Tailwind variants para evitar fallo en producción. */}
      <div data-csl-main>
        <Header onRefresh={activeTab !== "config" && !String(activeTab).startsWith("pulsos-") && !String(activeTab).startsWith("pulse-") ? handleRefresh : undefined} />
        {/* Layout centrado:
              - max-w-[1480px] cap para que en pantallas muy anchas no quede infinito
              - min-w-0 para que las tablas hijas no fuercen overflow del shell
              - padding progresivo: cómodo en mobile, generoso en xl */}
        <main className="mx-auto min-w-0 max-w-[1480px] px-3 py-5 sm:px-5 sm:py-6 lg:px-7 xl:px-10 xl:py-8">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}
