import "@workspace/ui/globals.css"
import { ThemeProvider } from "@/components/theme-provider"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="antialiased">
      <body className="min-h-svh" style={{ fontFamily: "var(--font-display)" }}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
