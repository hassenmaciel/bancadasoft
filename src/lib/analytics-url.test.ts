import { describe, expect, it } from "vitest";
import { analyticsBeforeSend, sanitizeAnalyticsUrl } from "./analytics-url";

const site = "https://bancadasoft.example";

describe("sanitizeAnalyticsUrl", () => {
  it("descarta qualquer URL sob /admin", () => {
    for (const path of ["/admin", "/admin/", "/admin/usuarios", "/admin/pedidos/abc?x=1", "/ADMIN/usuarios", "/%61dmin/usuarios"])
      expect(sanitizeAnalyticsUrl(`${site}${path}`)).toBeNull();
    expect(sanitizeAnalyticsUrl("/admin/usuarios")).toBeNull();
  });

  it("não confunde caminhos que só começam com 'admin'", () => {
    expect(sanitizeAnalyticsUrl(`${site}/administracao`)).toBe(`${site}/administracao`);
  });

  it("normaliza o id de pedido em /acompanhar e /meus-pedidos", () => {
    expect(sanitizeAnalyticsUrl(`${site}/acompanhar/cmabc123xyz`)).toBe(`${site}/acompanhar/[id]`);
    expect(sanitizeAnalyticsUrl(`${site}/meus-pedidos/cmabc123xyz`)).toBe(`${site}/meus-pedidos/[id]`);
    expect(sanitizeAnalyticsUrl("/meus-pedidos/cmabc123xyz")).toBe("/meus-pedidos/[id]");
    expect(sanitizeAnalyticsUrl(`${site}/meus-pedidos`)).toBe(`${site}/meus-pedidos`);
  });

  it("remove query string e fragmento", () => {
    expect(sanitizeAnalyticsUrl(`${site}/redefinir-senha#token=segredo`)).toBe(`${site}/redefinir-senha`);
    expect(sanitizeAnalyticsUrl(`${site}/produto/unlocktool?variant=v1&token=abc#topo`)).toBe(`${site}/produto/unlocktool`);
    expect(sanitizeAnalyticsUrl(`${site}/acompanhar/cmabc123xyz?token=abc`)).toBe(`${site}/acompanhar/[id]`);
    expect(sanitizeAnalyticsUrl("/catalogo?q=frp#lista")).toBe("/catalogo");
  });

  it("mantém URL comum inalterada", () => {
    for (const url of [`${site}/`, `${site}/produto/unlocktool-6h`, `${site}/catalogo`, "/cadastro"])
      expect(sanitizeAnalyticsUrl(url)).toBe(url);
  });
});

describe("analyticsBeforeSend", () => {
  it("devolve o evento com a URL limpa, preservando os demais campos", () => {
    expect(analyticsBeforeSend({ type: "pageview", url: `${site}/acompanhar/abc?token=x` })).toEqual({
      type: "pageview",
      url: `${site}/acompanhar/[id]`,
    });
  });

  it("descarta (null) eventos do admin", () => {
    expect(analyticsBeforeSend({ type: "pageview", url: `${site}/admin/usuarios` })).toBeNull();
  });
});
