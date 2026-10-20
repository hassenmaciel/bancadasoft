# HeartUnlocks Gateway

## Catalogo somente leitura

`GET /products` exige o mesmo header `Authorization: Bearer ...` usado pelo health. A rota encaminha exclusivamente `GET /api/reseller/v1/products`, forca saida IPv4, limita a resposta e nunca expoe o token do provider.

Serviço Node.js sem dependências externas para executar na VPS com o IPv4 autorizado. Ele mantém o token HeartUnlocks fora da Vercel, recebe pedidos internos autenticados e encaminha callbacks ao BancadaSoft.

## Reenvio de callbacks

Se o aviso da HeartUnlocks não puder ser entregue ao app (erro de rede ou resposta não 2xx de `BANCADASOFT_CALLBACK_URL`), o gateway continua respondendo `500` à HeartUnlocks, como antes, e guarda o aviso em memória para tentar de novo após 1, 2, 4 e 8 minutos (5 tentativas no total). Cada tentativa é logada com `referenceId`, número da tentativa e resultado; ao esgotar, há um log `callback retry exhausted`.

- Um aviso pendente por `reference_id`: se o mesmo `reference_id` chegar de novo durante o reenvio, ele não é reenviado na hora nem gera outra fila; o conteúdo mais recente substitui o anterior na próxima tentativa.
- Limite de 500 avisos pendentes. Acima disso, o novo aviso é descartado com log `CRITICAL callback retry queue full`.
- **Os pendentes vivem só na memória do processo: um restart (deploy, `systemctl restart`, queda da VPS) perde todos.** Antes de reiniciar, confira nos logs se há reenvios em andamento.

## Variáveis

`PORT`, `HEARTUNLOCKS_API_BASE_URL`, `HEARTUNLOCKS_API_TOKEN`, `HEARTUNLOCKS_GATEWAY_SECRET`, `HEARTUNLOCKS_CALLBACK_SECRET`, `BANCADASOFT_CALLBACK_URL` e `BANCADASOFT_INTERNAL_SECRET`. Nunca grave valores no repositório.

## Instalação e teste

Copie esta pasta para `/opt/bancadasoft-heartunlocks`, crie `/etc/bancadasoft/heartunlocks.env` com permissão `600` e execute `npm start`. O health autenticado é `GET /health` com `Authorization: Bearer ...`. Para manter o processo, instale o arquivo `.service`, rode `systemctl daemon-reload` e `systemctl enable --now bancadasoft-heartunlocks`.

Atualize substituindo os arquivos e executando `systemctl restart bancadasoft-heartunlocks`. Consulte somente logs sanitizados com `journalctl -u bancadasoft-heartunlocks`; token e conteúdo de `replay` nunca são registrados.
