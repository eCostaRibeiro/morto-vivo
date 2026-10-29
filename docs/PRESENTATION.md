---
marp: true
theme: default
paginate: true
size: 16:9
title: Morto-Vivo — apresentação técnica
description: Arquitetura, recursos, segurança e limites da extensão Morto-Vivo.
---

<!-- _class: lead -->
<!-- LAYOUT: capa; título centralizado, subtítulo abaixo e ícone/logotipo no canto. -->
<!-- VISUAL: fundo escuro, acentos verde-limão e violeta; usar um ícone de link + zumbi. -->

# Morto-Vivo
## Análise técnica de URLs, anúncios e perfis

**Extensão para Chrome e Vivaldi · versão 2.56**

<!-- NOTAS: Apresentar como ferramenta de triagem baseada em evidências, não como veredito automático. -->

---

<!-- LAYOUT: uma frase de impacto no topo e três blocos horizontais. -->
<!-- VISUAL: representar uma lista grande de links entrando em uma triagem local. -->

# O problema que resolvemos

Investigar listas de URLs manualmente é lento e difícil de repetir.

| Entrada | Análise | Resultado |
|---|---|---|
| URLs, perfis e anúncios | Evidências de rede, plataforma e navegador | Status, motivo e confiança |

- Prioriza **evidência explícita** em vez de inferências frágeis.
- Mantém visível quando uma conclusão não é possível.
- Ajuda a priorizar revisão humana; não substitui investigação.

<!-- NOTAS: Destacar a diferença entre automatizar a triagem e automatizar uma decisão final sobre uma conta ou domínio. -->

---

<!-- LAYOUT: quatro cartões em grade 2×2; abaixo, uma faixa com o escopo do veredito. -->
<!-- VISUAL: cada status com cor e símbolo próprios; não comunicar estado apenas por cor. -->

# As quatro categorias são estados de evidência

| Categoria | Evidência que a sustenta | O que não significa |
|---|---|---|
| 🟢 **Vivo** | Conteúdo público ou estado ativo compatível com a URL consultada | Que o conteúdo é legítimo ou seguro |
| 🟠 **Zumbi** | Há resposta, mas o recurso está bloqueado, com erro temporário, padrão ou estacionamento | Que o recurso foi removido |
| ⚫ **Morto** | Evidência de inexistência, remoção, takedown ou indisponibilidade específica | Que todo o domínio ou a conta do operador deixou de existir |
| ⚪ **Indeterminado** | Evidência ambígua, insuficiente, protegida por login/anti-bot ou afetada pela rede | Que o recurso está ativo ou removido |

**Escopo:** “Morto” descreve a URL e o recurso observado. Um produto esgotado, por exemplo, está indisponível para compra; isso não prova que o anúncio foi removido.

<!-- NOTAS: O status responde “o que as evidências dizem sobre este recurso?”, não “quem controla o recurso?” ou “há fraude?”. -->

---

<!-- LAYOUT: três colunas alinhadas: decisão, força da evidência e contexto. Rodapé com um exemplo concreto. -->
<!-- VISUAL: separar visualmente o status da confiança e das tags; usar chips, não uma escala única. -->

# Status, confiança e tags são dimensões diferentes

- **Status** (`vivo`, `zumbi`, `morto`, `indeterminado`): síntese da interpretação.
- **Confiança** (`alta`, `média`, `baixa`): força da evidência para aquela regra; não é probabilidade calibrada.
- **Motivo**: explicação legível da regra/evidência que determinou o status.
- **Tags**: contexto transversal, como `takedown`, `anti-bot`, `parked`, `dns`, `redirect-externo` ou `out-of-stock`.
- **Metadados**: plataforma, tipo de recurso, origem (`fetch`, `api` ou `tab`), HTTP e URL final quando disponíveis.

> Exemplo: `morto` + confiança alta + `out-of-stock` = produto esgotado na Shopee; não equivale a anúncio removido.

<!-- NOTAS: Confiança descreve a sustentação da regra aplicada, não a probabilidade de fraude nem a confiabilidade geral da plataforma. -->

---

