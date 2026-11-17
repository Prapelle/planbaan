import type { Metadata, Viewport } from "next";
import { RegisterSW } from "@/components/RegisterSW";
import "./globals.css";

export const metadata: Metadata = {
  title: "PlanBaan แผนบ้าน",
  appleWebApp: { capable: true, title: "PlanBaan", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#2563EB", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
