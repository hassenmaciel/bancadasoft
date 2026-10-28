"use client";
import { Analytics } from "@vercel/analytics/next";
import { analyticsBeforeSend } from "@/lib/analytics-url";

// Wrapper client: o layout raiz é Server Component e não pode passar a função
// beforeSend como prop para o <Analytics /> (que é "use client").
export default function VercelAnalytics() {
  return <Analytics beforeSend={analyticsBeforeSend} />;
}
