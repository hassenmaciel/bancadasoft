import type { Metadata } from "next";
import "./globals.css";
import "./catalog.css";
import "./checkout.css";
export const metadata: Metadata = { title: "BancadaSoft | Ferramentas para técnicos", description: "MVP sandbox BancadaSoft" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
