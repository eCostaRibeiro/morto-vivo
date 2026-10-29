// Padrões de detecção que não são específicos de nenhuma plataforma.
// Tudo aqui é DADO que você pode ajustar conforme as plataformas mudam.
// Os padrões rodam sobre texto normalizado (minúsculo, sem acentos) — escreva-os assim.
// A ordem dentro das listas pode afetar qual motivo aparece primeiro; valide mudanças com exemplos vivos e removidos.

// Página de derrubada / suspensão (evidência de takedown). Status: morto.
export const TAKEDOWN = [
  { re: /(this|the) (web)?site (has been|is|was) (suspended|disabled|taken down|blocked|removed|deactivated)/, reason: 'Site suspenso/derrubado pelo provedor' },
  { re: /(account|conta|site|website|dominio|domain) (has been |foi |esta |is )?(suspens[oa]|suspended)/, reason: 'Conta/site/domínio suspenso' },
  { re: /(este|esse) (site|dominio|website|endereco) (foi|esta) (suspens|desativad|bloquead|removid|derrubad)\w*/, reason: 'Site/domínio suspenso ou bloqueado' },
  { re: /domain (has been )?(seized|blocked|suspended)|dominio (foi )?(apreendido|bloqueado|suspenso)|clienthold|serverhold/, reason: 'Domínio apreendido/bloqueado' },
  { re: /bloquead[oa] (por|a pedido|conforme|em cumprimento|por determinacao)|em cumprimento (a|de) (ordem|decisao|determinacao) judicial/, reason: 'Bloqueado por ordem/decisão' },
  { re: /(has|have) been reported (for|as) (abuse|phishing|fraud)|abuse (report|complaint)|violat\w+ (our |the )?(terms|acceptable use|policy).{0,60}(suspend|remov|disabl)/, reason: 'Removido por denúncia de abuso' },
  { re: /sinkhole(d)?|this domain has been (taken over|redirected) (by|to)/, reason: 'Domínio em sinkhole' },
  { re: /(este )?(conteudo|site|pagina) (foi|esta) (removid|indisponivel).{0,40}(denuncia|violacao|abuso|decisao)/, reason: 'Conteúdo removido por denúncia/violação' },
];

// Página estacionada / padrão do servidor / manutenção. Status: zumbi.
export const PARKED = [
  { re: /(?:hosted for free, courtesy of godaddy|hospedado gratuitamente, cortesia da godaddy).{0,160}(?:acquire this domain|buy this domain|adquira este dominio)/, reason: 'Domínio estacionado pela GoDaddy sem conteúdo ativo', status: 'morto', onlyIfSmall: true },
  { re: /(this )?domain( name)? (is|may be) for sale|buy this domain|dominio (esta )?a venda|comprar este dominio|make an offer (on|for) this domain/, reason: 'Domínio à venda/estacionado' },
  { re: /domain (is )?parked|parked (free|domain)|this domain is registered|dominio estacionado/, reason: 'Domínio estacionado' },
  { re: /welcome to nginx|apache2? (ubuntu |debian )?default page|test page for the apache|iis windows server|it works!|default web site page|index of \//, reason: 'Página padrão do servidor (sem conteúdo)' },
  { re: /(bandwidth|resource) limit (is )?(exceeded|reached)|limite de (banda|recursos) (excedido|atingido)/, reason: 'Cota do hosting excedida' },
  { re: /site (em construcao|em manutencao|indisponivel)|under construction|coming soon|em breve|down for maintenance|site is currently unavailable/, reason: 'Em construção/manutenção/indisponível', onlyIfSmall: true },
];

export const DOMAIN_SALE = /\b(?:this )?domain(?: name)? (?:is|may be) for sale\b|\bbuy this domain\b|\bacquire this domain\b|\bpurchase this domain\b|\bmake an offer (?:on|for) this domain\b|\bdomain is parked\b|\bdominio (?:esta )?a venda\b|\bcomprar este dominio\b|\badquira este dominio\b|\bcompre este dominio\b|\bdominio estacionado\b/;
export const DOMAIN_SALE_CTA = /\bbuy this domain\b|\bacquire this domain\b|\bpurchase this domain\b|\bmake an offer (?:on|for) this domain\b|\bcomprar este dominio\b|\badquira este dominio\b|\bcompre este dominio\b/;
// Keep parking services only; registrars and marketplaces alone are not proof of parking.
export const DOMAIN_PARKING_PROVIDERS = /\b(?:sedoparking|sedo\.com|afternic|hugedomains|parkingcrew|bodis(?:\.com)?)\b/i;

// Soft 404: HTTP 200 mas o conteúdo diz que não existe.
export const SOFT404_TITLE = /^(error )?40[34]\b|\bnot found\b|nao (foi )?encontrad[oa]|(page|pagina) (does not|doesn't|nao) exist|erro 40[34]|error 40[34]|conteudo indisponivel|nada encontrado/;
export const SOFT404_BODY = /\b40[34]\b|not found|nao (foi )?encontrad[oa]|nao existe|does not exist|doesn't exist|link (quebrado|expirado)|(esta )?pagina nao esta disponivel/;

// Anti-bot / captcha: NÃO é prova de morte nem de vida.
export const CHALLENGE = [
  /just a moment/, /checking your browser/, /attention required/, /verify you are (a )?human/,
  /verifique que voce e humano|confirme que voce nao e um robo/, /px-captcha|_incapsula_|incapsula incident/,
  /access denied.{0,80}(reference|errors\.edgesuite)|request blocked/, /enable javascript and cookies to continue/,
  /unusual traffic|trafego incomum/, /are you a robot|voce e um robo/,
];

export const LOGIN_WALL = /(faca login|entre|log in|sign in|login) (para|to) (continuar|ver|see|continue|view)|log in or sign up|entrar ou cadastrar|you must (log|sign) in|login required|inicie sessao/;