<!-- LAYOUT: fluxo horizontal em cinco etapas, com limites destacados em uma faixa inferior. -->
<!-- VISUAL: colar URLs → validar → analisar → revisar → exportar. -->

# Da lista ao resultado

1. **Inserir:** colar URLs ou importar arquivo TXT.
2. **Validar:** normalizar, rejeitar entradas inválidas e remover duplicatas.
3. **Analisar:** aplicar probes, fetch e, quando habilitado, leitura no navegador.
4. **Revisar:** filtrar, abrir evidências e aplicar classificação manual.
5. **Compartilhar:** exportar CSV, JSON ou relatório HTML.

**Limites de entrada:** até 200 URLs coladas; até 500 URLs via TXT (máximo de 1 MB).

<!-- NOTAS: Arquivos importados e resultados são processados localmente pela extensão. -->

---

<!-- LAYOUT: diagrama de camadas ocupando a metade esquerda; fronteiras e responsabilidades à direita. -->
<!-- VISUAL: cores distintas para interface, orquestração, adaptadores e persistência; setas representam dados. -->

# Arquitetura: da interface à regra de decisão

```text
popup.js ──> results.html / results.js ──> runChecks (workers + filas)
                                                │
                                        lib/analyzer.js
                                      /          |          \
                             lib/rules.js   fetchPage   lib/tabs.js
                                 │              │             │
                         probes de API   networkSafety   DOM renderizado
                                      \          |          /
                                      lib/classification.js
                                                │
                          resultsView · history · exports · evidence

background.js ──> notificações (mensagens da extensão)
```

- **Interface:** `popup.js` valida a entrada e abre a tela de resultados; `resultsView.js` renderiza e encaminha ações.
- **Orquestração:** `results.js` controla cancelamento, estado do lote, concorrência, fila TikTok, histórico e enriquecimento.
- **Análise:** `analyzer.js` escolhe probe, HTTP ou modo aba e reúne o registro da URL.
- **Política:** `rules.js` mantém padrões/plataformas; `classification.js` é uma função pura que interpreta evidências.
- **Adaptadores:** `networkSafety.js`/`dns.js` protegem acesso de rede; `tabs.js` lê páginas renderizadas.
- **Saída:** `history.js`, `exports.js` e `evidence.js` persistem, exportam e enriquecem resultados.

<!-- NOTAS: A extensão é Manifest V3. O service worker em background.js atende notificações; a análise do lote é orquestrada pela página de resultados. Não há servidor próprio nem etapa de build. -->

---

<!-- LAYOUT: linha do tempo de uma URL, com bifurcação entre probe, HTTP e navegador; classificador no final. -->
<!-- VISUAL: representar cada adapter como fonte de evidência e destacar a regra “não conclusivo → indeterminado”. -->

# `checkUrl`: decisão por evidências, não por um único código

1. **Identificação:** `detectPlatform` determina plataforma e tipo de recurso pela URL.
2. **Probe opcional:** API pública/oEmbed pode resolver certos recursos antes da página HTML.
3. **Leitura de rede:** `fetchPage` usa GET sem cookies; redirects são manuais, validados salto a salto e limitados. Fallback HTTP genérico reduz a confiança.
4. **Fallback de navegador:** aplicado conforme plataforma/opções ou quando uma evidência fetch não basta; TikTok perfil com Modo aba ativo segue diretamente para a aba.
5. **Interpretação:** `classifyPage` combina HTTP, metadados, texto, DOM, rota, destino final e regras da plataforma.
6. **Registro:** o resultado mantém motivo, confiança, tags, via e metadados disponíveis; coleta de favicon não muda o status.

**Falha de rede, login, anti-bot ou ausência de evidência conclusiva não é prova de remoção.**

<!-- NOTAS: O classificador não faz I/O. Isso permite testar a política separadamente do fetch e da automação do navegador. -->

---

<!-- LAYOUT: dois painéis comparando fetch controlado e leitura no navegador; faixa inferior com limites residuais. -->
<!-- VISUAL: representar validação antes de cada salto HTTP e antes de Document/XHR/Fetch no modo aba. -->

