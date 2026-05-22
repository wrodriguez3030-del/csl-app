"use client"

import { useState } from "react"
import { Shield, User, KeyRound } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { login, type SystemUser } from "@/lib/security"
import { BUSINESS_FALLBACK, SUPPORTED_BUSINESS_SLUGS } from "@/lib/business"
import { BusinessLogo } from "@/components/business-logo"
import type { BusinessSlug } from "@/lib/types"

interface LoginPageProps {
  onLogin: (user: SystemUser) => void
}

// El selector de negocio en login es SOLO visual: ayuda al usuario a
// reconocer el sistema multi-negocio antes de meter credenciales. La
// seguridad real la determina `business_id` en csl_user_profiles tras
// el login (ver lib/security.ts → login() y lib/server/business-context.ts).
export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [selectedSlug, setSelectedSlug] = useState<BusinessSlug>("csl")

  const selectedBusiness = BUSINESS_FALLBACK[selectedSlug]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      const result = await login(username, password)
      if (!result.ok || !result.user) {
        setError(result.error || "No se pudo iniciar sesión")
        return
      }
      onLogin(result.user)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ ["--brand-active" as string]: selectedBusiness.primaryColor }}
    >
      <Card
        className="w-full max-w-md border bg-white shadow-[0_24px_60px_rgba(15,45,68,.08)] transition-colors"
        style={{ borderColor: `${selectedBusiness.primaryColor}33` }}
      >
        <CardHeader className="space-y-4 pb-3">
          <div
            className="mx-auto flex h-20 w-40 items-center justify-center rounded-xl bg-white p-3 ring-1 transition-all"
            style={{ boxShadow: `0 0 0 1px ${selectedBusiness.primaryColor}33` }}
          >
            <BusinessLogo
              business={selectedBusiness}
              className="h-full w-full object-contain"
              alt={selectedBusiness.name}
            />
          </div>

          <CardTitle
            className="flex items-center justify-center gap-2 text-xl"
            style={{ color: selectedBusiness.primaryColor }}
          >
            <Shield className="h-5 w-5" />
            Acceso {selectedBusiness.name}
          </CardTitle>

          <p className="text-center text-sm text-muted-foreground">
            Entra con tu correo y clave registrados.
          </p>

          {/* Selector visual de negocio. La elección NO afecta la sesión:
              el negocio efectivo lo decide csl_user_profiles.business_id. */}
          <div
            role="radiogroup"
            aria-label="Seleccionar negocio"
            className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1"
          >
            {SUPPORTED_BUSINESS_SLUGS.map((slug) => {
              const biz = BUSINESS_FALLBACK[slug]
              const isActive = slug === selectedSlug
              return (
                <button
                  key={slug}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setSelectedSlug(slug)}
                  className={[
                    "flex items-center gap-3 rounded-lg border bg-white px-3 py-2 text-left",
                    "transition-all hover:shadow-sm focus:outline-none focus:ring-2",
                    isActive ? "shadow-sm" : "opacity-70 hover:opacity-100",
                  ].join(" ")}
                  style={{
                    borderColor: isActive ? biz.primaryColor : "#e2e8f0",
                    boxShadow: isActive
                      ? `inset 0 0 0 1px ${biz.primaryColor}`
                      : undefined,
                  }}
                >
                  <div className="flex h-8 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-white">
                    <BusinessLogo
                      business={biz}
                      className="h-full w-full object-contain"
                      alt={biz.name}
                    />
                  </div>
                  <span
                    className="text-xs font-semibold leading-tight"
                    style={{ color: isActive ? biz.primaryColor : "#475569" }}
                  >
                    {biz.name}
                  </span>
                </button>
              )
            })}
          </div>
        </CardHeader>

        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <Label>Correo</Label>
              <div className="relative mt-2">
                <User className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  className="pl-9"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <Label>Clave</Label>
              <div className="relative mt-2">
                <KeyRound className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="password"
                  className="pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </div>

            {error ? <div className="text-sm text-red-500">{error}</div> : null}

            <Button
              type="submit"
              className="w-full text-white transition-colors"
              disabled={isLoading}
              style={{
                backgroundColor: selectedBusiness.primaryColor,
              }}
            >
              {isLoading ? "Entrando..." : `Entrar a ${selectedBusiness.shortName}`}
            </Button>

            <p className="text-center text-[11px] text-muted-foreground pt-1">
              La selección es solo visual — el sistema te llevará al negocio asignado a tu perfil.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
