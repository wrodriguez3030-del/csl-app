"use client"

/**
 * CF PARA IMPRIMIR · Hook de datos del módulo de certificados de regalo.
 *
 * Encapsula todas las llamadas al backend (giftCert*) y expone acciones con
 * manejo de errores. El backend es la fuente de verdad de estados/permisos;
 * este hook solo orquesta la UI.
 */
import { useCallback, useEffect, useState } from "react"
import { apiJsonp, useAppStore } from "@/lib/store"
import type { GiftTemplateId } from "@/lib/certificados/cert-layout"

/** DTO devuelto por el backend (mapGiftRow). */
export interface GiftCertRecord {
  codigo: string
  tipo: string
  estado: string
  templateId: GiftTemplateId
  otorgadoA: string
  cortesiaDe: string
  validoPara: string
  validoHasta: string
  fechaEmision: string
  sucursal: string
  sucursalDireccion: string
  sucursalTelefono: string
  telefono: string
  correo: string
  notaInterna: string
  creadoPor: string
  firma: string
  emitidoEn: string
  entregadoPor: string
  entregadoEn: string
  canjeadoPor: string
  canjeadoEn: string
  canjeadoSucursal: string
  motivoAnulacion: string
  anuladoPor: string
  anuladoEn: string
  notasEstado: string
  createdAt: string
  updatedAt: string
}

export interface GiftCertAuditRow {
  id: string
  codigo: string
  accion: string
  usuario: string | null
  motivo: string | null
  created_at: string
}

export function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useGiftCertificates() {
  const apiUrl = useAppStore((s) => s.apiUrl)
  const [records, setRecords] = useState<GiftCertRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const r = await apiJsonp(apiUrl, { action: "giftCertList" })
      setRecords((r.records as GiftCertRecord[]) || [])
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [apiUrl])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Crea o actualiza un borrador. Devuelve el registro guardado (con su código). */
  const save = useCallback(
    async (data: Record<string, unknown>): Promise<GiftCertRecord> => {
      const r = await apiJsonp(apiUrl, { action: "giftCertSave", data: JSON.stringify(data) })
      return r.record as GiftCertRecord
    },
    [apiUrl],
  )

  const emit = useCallback(
    async (codigo: string): Promise<GiftCertRecord> => {
      const r = await apiJsonp(apiUrl, { action: "giftCertEmit", codigo })
      return r.record as GiftCertRecord
    },
    [apiUrl],
  )

  const transition = useCallback(
    async (codigo: string, accion: "entregar" | "canjear" | "anular", extra: Record<string, string> = {}): Promise<GiftCertRecord> => {
      const r = await apiJsonp(apiUrl, { action: "giftCertTransition", codigo, accion, ...extra })
      return r.record as GiftCertRecord
    },
    [apiUrl],
  )

  const duplicate = useCallback(
    async (codigo: string): Promise<GiftCertRecord> => {
      const r = await apiJsonp(apiUrl, { action: "giftCertDuplicate", codigo })
      return r.record as GiftCertRecord
    },
    [apiUrl],
  )

  const getAudit = useCallback(
    async (codigo: string): Promise<GiftCertAuditRow[]> => {
      const r = await apiJsonp(apiUrl, { action: "giftCertAudit", codigo })
      return (r.records as GiftCertAuditRow[]) || []
    },
    [apiUrl],
  )

  /** Traza best-effort de impresión/descarga (no bloquea la UI). */
  const logExport = useCallback(
    (codigo: string, accionExport: string) => {
      void apiJsonp(apiUrl, { action: "giftCertLogExport", codigo, accionExport }).catch(() => undefined)
    },
    [apiUrl],
  )

  return { records, loading, error, refresh, save, emit, transition, duplicate, getAudit, logExport }
}
