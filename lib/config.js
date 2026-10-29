// Central de timeouts, intervalos e limites de concorrência usados na análise de URLs.
// Mover um valor para cá não deve alterar nenhum comportamento existente — é apenas o
// único lugar para ajustá-lo no futuro, em vez de caçar o mesmo número em vários arquivos.

/* Resolução DNS e evidências auxiliares */
export const DOH_TIMEOUT_MS = 6000; // dns.js: tempo máximo por consulta a um provedor DoH
export const FAVICON_TIMEOUT_MS = 6000; // evidence.js: download do favicon

/* Requisições feitas por checkUrl (analyzer.js) */
export const FETCH_PAGE_TIMEOUT_MS = 15000; // timeout padrão de fetchPage quando opts.timeoutMs não é informado
export const GET_JSON_TIMEOUT_MS = 8000; // timeout das chamadas de API das probes (oEmbed, Shopee, Discord, Bluesky...)
export const CUSTOM_RULE_SETTLE_MS = 7000; // espera extra em aba quando há regra personalizada ativa

/* Espera por evidência renderizada no modo aba (valores passados por analyzer.js ao abrir a aba) */
export const TIKTOK_PROFILE_EVIDENCE_WAIT_MS = 45000; // perfil TikTok: tempo máx. aguardando cabeçalho/desafio
export const TIKTOK_CONTENT_SETTLE_MS = 8000; // vídeo/foto do TikTok fora de perfil
export const ADVERTISEMENT_SETTLE_MS = 8000; // anúncios (Meta Ad Library e afins)
export const FACEBOOK_MARKETPLACE_TAB_TIMEOUT_MS = 12000;
export const FACEBOOK_MARKETPLACE_COMMAND_TIMEOUT_MS = 15000;
export const FACEBOOK_MARKETPLACE_LISTING_WAIT_WITH_CUSTOM_RULE_MS = 6500;
export const FACEBOOK_MARKETPLACE_LISTING_WAIT_MS = 4000;

/* Fila de serialização do TikTok (lib/tiktokQueue.js) */
export const TIKTOK_QUEUE_INTERVAL_MS = 2000; // intervalo mínimo entre consultas ao TikTok no lote

/* Orquestração do lote (results.js / lib/batchRunner.js) */
export const GLOBAL_CONCURRENCY = 6; // nº máx. de URLs processadas em paralelo, independente do host
export const CHECK_TIMEOUT_MS = 50000; // 1ª tentativa de checkUrl para URLs genéricas
export const TIKTOK_CHECK_TIMEOUT_MS = 75000; // 1ª tentativa de checkUrl para TikTok (fila + modo aba são mais lentos)
export const RETRY_TIMEOUT_MS = 25000; // 2ª tentativa após timeout (não usada para TikTok/FB Marketplace)
export const ENRICH_TIMEOUT_MS = 15000; // prazo para o enriquecimento (favicon) após a classificação
