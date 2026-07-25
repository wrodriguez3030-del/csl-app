/**
 * Webhook de PAGOS de AgendaPro — variante con token en la RUTA (URL limpia):
 *   POST /api/integrations/agendapro/payments/<AGENDAPRO_WEBHOOK_SECRET>
 *
 * Pensada para pegar en AgendaPro sin query-string (coincide con el patrón de
 * webhooks existentes). Comparte la lógica con la variante ?token= en
 * lib/server/agendapro-webhook.ts.
 */

import { NextResponse } from "next/server"
import { agendaProWebhookHealth, handleAgendaProPaymentWebhook } from "@/lib/server/agendapro-webhook"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return handleAgendaProPaymentWebhook(request, token)
}

export async function GET() {
  return NextResponse.json(agendaProWebhookHealth())
}
