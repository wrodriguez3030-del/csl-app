"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { apiJsonp, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircle2,
  Link2,
  Loader2,
  Pencil,
  Pencil as EditIcon,
  Plus,
  Shield,
  Trash2,
  Users,
  XCircle,
} from "lucide-react"
import type { Database, DatabasePulsos, TabId } from "@/lib/types"
import { MENU_OPTIONS, getSessionUser, type MenuPermission, type SystemUser } from "@/lib/security"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 6
const ALL_MENU_IDS = MENU_OPTIONS.map((menu) => menu.id)

const emptyUser: SystemUser = {
  id: "",
  nombre: "",
  username: "",
  password: "",
  activo: true,
  isAdmin: false,
  // por defecto, panel = Dashboard, para que un usuario nuevo al menos
  // pueda entrar y ver algo.
  menus: ["panel"],
  createdAt: "",
}

export function ConfigPage() {
  const {
    apiUrl,
    setApiUrl,
    isConnected,
    setIsConnected,
    setDb,
    setDbPulsos,
    showToast,
    setIsLoading,
    setLoadingMessage,
  } = useAppStore()

  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">(isConnected ? "success" : "idle")
  const [statusMessage, setStatusMessage] = useState("")
  const [currentUser, setCurrentUser] = useState<SystemUser | null>(null)
  const [users, setUsers] = useState<SystemUser[]>([])
  const [usersLoaded, setUsersLoaded] = useState(false)
  const [usersError, setUsersError] = useState("")
  const [form, setForm] = useState<SystemUser>(emptyUser)
  const [editingId, setEditingId] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState("")

  /**
   * Snapshot de los permisos NO-admin del usuario en el formulario.
   *
   * Lo usamos para que cuando alguien marque "Administrador" (lo que asigna
   * todos los menús automáticamente para mostrar en UI) y luego DESMARQUE
   * "Administrador", podamos RESTAURAR sus permisos previos en lugar de
   * dejar todos marcados.
   *
   * Antes había un bug: al desmarcar Administrador, form.menus se quedaba
   * en ALL_MENU_IDS, y al guardar la BD persistía un usuario "no-admin con
   * todos los permisos" → próxima edición todos los checkboxes aparecían
   * marcados.
   */
  const previousMenusRef = useRef<MenuPermission[]>([])

  const loadUsers = async () => {
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getUsers" })
      if (!result.ok) throw new Error(String(result.error || "No se pudo cargar la lista"))
      setUsers((result.records as SystemUser[]) || [])
      setUsersError("")
    } catch (error) {
      // No vaciamos la lista en pantalla: si la red falla, mejor mantener
      // lo último conocido y mostrar el error en un banner.
      setUsersError(error instanceof Error ? error.message : "Error cargando usuarios")
    } finally {
      setUsersLoaded(true)
    }
  }

  useEffect(() => {
    const sync = async () => {
      setCurrentUser(getSessionUser())
      await loadUsers()
    }
    void sync()
    window.addEventListener("storage", sync)
    window.addEventListener("csl-auth-changed", sync as EventListener)
    return () => {
      window.removeEventListener("storage", sync)
      window.removeEventListener("csl-auth-changed", sync as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groupedMenus = useMemo(() => {
    return MENU_OPTIONS.reduce<Record<string, typeof MENU_OPTIONS>>((acc, menu) => {
      if (!acc[menu.section]) acc[menu.section] = []
      acc[menu.section].push(menu)
      return acc
    }, {})
  }, [])

  const editingUser = useMemo(
    () => (editingId ? users.find((u) => u.id === editingId) : null),
    [editingId, users],
  )

  const handleTestConnection = async () => {
    const normalized = normalizeApiUrl(apiUrl)
    setApiUrl(normalized)

    setConnectionStatus("idle")
    setStatusMessage("Probando conexión...")

    try {
      const result = await apiJsonp(normalized, { action: "health" })
      if (result && result.ok) {
        setConnectionStatus("success")
        setStatusMessage("Conexión exitosa")
        setIsConnected(true)
        showToast("Conectado correctamente", "success")
      } else {
        throw new Error((result as { error?: string })?.error || "Respuesta inválida")
      }
    } catch (error) {
      setConnectionStatus("error")
      setStatusMessage(error instanceof Error ? error.message : "Error desconocido")
      setIsConnected(false)
      showToast("Error de conexión", "error")
    }
  }

  const handleLoadData = async () => {
    const normalized = normalizeApiUrl(apiUrl)
    setApiUrl(normalized)

    setIsLoading(true)
    setLoadingMessage("Cargando datos del sistema...")

    try {
      const result = await apiJsonp(normalized, { action: "getAllData" })
      if (result && result.ok && result.data) {
        setDb(result.data as Database)
        setIsConnected(true)
        setConnectionStatus("success")
        showToast("Datos cargados correctamente", "success")
      } else {
        throw new Error((result as { error?: string })?.error || "Error del servidor")
      }

      try {
        const pulsos = await apiJsonp(normalized, { action: "getAllPulsosData" })
        if (pulsos && pulsos.ok) {
          setDbPulsos({
            operadoras: (pulsos.operadoras as DatabasePulsos["operadoras"]) || [],
            lecturasSemanales: (pulsos.lecturasSemanales as DatabasePulsos["lecturasSemanales"]) || [],
            sesionesCliente: (pulsos.sesionesCliente as DatabasePulsos["sesionesCliente"]) || [],
            auditoriasSemanales: [],
            pulseReadings: (pulsos.pulseReadings as DatabasePulsos["pulseReadings"]) || [],
          })
        }
      } catch {}

      setStatusMessage("Datos cargados")
    } catch (error) {
      setConnectionStatus("error")
      setStatusMessage(error instanceof Error ? error.message : "Error desconocido")
      showToast(error instanceof Error ? error.message : "Error al cargar datos", "error")
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Limpia el formulario y sale del modo edición.
   * Se llama desde:
   *   - botón "Limpiar"
   *   - botón "Cancelar edición"
   *   - cierre exitoso de un guardado
   *   - eliminación del usuario que se estaba editando
   */
  const resetForm = () => {
    setForm(emptyUser)
    setEditingId("")
    previousMenusRef.current = [] // descartar snapshot de permisos previos
  }

  const toggleMenu = (menu: TabId, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      menus: checked
        ? Array.from(new Set([...prev.menus, menu]))
        : prev.menus.filter((m) => m !== menu),
    }))
  }

  const handleSaveUser = async () => {
    if (isSaving) return // anti-doble-click
    if (!currentUser?.isAdmin) {
      showToast("Solo el administrador puede gestionar accesos", "error")
      return
    }

    const nombre = form.nombre.trim()
    const username = form.username.trim()
    const password = form.password.trim()

    // ---- validaciones de cliente ----
    if (!nombre) return showToast("Falta el nombre", "error")
    if (!username) return showToast("Falta el correo", "error")
    if (!EMAIL_RE.test(username)) return showToast("El correo no tiene formato válido", "error")
    if (!editingId && !password) return showToast("Falta la clave del usuario nuevo", "error")
    if (password && password.length < MIN_PASSWORD) {
      return showToast(`La clave debe tener al menos ${MIN_PASSWORD} caracteres`, "error")
    }
    if (!form.isAdmin && form.menus.length === 0) {
      return showToast("Selecciona al menos un módulo o marca el usuario como Administrador", "error")
    }

    // duplicado por correo (excluyendo el propio en edición)
    const duplicated = users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase() && u.id !== editingId,
    )
    if (duplicated) return showToast("Ya existe un usuario con ese correo", "error")

    // protección contra "suicidio" admin: si me edito a mí mismo y me quito
    // admin / me desactivo, debe quedar al menos OTRO admin activo.
    if (editingId && editingId === currentUser.id) {
      const losingAdmin = !form.isAdmin
      const losingActive = !form.activo
      if (losingAdmin || losingActive) {
        const otherActiveAdmins = users.filter(
          (u) => u.id !== currentUser.id && u.isAdmin && u.activo,
        ).length
        if (otherActiveAdmins === 0) {
          return showToast(
            losingActive
              ? "No puedes desactivarte: eres el único administrador activo"
              : "No puedes quitarte el rol de administrador: eres el único administrador activo",
            "error",
          )
        }
      }
    }

    const next: SystemUser = {
      id: editingId,
      nombre,
      username,
      password,
      activo: form.activo,
      isAdmin: form.isAdmin,
      // si es admin, todos los menús; si no, dedup y respetar la selección
      menus: form.isAdmin ? [...ALL_MENU_IDS] : Array.from(new Set(form.menus)),
      createdAt: editingUser?.createdAt || new Date().toISOString(),
    }

    setIsSaving(true)
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "saveUser",
        data: JSON.stringify(next),
      })
      if (!result.ok) throw new Error(String(result.error || "No se pudo guardar el usuario"))

      // ORDEN IMPORTANTE:
      //   1) refrescar listado del backend
      //   2) limpiar formulario
      //   3) toast
      // Si refrescar falla, el usuario ve el estado real y puede reintentar.
      await loadUsers()
      const wasEditing = Boolean(editingId)
      resetForm()
      showToast(wasEditing ? "Usuario actualizado" : "Usuario creado", "success")
    } catch (error) {
      // En error: NO limpiamos el formulario para que el admin reintente.
      showToast(error instanceof Error ? error.message : "Error al guardar usuario", "error")
    } finally {
      setIsSaving(false)
    }
  }

  const handleEditUser = (user: SystemUser) => {
    setEditingId(user.id)
    // password va vacía: el backend solo cambia la password si se escribe una.
    // Cargamos exactamente los permisos guardados — sin defaults ni "todos por
    // si acaso". Si en BD el usuario tiene 4 menús, el form muestra 4 menús.
    setForm({ ...user, password: "" })
    // Snapshot de permisos para poder restaurarlos si el admin marca y luego
    // desmarca el checkbox "Administrador". Si el usuario YA es admin guardado
    // como tal, el snapshot queda vacío para que al desmarcar Admin el form
    // limpie permisos y el admin pueda elegir manualmente.
    previousMenusRef.current = user.isAdmin ? [] : [...user.menus]
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleDeleteUser = async (user: SystemUser) => {
    if (!currentUser?.isAdmin) return
    if (user.id === currentUser.id) {
      showToast("No puedes eliminar tu propia cuenta", "error")
      return
    }
    if (deletingId) return

    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `¿Eliminar definitivamente a ${user.nombre || user.username}?\n\nEsta acción borra la cuenta de Supabase Auth y no se puede deshacer.`,
      )
      if (!ok) return
    }

    setDeletingId(user.id)
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "deleteUser", id: user.id })
      if (!result.ok) throw new Error(String(result.error || "No se pudo eliminar el usuario"))

      // Quitar del listado local de inmediato y refrescar para asegurar consistencia.
      setUsers((prev) => prev.filter((u) => u.id !== user.id))
      if (editingId === user.id) resetForm()
      void loadUsers()
      showToast("Usuario eliminado", "success")
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al eliminar usuario", "error")
    } finally {
      setDeletingId("")
    }
  }

  if (!currentUser?.isAdmin) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">
            Solo el administrador puede entrar a <b>Configuración &gt; Usuarios y Permisos</b>.
          </div>
        </CardContent>
      </Card>
    )
  }

  const totalMenus = ALL_MENU_IDS.length
  const selectedMenus = form.isAdmin ? totalMenus : form.menus.length

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-5 w-5 text-primary" />
            Conexion Supabase
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={handleTestConnection}>Probar</Button>
            <Button variant="outline" onClick={handleLoadData}>Cargar datos</Button>
          </div>
          <div className="rounded-lg border p-3 text-sm">
            <div className="flex items-center gap-2">
              {connectionStatus === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
              <span>{statusMessage || (isConnected ? "Conectado" : "Sin probar")}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-5 w-5 text-primary" />
              Usuarios y Permisos
              {editingId ? (
                <Badge variant="secondary" className="ml-2 gap-1">
                  <EditIcon className="h-3 w-3" />
                  Editando
                </Badge>
              ) : (
                <Badge variant="outline" className="ml-2 gap-1">
                  <Plus className="h-3 w-3" />
                  Nuevo usuario
                </Badge>
              )}
            </CardTitle>
            {editingId && editingUser ? (
              <div className="text-xs text-muted-foreground">
                Editando: <b>{editingUser.nombre || editingUser.username}</b>
                {" · "}
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  cancelar y volver a "nuevo usuario"
                </button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Nombre</Label>
                <Input
                  className="mt-2"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  disabled={isSaving}
                  autoComplete="name"
                />
              </div>
              <div>
                <Label>Correo</Label>
                <Input
                  type="email"
                  className="mt-2"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  disabled={isSaving}
                  autoComplete="off"
                />
              </div>
              <div>
                <Label>
                  Clave{editingId ? " (déjala vacía para no cambiarla)" : ""}
                </Label>
                <Input
                  type="password"
                  className="mt-2"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editingId ? "—" : `mínimo ${MIN_PASSWORD} caracteres`}
                  disabled={isSaving}
                  autoComplete="new-password"
                />
              </div>
              <div className="flex items-end gap-6 pb-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.activo}
                    onCheckedChange={(v) => setForm({ ...form, activo: !!v })}
                    disabled={isSaving}
                  />
                  Activo
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.isAdmin}
                    onCheckedChange={(v) => {
                      const becomingAdmin = !!v
                      if (becomingAdmin) {
                        // Marcando Admin: snapshot de los permisos no-admin actuales
                        // SOLO si el form ahora mismo NO era admin. Si ya era admin
                        // (entrar a editar a un admin existente), no pisamos el snapshot.
                        if (!form.isAdmin) previousMenusRef.current = [...form.menus]
                        setForm({ ...form, isAdmin: true, menus: [...ALL_MENU_IDS] })
                      } else {
                        // Desmarcando Admin: RESTAURAMOS los permisos previos al
                        // cambio. Si no hay snapshot (era admin guardado como tal),
                        // dejamos sólo Dashboard como mínimo razonable. NUNCA dejar
                        // todos los menús marcados después de quitar admin.
                        const restored = previousMenusRef.current.length
                          ? previousMenusRef.current
                          : (["panel"] as MenuPermission[])
                        setForm({ ...form, isAdmin: false, menus: restored })
                      }
                    }}
                    disabled={isSaving}
                  />
                  Administrador
                </label>
              </div>
            </div>

            {!form.isAdmin ? (
              <div className="space-y-4 rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    Permisos por módulo
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({selectedMenus} de {totalMenus} seleccionados)
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setForm({ ...form, menus: [...ALL_MENU_IDS] })}
                      disabled={isSaving}
                    >
                      Seleccionar todos
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setForm({ ...form, menus: [] })}
                      disabled={isSaving}
                    >
                      Limpiar
                    </Button>
                  </div>
                </div>

                {Object.entries(groupedMenus).map(([section, menus]) => {
                  const allSelected = menus.every((m) => form.menus.includes(m.id))
                  const noneSelected = menus.every((m) => !form.menus.includes(m.id))
                  return (
                    <div key={section} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">{section}</div>
                        <button
                          type="button"
                          className="text-xs text-primary underline-offset-2 hover:underline disabled:opacity-50"
                          disabled={isSaving}
                          onClick={() => {
                            const ids = menus.map((m) => m.id)
                            setForm((prev) => ({
                              ...prev,
                              menus: allSelected
                                ? prev.menus.filter((m) => !ids.includes(m))
                                : Array.from(new Set([...prev.menus, ...ids])),
                            }))
                          }}
                        >
                          {allSelected ? "Desmarcar sección" : noneSelected ? "Marcar sección" : "Marcar toda la sección"}
                        </button>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {menus.map((menu) => (
                          <label
                            key={menu.id}
                            className="flex items-center gap-2 rounded-lg border p-2 text-sm"
                          >
                            <Checkbox
                              checked={form.menus.includes(menu.id)}
                              onCheckedChange={(v) => toggleMenu(menu.id, !!v)}
                              disabled={isSaving}
                            />
                            {menu.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-xl border p-4 text-sm text-muted-foreground">
                El administrador tiene acceso total a todos los menús ({totalMenus}).
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Button onClick={handleSaveUser} disabled={isSaving} className="gap-2">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editingId ? "Actualizar usuario" : "Crear usuario"}
              </Button>
              <Button variant="outline" onClick={resetForm} disabled={isSaving}>
                {editingId ? "Cancelar edición" : "Limpiar"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-5 w-5 text-primary" />
              Usuarios creados
              <Badge variant="outline" className="ml-2">{users.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {usersError ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                No se pudo cargar el listado: {usersError}.{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => void loadUsers()}
                >
                  Reintentar
                </button>
              </div>
            ) : null}

            {!usersLoaded ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando usuarios…
              </div>
            ) : users.length === 0 ? (
              <div className="text-sm text-muted-foreground">No hay usuarios todavía.</div>
            ) : (
              users.map((user) => {
                const isCurrentEdit = editingId === user.id
                const isMe = user.id === currentUser?.id
                return (
                  <div
                    key={user.id}
                    className={`rounded-xl border p-4 transition-colors ${
                      isCurrentEdit ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 font-medium">
                          {user.nombre || "(sin nombre)"}
                          {isMe ? (
                            <Badge variant="outline" className="text-[10px]">tú</Badge>
                          ) : null}
                          {user.isAdmin ? (
                            <Badge className="text-[10px]">Administrador</Badge>
                          ) : null}
                          {!user.activo ? (
                            <Badge variant="destructive" className="text-[10px]">
                              Inactivo
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-sm text-muted-foreground">{user.username}</div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {user.isAdmin
                            ? `${totalMenus} módulos (acceso total)`
                            : `${user.menus.length} de ${totalMenus} módulos asignados`}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => handleEditUser(user)}
                          disabled={isSaving}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          disabled={isMe || deletingId === user.id || isSaving}
                          onClick={() => handleDeleteUser(user)}
                          title={isMe ? "No puedes borrar tu cuenta" : "Eliminar"}
                        >
                          {deletingId === user.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
