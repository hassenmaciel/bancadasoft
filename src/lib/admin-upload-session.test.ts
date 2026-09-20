import { describe, expect, it } from "vitest";
import { createUploadSession } from "./admin-upload-session";

const A = "https://x.supabase.co/storage/v1/object/public/b/banners/a.jpg";
const B = "https://x.supabase.co/storage/v1/object/public/b/banners/b.jpg";
const SAVED = "https://x.supabase.co/storage/v1/object/public/b/banners/saved.jpg";

// Mesmo componente para os 3 usos (products, brands, banners): a regra não depende do kind.
describe.each(["products", "brands", "banners"])("upload session (%s)", () => {
  it("upload novo em formulário vazio: nada a descartar", () => {
    const s = createUploadSession();
    s.sync("");
    expect(s.discardTarget("")).toBeNull();
    s.uploaded(A);
    s.sync(A);
    expect(s.discardTarget(A)).toBe(A);
  });

  it("troca de imagem antes de salvar: descarta só o upload pendente", () => {
    const s = createUploadSession();
    s.uploaded(A);
    s.sync(A);
    expect(s.discardTarget(A)).toBe(A);
    s.uploaded(B);
    s.sync(B);
    expect(s.discardTarget(B)).toBe(B);
    expect(s.discardTarget(A)).toBeNull();
  });

  it("upload em outro banner logo após salvar (caso que quebrou): não descarta a imagem salva", () => {
    const s = createUploadSession();
    s.uploaded(A);
    s.sync(A);
    s.sync(""); // salvou: o pai limpou o campo
    expect(s.discardTarget("")).toBeNull();
    s.uploaded(B);
    s.sync(B);
    // Editar de novo o registro que guardou A: A vem do banco e não é mais pendente.
    s.sync(A);
    expect(s.discardTarget(A)).toBeNull();
  });

  it("nunca descarta a URL que veio salva do banco (valor inicial)", () => {
    const s = createUploadSession();
    s.sync(SAVED);
    expect(s.discardTarget(SAVED)).toBeNull();
    s.uploaded(A);
    s.sync(A);
    s.sync(SAVED); // trocou de registro
    expect(s.discardTarget(SAVED)).toBeNull();
  });

  it("clear() esquece o pendente (após remover)", () => {
    const s = createUploadSession();
    s.uploaded(A);
    s.clear();
    expect(s.discardTarget(A)).toBeNull();
  });
});
