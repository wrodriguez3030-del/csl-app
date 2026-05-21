"use client"

import { useEffect, useState } from "react"
import { getSessionUser, type SystemUser } from "@/lib/security"

/**
 * Devuelve el usuario en sesión y se mantiene sincronizado con cambios en
 * `localStorage` (otra pestaña) y con el evento `csl-auth-changed`
 * (login/logout en esta misma pestaña).
 *
 * Reemplaza la duplicación de listeners en sidebar/header.
 */
export function useSessionUser() {
  const [user, setUser] = useState<SystemUser | null>(null)

  useEffect(() => {
    const sync = () => setUser(getSessionUser())
    sync()
    window.addEventListener("storage", sync)
    window.addEventListener("csl-auth-changed", sync as EventListener)
    return () => {
      window.removeEventListener("storage", sync)
      window.removeEventListener("csl-auth-changed", sync as EventListener)
    }
  }, [])

  return user
}
