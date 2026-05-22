import { PublicFormPage } from "@/components/public-form-page"

export const dynamic = "force-dynamic"
export const revalidate = 0

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function Page({ params }: PageProps) {
  const { token } = await params
  return <PublicFormPage token={token} />
}
