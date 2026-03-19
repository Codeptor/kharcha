import { CostChart } from "@/components/cost-chart"
import { DashboardHeader } from "@/components/dashboard-header"
import { getDashboardData } from "@/lib/dashboard/get-dashboard-data"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"

export default async function Page() {
  const data = await getDashboardData()

  return (
    <main
      className="relative min-h-svh overflow-hidden bg-background text-foreground"
      style={{
        backgroundImage:
          "radial-gradient(circle at top left, rgba(244, 114, 182, 0.14), transparent 34%), radial-gradient(circle at top right, rgba(59, 130, 246, 0.12), transparent 28%), linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 20%)",
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_60%)] blur-3xl dark:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_60%)]" />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <DashboardHeader title={env.PUBLIC_SITE_TITLE} lifetimeTotalUsd={data.lifetimeTotalUsd} />
        <CostChart days={data.days} />
      </div>
    </main>
  )
}
