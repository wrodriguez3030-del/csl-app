"use client"

import { useState } from "react"
import { Shield, User, KeyRound } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { login, type SystemUser } from "@/lib/security"

interface LoginPageProps {
  onLogin: (user: SystemUser) => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

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
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md border-[color:var(--brand-border)] bg-white shadow-[0_24px_60px_rgba(15,45,68,.08)]">
        <CardHeader className="space-y-3 pb-3">
          <div className="mx-auto flex h-16 w-32 items-center justify-center rounded-xl bg-white p-2 ring-1 ring-[color:var(--brand-border)]">
            <img src="/cibao-spa-laser-logo.jpeg" alt="Cibao Spa Laser" className="h-full w-full object-contain" />
          </div>
          <CardTitle className="flex items-center justify-center gap-2 text-xl text-[color:var(--brand-primary-dark)]">
            <Shield className="h-5 w-5 text-[color:var(--brand-primary)]" />
            Acceso al Sistema
          </CardTitle>
          <p className="text-center text-sm text-muted-foreground">
            Entra con tu correo y clave registrados.
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <Label>Correo</Label>
              <div className="relative mt-2">
                <User className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input type="email" className="pl-9" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Clave</Label>
              <div className="relative mt-2">
                <KeyRound className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input type="password" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>

            {error ? <div className="text-sm text-red-500">{error}</div> : null}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
