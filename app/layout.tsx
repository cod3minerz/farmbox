import type { Metadata } from "next";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/unbounded";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hashpix Automation",
  description: "Устройства, сценарии и публикации в одном рабочем пространстве.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
