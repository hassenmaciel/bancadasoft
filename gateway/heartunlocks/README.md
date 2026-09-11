# HeartUnlocks Gateway

Serviço Node.js sem dependências externas para executar na VPS com o IPv4 autorizado. Ele mantém o token HeartUnlocks fora da Vercel, recebe pedidos internos autenticados e encaminha callbacks ao BancadaSoft.

## Variáveis

`PORT`, `HEARTUNLOCKS_API_BASE_URL`, `HEARTUNLOCKS_API_TOKEN`, `HEARTUNLOCKS_GATEWAY_SECRET`, `HEARTUNLOCKS_CALLBACK_SECRET`, `BANCADASOFT_CALLBACK_URL` e `BANCADASOFT_INTERNAL_SECRET`. Nunca grave valores no repositório.

## Instalação e teste

Copie esta pasta para `/opt/bancadasoft-heartunlocks`, crie `/etc/bancadasoft/heartunlocks.env` com permissão `600` e execute `npm start`. O health autenticado é `GET /health` com `Authorization: Bearer ...`. Para manter o processo, instale o arquivo `.service`, rode `systemctl daemon-reload` e `systemctl enable --now bancadasoft-heartunlocks`.

Atualize substituindo os arquivos e executando `systemctl restart bancadasoft-heartunlocks`. Consulte somente logs sanitizados com `journalctl -u bancadasoft-heartunlocks`; token e conteúdo de `replay` nunca são registrados.
