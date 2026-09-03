"use client"

/**
 * PERMISOS Y RECHAZOS — la pantalla del modo sombra.
 *
 * Mientras `PERMISOS_ESTRICTOS` no esté en "on", el sistema comprueba los
 * permisos pero NO bloquea nada: solo anota lo que habría bloqueado. Esta
 * pantalla es donde se lee eso, para poder cerrar de verdad sabiendo a quién
 * le falta qué, en vez de enterarse cuando alguien no puede trabajar.
 *
 * La lista de arriba es literalmente la tarea pendiente: cada fila es un
 * permiso que habría que conceder (o una acción que no debería estar
 * ocurriendo) antes de pasar a estricto.
 */
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Eye, Loader2, Lock, RefreshCw, ShieldCheck } from "lucide-react"
import { useAppStore, apiCall, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface Resumen {
  user_email: string | null
  permiso: string
  acciones: string[]
  veces: number
  ultima: string
  modo: string
}

interface Reciente {
  id: string
  user_email: string | null
  accion: string
  permiso: string
  ruta: string | null
  modo: string
  ip_address: string | null
  created_at: string
}

const fecha = (iso: string): string =>
  new Date(iso).toLocaleString("es-DO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })

export function AdminPermisosPage() {
  const apiUrl = useAppStore((s) => s.apiUrl)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState("")
  const [modo, setModo] = useState<"sombra" | "estricto">("sombra")
  const [total, setTotal] = useState(0)
  const [resumen, setResumen] = useState<Resumen[]>([])
  const [recientes, setRecientes] = useState<Reciente[]>([])

  const cargar = useCallback(async () => {
    setCargando(true)
    setError("")
    try {
      const res = (await apiCall(normalizeApiUrl(apiUrl), { action: "getPermissionDenials" })) as {
        ok?: boolean
        error?: string
        modo?: "sombra" | "estricto"
        total?: number
        resumen?: Resumen[]
        recientes?: Reciente[]
      }
      if (!res.ok) throw new Error(res.error || "No se pudo leer el registro de rechazos")
      setModo(res.modo === "estricto" ? "estricto" : "sombra")
      setTotal(res.total ?? 0)
      setResumen(res.resumen ?? [])
      setRecientes(res.recientes ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido")
    } finally {
      setCargando(false)
    }
  }, [apiUrl])

  useEffect(() => { void cargar() }, [cargar])

  const enSombra = modo === "sombra"

  return (
    <div className="space-y-4">
      <Card className={enSombra ? "border-amber-300 bg-amber-50/60" : "border-emerald-300 bg-emerald-50/60"}>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          {enSombra ? <Eye className="h-5 w-5 text-amber-700" /> : <Lock className="h-5 w-5 text-emerald-700" />}
          <div className="flex-1 min-w-[16rem]">
            <p className="font-semibold">{enSombra ? "Modo sombra: no se está bloqueando nada" : "Modo estricto: los permisos se están aplicando"}</p>
            <p className="text-sm text-muted-foreground">
              {enSombra
                ? "El sistema anota lo que habría bloqueado. Revisa la lista de abajo, concede lo que falte y solo entonces pon PERMISOS_ESTRICTOS=on."
                : "Toda acción sin permiso se rechaza con un aviso claro. Aquí quedan registradas."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void cargar()} disabled={cargando}>
            {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Actualizar</span>
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-300 bg-red-50/60">
          <CardContent className="flex items-center gap-2 py-4 text-red-800">
            <AlertTriangle className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Lo que falta por conceder
            <Badge variant="secondary">{resumen.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cargando && !resumen.length ? (
            <p className="py-8 text-center text-muted-foreground">Cargando…</p>
          ) : !resumen.length ? (
            <p className="py-8 text-center text-muted-foreground">
              Ningún rechazo en los últimos 30 días. {enSombra ? "Se puede pasar a estricto." : "Todo en orden."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Permiso que falta</TableHead>
                    <TableHead>Acciones</TableHead>
                    <TableHead className="text-right">Veces</TableHead>
                    <TableHead>Última</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumen.map((r) => (
                    <TableRow key={`${r.user_email}|${r.permiso}`}>
                      <TableCell className="font-medium">{r.user_email || "—"}</TableCell>
                      <TableCell>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.permiso}</code>
                      </TableCell>
                      <TableCell className="max-w-[24rem] text-xs text-muted-foreground">
                        {r.acciones.slice(0, 4).join(", ")}
                        {r.acciones.length > 4 ? ` y ${r.acciones.length - 4} más` : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.veces}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fecha(r.ultima)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Últimos rechazos <span className="font-normal text-muted-foreground">({total} en 30 días)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!recientes.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sin registros.</p>
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cuándo</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Acción</TableHead>
                    <TableHead>Permiso</TableHead>
                    <TableHead>Modo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recientes.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">{fecha(r.created_at)}</TableCell>
                      <TableCell className="text-xs">{r.user_email || "—"}</TableCell>
                      <TableCell className="text-xs">{r.ruta || r.accion}</TableCell>
                      <TableCell className="text-xs">
                        <code className="rounded bg-muted px-1.5 py-0.5">{r.permiso}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.modo === "estricto" ? "destructive" : "secondary"}>{r.modo}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
