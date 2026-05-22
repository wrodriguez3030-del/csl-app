"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, Pencil, Trash2, Power, PowerOff, ShieldCheck, ShieldAlert, KeyRound, Search, Save, X, Loader2, RefreshCw } from "lucide-react"
import { useAppStore } from "@/lib/store"
import { supabaseBrowser } from "@/lib/supabase-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SeqBadge } from "@/components/seq-badge"
import { MENU_OPTIONS, type MenuPermission } from "@/lib/menus"
import { useSessionUser } from "@/hooks/use-session-user"

type RoleKey = "usuario" | "admin" | "superadmin"

interface AdminUserRow {
  user_id: string
  nombre: string
  username: string
  is_admin: boolean
  is_superadmin: boolean
  activo: boolean
  business_id: string
  menus: string[]
  created_at?: string
  businesses?: { slug: string; name: string } | null
}

interface FormState {
  user_id: string
  nombre: string
  email: string
  password: string
  businessSlug: "csl" | "depicenter"
  role: RoleKey
  activo: boolean
  menus: MenuPermission[]
}

const emptyForm: FormState = {
  user_id: "",
  nombre: "",
  email: "",
  password: "",
  businessSlug: "csl",
  role: "usuario",
  activo: true,
  menus: [],
}

// Menús base sugeridos por rol/business (UX, no security — el backend
// re-valida y aplica MENU_ID_SET).
const SUGGESTED_MENUS_CSL: MenuPermission[] = [
  "panel", "sucursales", "equipos", "tecnicos", "reporte", "reportes", "historial-equipos", "inventario",
]
const SUGGESTED_MENUS_DEPICENTER: MenuPermission[] = [
  "panel", "sucursales", "equipos", "tecnicos", "credenciales", "reporte", "reportes",
  "historial-equipos", "inventario", "errores", "cliente-certificados-depicenter",
]

function roleFrom(user: AdminUserRow): RoleKey {
  if (user.is_superadmin) return "superadmin"
  if (user.is_admin) return "admin"
  return "usuario"
}