# Adaptadores de aquisição e fronteiras de segurança

### HTTP (`fetchPage` → `networkSafety`)
- `credentials: omit`, `cache: no-store`, timeout e leitura do corpo limitada.
- Redirect manual: valida esquema/hostname e endereços DNS públicos em cada salto; bloqueia ciclos e exceder cinco redirects.
- Cada hostname precisa resolver exclusivamente para endereços públicos; falhas de validação bloqueiam a requisição.

### Navegador (`tabs.js`)
- Lê o DOM renderizado em uma aba real; usa a sessão/cookies existentes do perfil.
- Intercepta `Document`, `XHR` e `Fetch`; destinos privados/reservados são bloqueados pelo guard.
- Abas-filhas são fechadas; negar downloads depende do suporte ao comando do navegador.

**Limites:** recursos estáticos não são interceptados individualmente e a resolução DNS pode mudar entre validação e conexão (DNS rebinding).

<!-- NOTAS: A proteção HTTP e o guard do navegador são camadas de mitigação, não um sandbox nem uma garantia de isolamento de conteúdo malicioso. -->

---

<!-- LAYOUT: cartões de três mecanismos de concorrência e um cartão de interrupção/recuperação. -->
<!-- VISUAL: representar workers paralelos, semáforos por chave e uma fila serial TikTok. -->

# Orquestração do lote e contrato do resultado

### Agendamento em `results.js`
- Pool global de **6 workers**; cada worker processa uma URL e registra tempos de análise/enriquecimento.
- Limites adicionais: **2 por plataforma**, **3 por hostname genérico** e **1 para Facebook Marketplace**.
- TikTok usa fila serial com intervalo entre inícios; HTTP 429 ou 403 com desafio explícito pausa as próximas URLs TikTok do lote.
- Cancelamento usa `AbortController`; timeout protege o lote de uma verificação que não termina.

### Registro por URL
`url`, `host`, `platform`, `kind`, `via`, `httpStatus`, `finalUrl`, `status`, `reason`, `confidence`, `tags`, `checkedAt`, `info` e tempos.

Histórico e classificação manual são mantidos separadamente da evidência automática; CSV/JSON/HTML consomem o mesmo registro-base.

<!-- NOTAS: A fila TikTok serializa especificamente aquela plataforma; não ocupa todos os workers globais. URLs pausadas são marcadas como não consultadas, não como falha de abertura de aba. -->

---

<!-- LAYOUT: tabela principal com a precedência; caixa lateral com exemplos de resultado contextual. -->
<!-- VISUAL: sequência numerada; destacar que regras de plataforma podem preceder respostas HTTP genéricas. -->

# Classificação: precedência e contexto

1. **Sinais fortes de política:** avisos de segurança, HTTP 451 e evidência explícita de takedown.
2. **Intersticiais e limites:** captcha, anti-bot, HTTP 429 e bloqueios reconhecidos não viram “Morto”.
3. **Regras contextuais:** estados especiais da plataforma, como conteúdo restrito no Facebook ou produto esgotado.
4. **HTTP genérico:** 404/410, 403 e 5xx são interpretados conforme recurso e plataforma.
5. **Conteúdo e fallback:** soft-404, parking, regras personalizadas e sinais de vida pública.

| Sinal observado | Resultado típico | Limite da conclusão |
|---|---|---|
| HTTP 403 genérico | Zumbi em site genérico; indeterminado em plataforma | Acesso negado não prova remoção |
| HTTP 404/410 genérico | Morto para a URL | Não declara o domínio inteiro fora do ar |
| DNS NXDOMAIN | Morto para o hostname consultado | Não implica que o proprietário não tenha outros domínios |
| Redirect para outro domínio | Indeterminado | Validar destino não prova legitimidade |

<!-- NOTAS: A ordem é explícita no código, mas não é uma tabela universal de códigos HTTP: regras de plataforma e exceções podem preceder ou especializar o tratamento genérico. -->

---

<!-- LAYOUT: dois painéis: "Perfis" e "Vídeos/publicações"; faixa inferior com proteção anti-bot. -->
<!-- VISUAL: mock de card de perfil e mock de publicação, sem usar capturas reais de terceiros. -->

