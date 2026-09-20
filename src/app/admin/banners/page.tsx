import { prisma } from "@/lib/prisma";
import BannerManager from "./banner-manager";

export default async function BannersPage() {
  const rows = await prisma.homeBanner.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return (
    <>
      <header className="admin-heading">
        <div>
          <small>MARKETING</small>
          <h1>Banners da Home</h1>
          <p>Banner rotativo exibido no Hero da página inicial. Até 4 banners ativos ao mesmo tempo.</p>
        </div>
      </header>
      <BannerManager rows={rows.map((row) => ({ id: row.id, title: row.title, imageUrl: row.imageUrl, linkUrl: row.linkUrl, sortOrder: row.sortOrder, active: row.active }))} />
    </>
  );
}