async function authedFetch(input: string, init?: RequestInit) {
  const { data: { session } } = await supabaseBrowser.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error("Sesión expirada. Reingresá al sistema.")
  const headers = new Headers(init?.headers || {})
  headers.set("Authorization", `Bearer ${token}`)
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  const res = await fetch(input, { ...init, headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.ok) {
    throw new Error((json as { error?: string })?.error || `HTTP ${res.status}`)
  }
  return json
}

export function AdminUsersPage() {
  const { showToast } = useAppStore()
  const currentUser = useSessionUser()
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [filterBusiness, setFilterBusiness] = useState<"todos" | "csl" | "depicenter">("todos")

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editing, setEditing] = useState<AdminUserRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<AdminUserRow | null>(null)
  const [tempPasswordModal, setTempPasswordModal] = useState<{ email: string; password: string } | null>(null)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch("/api/admin/users")
      setUsers((res.users as AdminUserRow[]) || [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error cargando usuarios", "error")
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter((u) => {
      if (filterBusiness !== "todos" && u.businesses?.slug !== filterBusiness) return false
      if (q && !u.nombre.toLowerCase().includes(q) && !u.username.toLowerCase().includes(q)) return false
      return true
    })
  }, [users, query, filterBusiness])

  const openNew = () => {
    setEditing(null)
    setForm({ ...emptyForm, menus: SUGGESTED_MENUS_CSL })
    setOpen(true)
  }

  const openEdit = (u: AdminUserRow) => {
    setEditing(u)
    setForm({
      user_id: u.user_id,
      nombre: u.nombre,
      email: u.username,
      password: "",
      businessSlug: (u.businesses?.slug as "csl" | "depicenter") || "csl",
      role: roleFrom(u),
      activo: u.activo,
      menus: (u.menus || []) as MenuPermission[],
    })
    setOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        nombre: form.nombre,
        email: form.email,
        password: form.password,
        businessId: form.businessSlug,
        isAdmin: form.role === "admin",
        isSuperadmin: form.role === "superadmin",
        activo: form.activo,
        menus: form.menus,
      }
      if (editing) {
        // En edit, no enviar email (es read-only); enviar password solo si se cambió
        const patchBody: Record<string, unknown> = {
          nombre: payload.nombre,
          businessId: payload.businessId,
          isAdmin: payload.isAdmin,
          isSuperadmin: payload.isSuperadmin,
          activo: payload.activo,
          menus: payload.menus,
        }
        if (payload.password) patchBody.password = payload.password
        await authedFetch(`/api/admin/users/${editing.user_id}`, {
          method: "PATCH",
          body: JSON.stringify(patchBody),
        })
        showToast(`Usuario "${form.nombre}" actualizado`, "success")
      } else {
        await authedFetch("/api/admin/users", {
          method: "POST",
          body: JSON.stringify(payload),
        })
        // Mostrar el password temporal una vez al admin para que pueda compartirlo
        setTempPasswordModal({ email: form.email, password: form.password })
        showToast(`Usuario "${form.nombre}" creado`, "success")
      }
      setOpen(false)
      setForm(emptyForm)
      void loadUsers()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error guardando", "error")
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (u: AdminUserRow) => {
    try {
      await authedFetch(`/api/admin/users/${u.user_id}`, {
        method: "PATCH",
        body: JSON.stringify({ activo: !u.activo }),
      })
      showToast(`Usuario ${!u.activo ? "activado" : "desactivado"}`, "success")
      void loadUsers()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error")
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    try {
      await authedFetch(`/api/admin/users/${confirmDelete.user_id}`, { method: "DELETE" })
      showToast(`Usuario "${confirmDelete.nombre}" eliminado`, "success")
      setConfirmDelete(null)
      void loadUsers()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error eliminando", "error")
    }
  }

  const handleResetPassword = async (u: AdminUserRow) => {
    const newPwd = window.prompt(`Nueva contraseña temporal para ${u.username} (mín 6 chars):`)
    if (!newPwd || newPwd.length < 6) return
    try {
      await authedFetch(`/api/admin/users/${u.user_id}`, {
        method: "PATCH",
        body: JSON.stringify({ password: newPwd }),
      })
      setTempPasswordModal({ email: u.username, password: newPwd })
      showToast("Contraseña reseteada", "success")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error")
    }
  }

  // Gate de acceso: si el user actual no es superadmin, mostramos "acceso denegado"
  // (también la ruta del menú lo gatea, pero defensa en profundidad).
  if (!currentUser?.isSuperadmin) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-amber-700" />
        <h2 className="mt-4 text-lg font-black text-amber-900">Acceso denegado</h2>
        <p className="mt-2 text-sm text-amber-800">
          Esta pantalla requiere rol <b>superadmin</b>. Si crees que es un error, contactá a un administrador del sistema.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] uppercase text-muted-foreground">Total</p>
          <p className="text-2xl font-bold">{users.length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] uppercase text-muted-foreground">Activos</p>
          <p className="text-2xl font-bold text-emerald-600">{users.filter(u => u.activo).length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] uppercase text-muted-foreground">CSL</p>
          <p className="text-2xl font-bold text-cyan-700">{users.filter(u => u.businesses?.slug === "csl").length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] uppercase text-muted-foreground">Depicenter</p>
          <p className="text-2xl font-bold text-teal-700">{users.filter(u => u.businesses?.slug === "depicenter").length}</p>
        </CardContent></Card>
      </div>

      {/* Filtros + acciones */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre o email..." className="pl-8" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Negocio</Label>
              <Select value={filterBusiness} onValueChange={(v) => setFilterBusiness(v as "todos" | "csl" | "depicenter")}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="csl">Cibao Spa Laser</SelectItem>
                  <SelectItem value="depicenter">Depicenter Skin Laser</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadUsers()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Actualizar
            </Button>
            <Button onClick={openNew} size="sm">
              <Plus className="h-4 w-4 mr-2" />Nuevo usuario
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{filtered.length} de {users.length} usuarios</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Negocio</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Cargando...
                </TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  Sin usuarios
                </TableCell></TableRow>
              ) : (
                filtered.map((u, i) => (
                  <TableRow key={u.user_id} className="cursor-pointer" onClick={() => openEdit(u)}>
                    <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                    <TableCell className="font-semibold">{u.nombre}</TableCell>
                    <TableCell className="text-xs text-muted-foreground break-all">{u.username}</TableCell>
                    <TableCell>
                      {u.businesses?.slug === "depicenter" ? (
                        <Badge className="bg-teal-100 text-teal-800 border-teal-200">Depicenter</Badge>
                      ) : u.businesses?.slug === "csl" ? (
                        <Badge className="bg-cyan-100 text-cyan-800 border-cyan-200">CSL</Badge>
                      ) : <Badge variant="outline">—</Badge>}
                    </TableCell>
                    <TableCell>
                      {u.is_superadmin ? (
                        <Badge className="gap-1 bg-amber-100 text-amber-900 border-amber-300"><ShieldCheck className="h-3 w-3" />Superadmin</Badge>
                      ) : u.is_admin ? (
                        <Badge className="bg-blue-100 text-blue-800 border-blue-200">Admin</Badge>
                      ) : (
                        <Badge variant="outline">Usuario</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.activo ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Activo</Badge>
                      ) : (
                        <Badge className="bg-slate-200 text-slate-700 border-slate-300">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-0.5 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => openEdit(u)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Reset contraseña" onClick={() => void handleResetPassword(u)}>
                          <KeyRound className="h-3.5 w-3.5 text-amber-600" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title={u.activo ? "Desactivar" : "Activar"} onClick={() => void handleToggleActive(u)}>
                          {u.activo ? <PowerOff className="h-3.5 w-3.5 text-orange-600" /> : <Power className="h-3.5 w-3.5 text-emerald-600" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Eliminar" onClick={() => setConfirmDelete(u)} disabled={u.user_id === currentUser?.id}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog create/edit */}
      <Dialog open={open} onOpenChange={(v) => { if (!saving) setOpen(v) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar usuario: ${editing.nombre}` : "Nuevo usuario"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nombre *</Label>
                <Input value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} placeholder="Nombre Apellido" />
              </div>
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="user@ejemplo.com" disabled={!!editing} />
              </div>
              <div className="space-y-1.5">
                <Label>Contraseña {editing ? "(dejar vacío para no cambiar)" : "temporal *"}</Label>
                <Input type="text" value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="mín 6 caracteres" />
              </div>
              <div className="space-y-1.5">
                <Label>Negocio *</Label>
                <Select
                  value={form.businessSlug}
                  onValueChange={(v) => {
                    const slug = v as "csl" | "depicenter"
                    setForm({
                      ...form,
                      businessSlug: slug,
                      // Auto-sugerir menús apropiados si el user es "usuario normal"
                      menus: form.role === "usuario"
                        ? (slug === "depicenter" ? SUGGESTED_MENUS_DEPICENTER : SUGGESTED_MENUS_CSL)
                        : form.menus,
                    })
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csl">Cibao Spa Laser (CSL)</SelectItem>
                    <SelectItem value="depicenter">Depicenter Skin Laser</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Rol *</Label>
                <Select value={form.role} onValueChange={(v) => setForm({...form, role: v as RoleKey})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="usuario">Usuario (acceso a menús seleccionados)</SelectItem>
                    <SelectItem value="admin">Admin (todos los menús del negocio)</SelectItem>
                    <SelectItem value="superadmin">Superadmin (cross-tenant, ambos negocios)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <Select value={form.activo ? "1" : "0"} onValueChange={(v) => setForm({...form, activo: v === "1"})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Activo</SelectItem>
                    <SelectItem value="0">Inactivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.role === "usuario" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Menús permitidos (selecciona al menos uno)</Label>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setForm({...form, menus: form.businessSlug === "depicenter" ? SUGGESTED_MENUS_DEPICENTER : SUGGESTED_MENUS_CSL})}>
                      Preset {form.businessSlug.toUpperCase()}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setForm({...form, menus: []})}>Limpiar</Button>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-muted/30 p-3">
                  {Object.entries(
                    MENU_OPTIONS.reduce<Record<string, typeof MENU_OPTIONS>>((acc, opt) => {
                      // No mostrar admin-users en checkboxes — es exclusivo de superadmin
                      if (opt.id === "admin-users") return acc
                      ;(acc[opt.section] = acc[opt.section] || []).push(opt)
                      return acc
                    }, {})
                  ).map(([section, opts]) => (
                    <div key={section} className="mb-3 last:mb-0">
                      <p className="text-[11px] font-bold uppercase text-muted-foreground mb-1">{section}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {opts.map((opt) => {
                          const checked = form.menus.includes(opt.id)
                          return (
                            <label key={opt.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white/60 rounded px-1.5 py-0.5">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...form.menus, opt.id]
                                    : form.menus.filter(m => m !== opt.id)
                                  setForm({...form, menus: next})
                                }}
                              />
                              <span>{opt.label}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {form.menus.length} menús seleccionados
                </p>
              </div>
            )}

            {(form.role === "admin" || form.role === "superadmin") && (
              <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
                💡 {form.role === "superadmin"
                  ? "Superadmin tiene acceso a TODOS los menús + datos de TODOS los negocios. Bypasa filtros tenant."
                  : "Admin tiene acceso a TODOS los menús, pero solo a los datos de su negocio."}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}><X className="h-4 w-4 mr-2" />Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.nombre || !form.email || (!editing && !form.password)}>
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</> : <><Save className="h-4 w-4 mr-2" />{editing ? "Guardar cambios" : "Crear usuario"}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>¿Eliminar usuario?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se eliminará <b>{confirmDelete?.nombre}</b> ({confirmDelete?.username}) del sistema y de Supabase Auth. Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete}><Trash2 className="h-4 w-4 mr-2" />Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mostrar password temporal una vez */}
      <Dialog open={!!tempPasswordModal} onOpenChange={() => setTempPasswordModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Contraseña temporal generada</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Esta contraseña solo se muestra una vez. Copiala y pasásela al usuario por canal seguro.
            </p>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <p><b>Email:</b> <span className="font-mono">{tempPasswordModal?.email}</span></p>
              <p className="mt-1"><b>Contraseña:</b> <span className="font-mono text-lg">{tempPasswordModal?.password}</span></p>
            </div>
            <p className="text-[11px] text-amber-700">
              ⚠️ Recordá al usuario cambiar su contraseña en el primer login (próxima feature).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              if (tempPasswordModal) {
                void navigator.clipboard.writeText(tempPasswordModal.password)
                showToast("Contraseña copiada al portapapeles", "success")
              }
            }}>Copiar contraseña</Button>
            <Button onClick={() => setTempPasswordModal(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