# TikTok: perfis e publicações

### Perfis
- Com **Modo aba** ativo, perfis `/@usuario` são abertos diretamente em uma aba reutilizada.
- A leitura aguarda evidências renderizadas por até 45 segundos e retorna antes ao encontrar cabeçalho de perfil, desafio ou mensagem explícita de conta não encontrada.
- Sem evidência suficiente no prazo, o perfil permanece indeterminado.
- Frases em bio/legenda não devem ser confundidas com desafio anti-bot.
- Mensagem explícita de conta não encontrada resulta em indisponibilidade com confiança média.

### Vídeos e fotos
- oEmbed/estado público são usados quando disponíveis.
- O ID precisa corresponder ao ID da URL; HTTP 404 isolado não confirma remoção.
- Links curtos podem ser avaliados pelo destino canônico.

**Fila:** verificações serializadas; HTTP 429 ou HTTP 403 com desafio explícito pausa as próximas URLs TikTok do lote.

<!-- NOTAS: A fila pausada evita insistir após um limite real. As URLs restantes são identificadas como não consultadas, não como falha de abertura de aba. -->

---

<!-- LAYOUT: três cartões de plataforma com exemplo de evidência e status resultante. -->
<!-- VISUAL: produto Shopee, perfil Facebook e domínio estacionado como ilustrações genéricas. -->

# Regras específicas de plataforma

### Shopee
Indicação explícita de esgotado pode classificar um produto como **Morto** para compra, com tag `out-of-stock`; não significa remoção definitiva do anúncio.

### Facebook / Meta
Conteúdo indisponível publicamente ou restrito permanece **Indeterminado** sem prova de remoção. A Biblioteca de Anúncios classifica o estado do anúncio pelo ID consultado.

### Domínios estacionados
Sinais fortes de parking/venda são apresentados separadamente de takedown. Menção a um registrador, sozinha, não prova estacionamento.

<!-- NOTAS: Esses exemplos mostram por que há regras específicas e por que a classificação usa contexto. -->

---

<!-- LAYOUT: três colunas: Perfil Facebook, Biblioteca de Anúncios e Marketplace. Rodapé com limites. -->
<!-- VISUAL: dados sintéticos e IDs de exemplo; ilustrar evidência observada, status e confiança. -->

# Meta: cenários de classificação por tipo de recurso

| Recurso e exemplo de entrada | Evidência capturada | Saída típica |
|---|---|---|
| Perfil do Facebook (`facebook.com/profile.php?id=<ID>`) | Mensagem explícita de perfil removido/inexistente | **Morto**, confiança média |
| Perfil do Facebook | Login, restrição ou “conteúdo não está disponível” | **Indeterminado**; privacidade não prova remoção |
| Biblioteca de Anúncios (`facebook.com/ads/library/?id=<ID>`) | Estado Ativo associado ao mesmo ID | **Vivo**, confiança alta |
| Biblioteca de Anúncios | Estado Inativo, Pausado ou Encerrado associado ao mesmo ID | **Zumbi**, confiança alta |
| Biblioteca de Anúncios | Aviso explícito de ausência na biblioteca | **Morto**, confiança média; não é prova de takedown |
| Marketplace (`facebook.com/marketplace/item/<ID>`) | Título, data/contexto, preço e dados do vendedor | **Vivo**, confiança alta |

**Exemplo de leitura do resultado:** HTTP 404 ou uma tela de login no Facebook não prova remoção. Na Biblioteca, estado sem correspondência exata do ID também não é atribuído ao anúncio consultado.

<!-- NOTAS: O código reconhece o Facebook e a rota da Biblioteca de Anúncios da Meta. Não extrapolar essas regras para Instagram; ele usa outras regras de plataforma. -->

---

<!-- LAYOUT: tela esquemática de opções à esquerda e pipeline do guard à direita. -->
<!-- VISUAL: aba em segundo plano; setas para Document/XHR/Fetch; destinos privados bloqueados. -->

# Modo aba: conteúdo renderizado, com limites

