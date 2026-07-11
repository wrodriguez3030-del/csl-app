"use client"

/**
 * Selector de PERÍODO (mes/año) [+ sucursal] compartido por las pantallas
 * mensuales de Incentivos de Ventas (Comisión láser, Clientes atendidos, Cálculo
 * mensual). El último período elegido se comparte entre pantallas mientras dura
 * la sesión (estado a nivel de módulo): cambiar de pantalla NO resetea el mes.
 */
import { useState } from "react"

export const COMMISSION_BRANCHES = ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]
export const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

// Estado compartido a nivel de módulo (persiste entre pantallas en la sesión SPA).
const shared: { month: number; year: number; branch: string } = {
  month: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
  branch: COMMISSION_BRANCHES[0],
}

export function usePeriodoCompartido() {
  const [month, setM] = useState(shared.month)
  const [year, setY] = useState(shared.year)
  const [branch, setB] = useState(shared.branch)
  return {
    month, year, branch,
    setMonth: (v: number) => { shared.month = v; setM(v) },
    setYear: (v: number) => { shared.year = v; setY(v) },
    setBranch: (v: string) => { shared.branch = v; setB(v) },
  }
}

export function PeriodoSucursalPicker({
  month, year, branch, onMonth, onYear, onBranch, showBranch = false,
}: {
  month: number; year: number; branch?: string
  onMonth: (v: number) => void; onYear: (v: number) => void; onBranch?: (v: string) => void
  showBranch?: boolean
}) {
  const now = new Date().getFullYear()
  const years = [now + 1, now, now - 1, now - 2]
  return (
    <>
      {showBranch && onBranch ? (
        <div>
          <label className="text-[11px] font-medium">Sucursal</label>
          <select className="mt-0.5 h-9 w-48 rounded-md border border-input bg-white px-2 text-sm" value={branch} onChange={(e) => onBranch(e.target.value)}>
            {COMMISSION_BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      ) : null}
      <div>
        <label className="text-[11px] font-medium">Mes</label>
        <select className="mt-0.5 h-9 w-36 rounded-md border border-input bg-white px-2 text-sm" value={month} onChange={(e) => onMonth(Number(e.target.value))}>
          {MONTHS_ES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </div>
      <div>
        <label className="text-[11px] font-medium">Año</label>
        <select className="mt-0.5 h-9 w-24 rounded-md border border-input bg-white px-2 text-sm" value={year} onChange={(e) => onYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </>
  )
}
