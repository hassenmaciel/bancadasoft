-- Banner comercial rotativo do Hero da Home, administrável pelo painel Admin.
-- Já aplicada manualmente no Supabase (não usar `prisma migrate deploy` para
-- reaplicar; se necessário, marcar como aplicada com `prisma migrate resolve`).

-- CreateTable
CREATE TABLE "HomeBanner" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "linkUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeBanner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomeBanner_active_sortOrder_idx" ON "HomeBanner"("active", "sortOrder");

-- Mesma política das demais tabelas (migration security_rls_lockdown):
-- RLS ligado, sem policies, sem acesso para anon/authenticated via Data API.
ALTER TABLE public."HomeBanner" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."HomeBanner" FROM anon, authenticated;
