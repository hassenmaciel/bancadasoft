// Prazo TOTAL (não de inatividade) que o gateway espera a HeartUnlocks.
// O `timeout` do https.request é só idle de socket: reinicia a cada byte e não
// cobre a chamada inteira, então sozinho não garante limite algum.
export const PROVIDER_DEADLINE_MS = 15000;

// Invariante com o app (src/lib/providers/heartunlocks.ts): o app espera o
// gateway por PROVIDER_DEADLINE_MS + esta folga (rede Vercel↔VPS, TLS,
// leitura do body e processamento). O app nunca pode desistir antes do gateway.
export const APP_WAIT_MARGIN_MS = 10000;
