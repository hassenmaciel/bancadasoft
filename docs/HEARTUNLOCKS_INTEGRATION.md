# Integração HeartUnlocks

## Arquitetura

O BancadaSoft nunca chama a HeartUnlocks diretamente. O fulfillment persistente chama o gateway privado na VPS; o gateway força IPv4, autentica na API Dhru e cria o pedido. A HeartUnlocks chama a URL pública do gateway, que valida o segredo e encaminha o callback ao endpoint interno do BancadaSoft. O token do fornecedor existe somente na VPS.

O produto `unlocktool-6h` é ligado ao `product_uuid` `2194`, com `Quantity: 1`. O custo interno é USD 0,30 e não altera o preço público.

## Variáveis

Na aplicação: `HEARTUNLOCKS_GATEWAY_URL`, `HEARTUNLOCKS_GATEWAY_SECRET` e `BANCADASOFT_INTERNAL_SECRET`.

Na VPS: `HEARTUNLOCKS_API_BASE_URL`, `HEARTUNLOCKS_API_TOKEN`, `HEARTUNLOCKS_GATEWAY_SECRET`, `HEARTUNLOCKS_CALLBACK_SECRET`, `HEARTUNLOCKS_FEEDBACK_BASE_URL`, `BANCADASOFT_CALLBACK_URL` e `BANCADASOFT_INTERNAL_SECRET`.

`HEARTUNLOCKS_FEEDBACK_BASE_URL` é a origem HTTPS pública do próprio gateway. `BANCADASOFT_CALLBACK_URL` é a URL completa de `/api/internal/providers/heartunlocks/callback` na aplicação.

## Operação

Instale e opere o serviço conforme `gateway/heartunlocks/README.md`. Teste `/health` com o segredo do gateway antes de ativar o provider e o vínculo no Admin. Um teste sem compra deve limitar-se a health, autenticação e validação local do payload.

Para um pedido controlado, use uma conta cliente de teste, pagamento sandbox e apenas o produto 2194. Confirme no Admin que há um único ProviderOrder em `PROCESSING`. O callback `success` só entrega após o replay Base64 produzir login e senha válidos. Callback rejeitado ou replay inválido termina em falha para análise, sem entrega.

## Diagnóstico e segurança

- `PROVIDER_RESULT_UNCERTAIN`: não repita a compra cegamente; reconcilie pelo `reference_id` no fornecedor.
- `REPLAY_REQUIRES_ACTION`: examine o estado no Admin; nunca copie o replay para logs.
- Callback duplicado é deduplicado por chave única derivada do conteúdo.
- Desative emergencialmente o provider ou o vínculo no Admin.
- Rotacione tokens primeiro na VPS, reinicie o serviço e valide o health. Depois rotacione os segredos compartilhados de ambos os lados.
- A consulta automática de status permanece desabilitada até que o contrato exato do endpoint seja confirmado. Não invente parâmetros.

## Runbook da VPS Ubuntu

```bash
sudo mkdir -p /opt/bancadasoft-heartunlocks /etc/bancadasoft
sudo cp -R gateway/heartunlocks/* /opt/bancadasoft-heartunlocks/
cd /opt/bancadasoft-heartunlocks
sudo npm install --omit=dev
sudo nano /etc/bancadasoft/heartunlocks.env
sudo chmod 600 /etc/bancadasoft/heartunlocks.env
sudo cp bancadasoft-heartunlocks.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bancadasoft-heartunlocks
sudo systemctl status bancadasoft-heartunlocks
sudo journalctl -u bancadasoft-heartunlocks -n 100 --no-pager
```

Conteúdo de `/etc/bancadasoft/heartunlocks.env`:

```dotenv
PORT=8787
HEARTUNLOCKS_API_BASE_URL=https://api.heartunlocks.com
HEARTUNLOCKS_API_TOKEN=<HEARTUNLOCKS_API_TOKEN>
HEARTUNLOCKS_GATEWAY_SECRET=<GATEWAY_SECRET>
HEARTUNLOCKS_CALLBACK_SECRET=<CALLBACK_SECRET>
HEARTUNLOCKS_FEEDBACK_BASE_URL=https://<HOST_PUBLICO_DO_GATEWAY>
BANCADASOFT_CALLBACK_URL=https://www.bancadasoft.com.br/api/internal/providers/heartunlocks/callback
BANCADASOFT_INTERNAL_SECRET=<BANCADASOFT_INTERNAL_SECRET>
```

O cliente HTTPS usa `family: 4`, garantindo saída IPv4. Publique o gateway por HTTPS. Se ainda não houver proxy, configure Nginx ou Caddy conforme a infraestrutura efetivamente instalada; não exponha a porta 8787 diretamente.

```bash
curl -i -H 'Authorization: Bearer <GATEWAY_SECRET>' http://127.0.0.1:8787/health
curl -i http://127.0.0.1:8787/health
```

O primeiro deve responder `200`; o segundo, `401`. O health não chama a HeartUnlocks e não cria pedidos.

## Runbook da Vercel

Cadastre em Production e faça redeploy:

```text
HEARTUNLOCKS_GATEWAY_URL=https://<HOST_PUBLICO_DO_GATEWAY>
HEARTUNLOCKS_GATEWAY_SECRET=<GATEWAY_SECRET>
BANCADASOFT_INTERNAL_SECRET=<BANCADASOFT_INTERNAL_SECRET>
```

Use Preview somente com gateway isolado. Nunca cadastre `HEARTUNLOCKS_API_TOKEN` na Vercel. Após o deploy, valide o health no Admin antes de habilitar provider e vínculo.
