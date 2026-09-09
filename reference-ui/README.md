# BancadaSoft — interface demonstrativa

Interface responsiva baseada no layout de referência aprovado e no Inventário Mestre BancadaSoft.

## Abrir

Abra `index.html` diretamente em um navegador ou sirva a pasta com qualquer servidor estático. Não há dependências, etapa de instalação ou build.

## Inclui

- Cabeçalho com busca como ação principal, categorias e carrinho
- Hero, catálogo, PIX, benefícios, jornada de compra, suporte e rodapé conforme a direção visual
- Catálogo filtrável e carrinho lateral com total calculado
- Checkout PIX somente demonstrativo, sem cobranças reais
- Layout responsivo para desktop e celular

O catálogo de exemplo está isolado em `app.js` para permitir a avaliação visual. Antes de produção, substitua `loadCatalogue()` por `GET /products`; somente itens revisados e publicados pelo backend podem aparecer, com preço definido pela regra comercial. A criação de PIX, os webhooks, a fila de fulfillment e o adaptador HeartUnlocks devem permanecer apenas no servidor.
