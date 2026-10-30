# Guia de desenvolvimento

## Requisitos

- Node.js 18 ou superior para a suíte automatizada.
- Google Chrome ou Vivaldi para testar a extensão atual na interface.

O projeto não tem dependências npm de execução ou desenvolvimento. Os scripts usam módulos
nativos do Node.js.

## Verificação

Na raiz do projeto, execute:

```powershell
npm run check
```

Esse comando executa `scripts/check-syntax.mjs` e depois `node --test`. Para rodar somente
os testes:

```powershell
npm test
```

Os testes cobrem classificação e análise, sondas de plataformas, DNS, normalização,
segurança de rede, leitura em aba, orquestração do lote (concorrência, retry e fila do
TikTok em `lib/batchRunner.js`), armazenamento, exportações e feedback sonoro. São testes
locais; não validam a resposta ao vivo de plataformas de terceiros nem substituem um teste
manual no Chrome/Vivaldi.

## Estrutura

- `manifest.json`: versão, permissões, popup, ícones e service worker.
- `popup.html` / `popup.js` / `popup.css`: entrada colada, importação TXT, contador,
  opções, estilos do popup e abertura do lote.
- `history.html` / `history.js` / `history.css`: consulta, filtro, limpeza e reexecução das
  100 últimas análises locais.
- `rules.html` / `rules.js` / `rules.css`: edição, validação e importação/exportação CSV
  das regras personalizadas.
- `results.html` / `results.js` / `results.css`: estrutura e estilos responsivos da tela de
  resultados; `results.js` liga o estado da página e os elementos da UI ao motor de
  orquestração em `lib/batchRunner.js` (progresso, render, histórico, exportações e retorno
  ao topo continuam aqui).
- `lib/batchRunner.js`: motor de orquestração do lote — concorrência global, semáforos por
  host/plataforma, integração com a fila do TikTok e retry por timeout (`runBatch`,
  `checkUrlWithRetry`). Não depende do DOM; `results.js` injeta progresso/render/histórico
  via hooks, o que permite testar esse motor com `node --test` (`tests/batchRunner.test.mjs`).
- `lib/config.js`: único lugar com os timeouts, intervalos e limites de concorrência usados
  na análise (fetch, probes, modo aba, fila do TikTok, orquestração do lote). Ajuste um
  valor aqui em vez de procurar o número em cada arquivo.
- `lib/resultsView.js`: renderização dos resultados em blocos de até 50 por categoria,
  filtros, seleção e ações da interface.
- `background.js`: criação das notificações por solicitação da interface.
- `lib/analyzer.js`: coordenação de probes, fetch, leitura em aba e classificação.
- `lib/classification.js`: classificação pura das evidências coletadas, incluindo regras
  contextuais para Facebook/Meta e estados públicos de perfis/conteúdos TikTok.
- `lib/rules.js`: agrega o catálogo de plataformas e os padrões genéricos de detecção, e
  identifica a plataforma de uma URL (`detectPlatform`). O conteúdo em si — regexes, catálogo
  por site, sondas de API (oEmbed de YouTube/TikTok, X, Bluesky, Discord e Shopee) — vive em
  `lib/platforms/*.js`, um arquivo por grupo de plataforma (`marketplaces.js`, `social.js`,
  `messaging.js`, mais `genericPatterns.js` e `helpers.js`); mexa lá quando um site mudar o
  texto de erro. `lib/classification.js` também valida o estado público de vídeos e
  publicações de fotos do TikTok pelo ID e pelo destino canônico.
- `lib/tiktokQueue.js`: serializa as verificações do TikTok, aplica intervalo entre URLs e
  pausa a fila da plataforma após HTTP 429 ou desafio explícito, sem interromper outros hosts.
- `lib/tabs.js`: ciclo de vida da aba temporária e guard de requisições no modo aba. Perfis
  TikTok aguardam o DOM por até 45 segundos, mas retornam antes ao reconhecer cabeçalho de
  perfil, desafio ou mensagem explícita de conta não encontrada.
- `lib/networkSafety.js` / `lib/dns.js`: validação de URLs, destinos e resolução DNS via
  DoH (Cloudflare com fallback transparente para Google Public DNS).
- `lib/evidence.js`: enriquecimento de evidências, incluindo favicon.
- `lib/history.js` / `lib/customRules.js`: preferências, histórico, validação das regras
  personalizadas e conversão CSV no `chrome.storage.local`.
- `lib/queryHistory.js`: persistência local e serializada das últimas 100 listas analisadas
  e de suas favoritas.
- `lib/urlList.js` / `lib/importedBatch.js`: parsing e deduplicação de listas, e transferência
  local de lotes TXT, preservados para atualização da página por até 24 horas.
  As operações que atualizam o índice compartilhado são serializadas com Web Locks para
  evitar perda de entradas entre popups e páginas de resultados simultâneos.
