# Catálogo HeartUnlocks

O Admin solicita a sincronização ao adapter, que chama o `GET /products` autenticado do gateway. O gateway encaminha somente leitura para `GET /api/reseller/v1/products`, usando IPv4. Nenhum token do fornecedor sai da VPS.

No contrato reseller real, `data.products` é um objeto cuja chave é o ID externo do produto. Cada item pode conter `name`, `price`, `time`, `type`, `cid`, `cids`, `fields`, `status`, `description` e `image_url`; a moeda fica em `data.currency`. Campos variáveis ficam em `ProviderProduct.metadata`; custo e moeda originais ficam nos campos próprios.

Itens novos ficam sem `Product` comercial vinculado e nunca são publicados automaticamente. A sincronização preserva preço de venda, descrição, imagem, categoria, slug e estado editorial do BancadaSoft. Uma falha upstream mantém o snapshot anterior e cria apenas um `AuditLog` sanitizado.
