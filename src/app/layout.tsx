import type { Metadata } from "next";
import "./globals.css";
import "./catalog.css";
import "./checkout.css";
import "./guest-delivery.css";
export const metadata: Metadata = { title: "BancadaSoft | Ferramentas para técnicos", description: "Ferramentas, licenças, aluguéis e serviços para assistência técnica mobile.", robots:{index:true,follow:true} };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