- `lib/exports.js`: geração de CSV, JSON e relatório HTML.
- `lib/audioFeedback.js`: som curto para controles acionáveis.
- `tests/`: regressões automatizadas em Node.js.

## Fluxo de uma análise

1. O popup normaliza, valida e deduplica as entradas coladas (até 200 URLs) ou importadas
   de TXT (até 500 URLs, arquivo máximo de 1 MB); listas importadas são passadas à página
   por armazenamento local, sem codificá-las na URL, e podem ser recuperadas após atualizar
   a página de resultados por até 24 horas.
2. A página de resultados executa até seis verificações concorrentes, com limites adicionais
   por plataforma/host.
3. Cada URL passa pela coordenação em `lib/analyzer.js`; perfis TikTok com Modo aba ativo
   seguem diretamente para a aba reutilizada. A prontidão reconhece cabeçalhos genéricos de
   navegação em português e mensagens de conta não encontrada no DOM, inclusive quando há
   texto adicional ao redor. O classificador não deve confundir o texto de bio com esse aviso
   quando existe um cabeçalho real de perfil. Evidências adicionais como favicon são
   coletadas separadamente. Um redirecionamento JavaScript só é seguido quando o HTML
   é um shell pequeno sem texto visível e o destino é um caminho da mesma origem; um
   redirecionamento por `meta refresh` HTTP(S) também é seguido. Todos os destinos passam
   novamente pela validação de segurança da rede. Para sites genéricos, falhas de
   transporte ou timeout em HTTPS podem acionar uma única tentativa HTTP alternativa,
   também validada; o resultado fica identificado e a confiança é limitada a média, sem
   aumentar uma confiança baixa já existente. Respostas HTTPS
   válidas e plataformas reconhecidas não usam esse fallback. Um redirecionamento opaco
   pode motivar a mesma tentativa HTTP, mas o destino oculto nunca é seguido. Se DNS aponta
   para endereço público e a conexão/TLS falha sem resposta HTTP, mantenha Indeterminado com
   baixa confiança e tag `rede`; esse erro também pode representar bloqueio de rede local.
   Timeouts e bloqueios de segurança continuam indeterminados.
4. As evidências são classificadas. Falhas inesperadas ou timeouts produzem resultado
   indeterminado em vez de interromper toda a fila.
5. O histórico é atualizado apenas para verificações que não foram canceladas.
6. Ao terminar um lote não cancelado, a tela mostra um resumo. Se habilitada, a notificação
   é enviada ao service worker por `chrome.runtime.sendMessage`.

As constantes de concorrência, timeout e retry estão em `lib/config.js`, consumidas por
`lib/batchRunner.js`; os limites de entrada colada e TXT estão em `popup.js` e
`lib/urlList.js`. Preserve limites por host e a validação de segurança ao modificar o fluxo. O CSV de regras usa `status;frase`, com BOM UTF-8,
escaping de campos e proteção contra fórmulas de planilha.

## Convenções para mudanças

- Mantenha a classificação conservadora: ausência de resposta, anti-bot, login e evidência
  ambígua não devem ser promovidos a “Morto” nem a “Vivo”.
- Landers de domínio à venda exigem uma chamada explícita para compra/oferta com sinal de
  provedor conhecido de parking ou uma declaração explícita de que o domínio está estacionado
  junto a um provedor conhecido. Menções informativas e o caminho `/lander`, sem essas
  evidências, não comprovam estacionamento. Registradores e marketplaces, como Namecheap e
  Dan.com, não contam como provedores de parking; sinalize estacionamento com a tag `parked`,
  não com `takedown`, e use confiança média para páginas curtas de venda.
- A detecção de erro Cloudflare deve usar o status HTTP ou evidência específica em uma
  resposta curta no título/início do texto; menções de rodapé ou artigos explicativos não
  são evidência de falha. Uma resposta HTTP 200 também precisa da assinatura da página de
  erro (por exemplo, `Ray ID`). Quando HTTP 530 acompanha o código 1016 no corpo, prefira
  exibir o erro de DNS da origem; HTTP 520 deve manter a identificação/tag Cloudflare mesmo
  sem um corpo reconhecível. O código 1020 representa bloqueio de acesso e só deve ser
  classificado como indeterminado com HTTP 403.
- Regras personalizadas são frases literais com limites de palavra, limitadas a 1.000
  caracteres e identificadas no resultado; normalizam espaços e convertem links Markdown
  para o texto visível. A busca cobre o título e até 50.000 caracteres do texto capturado.
  As regras não devem sobrepor CAPTCHA, barreira de login correspondente, status HTTP
  explícito nem evidência definitiva da plataforma. São avaliadas após sinais de remoção,
  soft-404 e páginas estacionadas, antes do fallback genérico de plataforma.
