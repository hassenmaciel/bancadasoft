import Link from "next/link";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_WHATSAPP_URL } from "@/lib/support";

export default function PublicFooter() {
  return <>
    <section className="support" id="suporte"><div className="wrap support-inner"><div className="support-brand"><span>⚒</span><div><b>BANCADA<span>SOFT</span></b><small>Mais que uma loja, um parceiro para o técnico.</small></div></div><div className="support-copy"><span>●</span><div><b>Precisando de ajuda?</b><small>Fale com nosso suporte: {SUPPORT_PHONE_DISPLAY}</small></div></div><a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noopener noreferrer">Falar no WhatsApp</a></div></section>
    <footer><div className="wrap footer-grid"><div className="footer-brand"><b>BANCADA<span>SOFT</span></b><small>Ferramentas e serviços para técnicos.</small></div><div><b>Loja</b><Link href="/catalogo">Catálogo</Link><Link href="/meus-pedidos">Meus pedidos</Link></div><div><b>Ajuda</b><Link href="/#como-funciona">Como funciona</Link><a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noopener noreferrer">Central de ajuda</a></div><div><b>Formas de pagamento</b><span className="footer-pix">◆ pix</span></div></div><div className="wrap copyright">© 2026 BancadaSoft. Todos os direitos reservados.<span>Feito para quem faz o mobile acontecer.</span></div></footer>
  </>;
}