- Lê o DOM de páginas JavaScript usando uma aba em segundo plano; TikTok pode reutilizar a mesma aba.
- O guard valida navegações principais e requisições **XHR/Fetch**.
- Destinos privados/reservados são bloqueados antes de permitir essas requisições.
- Abas-filhas são fechadas e downloads são negados quando o comando do navegador está disponível.
- Se a proteção de download não for suportada, a leitura pode continuar sem essa proteção.

**Requer `scripting` e `debugger`.** O Chromium exige a permissão `debugger` na instalação.

<!-- NOTAS: A aba usa a sessão existente do navegador. Recomendar perfil dedicado para análise de URLs suspeitas. -->

---

<!-- LAYOUT: uma coluna com controles e uma coluna com limitações explícitas. -->
<!-- VISUAL: escudo com a legenda "mitigação de melhor esforço", não "garantia". -->

# Segurança e privacidade

### O que é feito
- Fetch sem cookies; dados e histórico armazenados localmente.
- Não há servidor próprio do Morto-Vivo, telemetria nem envio automático de resultados.
- DNS pode ser consultado via Cloudflare DoH, com fallback para Google Public DNS.
- Redirecionamentos HTTP e `meta refresh` são validados antes de seguir.

### O que não é garantido
- DNS rebinding: o navegador pode resolver o host novamente ao conectar.
- Recursos estáticos (imagens, scripts, estilos) não são interceptados individualmente.
- A página aberta pode executar código e usar a sessão autenticada do navegador.
- A extensão não contorna CAPTCHA, login, anti-bot ou limites da plataforma.

<!-- NOTAS: As permissões de acesso a hosts e debugger são amplas; explicar por que existem antes de distribuir a extensão. -->

---

<!-- LAYOUT: mock de card à esquerda e barra de ações/exportação à direita. -->
<!-- VISUAL: mostrar status automático, override manual e histórico lado a lado. -->

# Revisão, histórico e exportação

- Cada resultado inclui motivo, confiança, tags e evidências disponíveis.
- Classificação manual individual ou em lote; a decisão automática fica preservada.
- Histórico local permite comparar verificações anteriores por URL.
- Filtros, seleção, rechecagem e abertura de URLs apoiam a revisão operacional.
- Exportação sob demanda: **CSV**, **JSON** e **relatório HTML**.

**Uso recomendado:** revisar resultados importantes antes de tomar decisões ou encerrar casos.

<!-- NOTAS: Overrides manuais não substituem o registro automático; divergências podem ser consultadas depois. -->

---

<!-- LAYOUT: tabela curta de teste vs. o que valida; aviso em destaque no rodapé. -->
<!-- VISUAL: ícones de teste automatizado, navegador e rede ao vivo. -->

# Validação e operação

| Verificação | O que demonstra |
|---|---|
| `npm run check` | Sintaxe JavaScript e testes automatizados locais |
| Testes simulados | Regressões de classificação, rede, fila, aba e armazenamento |
| Teste no Chrome/Vivaldi | Integração real com permissões, debugger e renderização |
| Teste ao vivo de plataforma | Comportamento externo naquele momento e naquela rede |

O teste local **não** substitui a validação ao vivo; redes, login, região e anti-bot afetam respostas externas.

<!-- NOTAS: Para testar o Modo aba, recarregar a extensão e abrir uma nova página de resultados. Confirmar a versão mostrada na interface. -->

---

<!-- _class: lead -->
<!-- LAYOUT: slide de discussão; pergunta grande central e três tópicos pequenos no rodapé. -->
<!-- VISUAL: roadmap com próximos itens como cartões abertos para priorização. -->

# Próxima conversa: quais features priorizar?

1. **Triagem:** quais evidências devem merecer maior destaque?
2. **Operação:** quais filtros, lotes e exportações faltam?
3. **Governança:** que decisões precisam de revisão ou aprovação humana?

### O princípio que não muda
**Automatizar a coleta; manter explícita a incerteza.**

<!-- NOTAS: Usar este slide para coletar prioridades antes de propor novas regras automáticas. -->