- Preserve os casos Meta separados por tipo de recurso: conteúdo de perfil do Facebook
  indisponível/restrito não prova remoção; a Biblioteca de Anúncios só é classificada quando
  o estado corresponde ao ID consultado (ativo = Vivo, inativo/pausado/encerrado = Zumbi,
  aviso explícito de ausência na biblioteca = Morto com confiança média). Para TikTok,
  mantenha testes da frase “Não foi possível localizar esta conta” tanto no cabeçalho quanto
  no corpo, junto de cabeçalho genérico de navegação e texto de bio como controles contra
  falso positivo.
- Classificações manuais são uma sobreposição local de apresentação por URL, mantida
  separada das evidências automáticas. Aplique a mesma regra às ações individuais e em
  lote; exports devem incluir os dois valores. Uma classificação manual como Morto não
  pode adicionar a tag de takedown nem alterar o histórico automático. Se status manual e
  automático divergirem, sinalize os dois no card e não exporte takedown como ativo para
  evitar contradição com o status exibido.
- Faça alterações de classificação acompanhadas de casos de regressão em `tests/`.
- Propague erros de armazenamento e APIs do navegador para avisos explícitos; evite falhas
  silenciosas.
- Não carregue JavaScript remoto na extensão. Scripts e estilos da interface devem ser
  empacotados localmente.
- Preserve a política de rede e as validações de redirecionamento; consulte
  [Segurança e privacidade](SECURITY-AND-PRIVACY.md).
- Atualize a documentação diretamente relacionada às mudanças.
- Ao alterar permissões, documente o motivo e prefira permissões opcionais quando apropriado.

## Teste manual no navegador

1. Carregue a pasta sem compactação em `chrome://extensions` ou `vivaldi://extensions`.
2. Após mudanças, recarregue a extensão e abra um popup/página de resultados novos.
3. Teste um pequeno lote conhecido, incluindo URL válida e inválida, cancelamento, exportação
   e opções afetadas pela mudança.
4. Para modo aba, use somente URLs conhecidas e um perfil de navegador dedicado.
5. Para notificações, habilite a opção, confirme o aviso de teste e conclua um lote sem
   cancelá-lo.
6. Faça uma verificação de teclado (Tab, Shift+Tab, Enter e Espaço), foco visível,
   nomes dos controles na árvore acessível, anúncios de progresso e contraste do texto.
   Confirme também que zoom e preferência por redução de movimento não escondem conteúdo.

Testes contra plataformas externas podem variar conforme login, região, cookies, desafios
anti-bot, mudanças de HTML e limitação de requisições.

## Compatibilidade com Firefox

A extensão atual suporta Google Chrome e Vivaldi; Firefox ainda não é um alvo suportado e
não deve ser tratado como compatível apenas por compartilhar APIs WebExtensions. Uma futura
versão para Firefox deve usar um build próprio e validar os fluxos no navegador real antes
de ser anunciada como suportada.

### Estratégia recomendada

1. Reutilizar a lógica independente de navegador — normalização, classificação, regras,
   análise e exportação — mantendo uma única fonte de código quando possível.
2. Gerar manifestos separados por navegador, a partir de uma configuração compartilhada ou
   de uma etapa de empacotamento. O manifesto atual não deve ser carregado no Firefox sem
   adaptação: o Firefox não implementa `background.service_worker` da mesma forma que o
   Chrome. Consulte a documentação MDN sobre
   [background scripts e service workers](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).
3. Isolar diferenças entre `chrome.*` e `browser.*` atrás de uma camada pequena de APIs. O
   código atual usa callbacks de Chromium e `runtime.lastError`; diferenças de Promise,
   callbacks e nomes de APIs precisam ser tratadas e testadas deliberadamente. Consulte
   [incompatibilidades entre Chrome e Firefox](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities).
4. Manter inicialmente o modo aba indisponível no build Firefox. Hoje ele depende de
   `chrome.debugger` e do protocolo CDP para interceptar requisições e bloquear destinos
   privados. Não desativar esse guard nem habilitar uma alternativa até que a implementação
   Firefox tenha política equivalente, testes de redirecionamento e revisão de segurança.
5. Validar separadamente storage, scripting, notificações, abertura de abas e permissões em
   Firefox. A API `scripting.executeScript` existe no Firefox moderno, mas isso não torna
   automaticamente compatíveis o manifesto, o background ou o modo aba.
6. Só então preparar um pacote Firefox e seguir o processo de assinatura/revisão do
   Firefox Add-ons (AMO).

### Critérios mínimos antes de declarar suporte

- O pacote Firefox instala sem erros e o popup, a análise HTTP, o histórico e as exportações
  funcionam.
- Notificações respeitam a concessão de permissão e têm cobertura manual no Firefox.
- O modo aba fica claramente desativado até haver guard de rede Firefox revisado e testado;
  resultados que precisem dele devem permanecer indeterminados.
- `npm run check` continua passando, acrescido de testes para a camada de compatibilidade e
  uma matriz de teste manual no Firefox.
