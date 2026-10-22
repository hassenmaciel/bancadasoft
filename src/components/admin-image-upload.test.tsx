import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminImageUpload from "./admin-image-upload";

const base = "JPG, PNG ou WEBP. Máximo de 500 KB. A remoção é concluída ao salvar.";

describe("AdminImageUpload", () => {
  it("sem hint mantém exatamente o texto de ajuda atual", () => {
    const html = renderToStaticMarkup(<AdminImageUpload kind="brands" value="" onChange={() => undefined} />);
    expect(html).toContain(`<small>${base}</small>`);
  });
  it("com hint exibe o texto atual seguido de um espaço e do hint", () => {
    const hint = "Tamanho recomendado: 1600 x 830 px (proporção 1,93:1).";
    const html = renderToStaticMarkup(<AdminImageUpload kind="products" value="" onChange={() => undefined} hint={hint} />);
    expect(html).toContain(`<small>${base} ${hint}</small>`);
  });
});
