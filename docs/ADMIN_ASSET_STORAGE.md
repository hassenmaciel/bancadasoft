# Assets do catálogo no Supabase Storage

O Admin envia imagens exclusivamente pelo servidor. A chave service_role nunca é enviada ao navegador.

Variáveis necessárias:

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_STORAGE_BUCKET (opcional; padrão catalog-assets)

No primeiro upload autorizado, a aplicação reutiliza o bucket configurado ou cria um bucket público restrito a JPG, PNG e WEBP, com limite de 500 KB. A API administrativa exige sessão ADMIN, gera nomes UUID e só remove arquivos pertencentes ao bucket configurado.

Cadastre as variáveis nos ambientes apropriados e faça novo deploy. A variável server-side aceita tanto a chave `service_role` legada quanto a nova Secret API Key (`sb_secret_...`); nunca use uma chave pública nesse lugar.
