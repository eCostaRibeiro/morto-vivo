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

Os testes cobrem classificação e análise, normalização, segurança de rede, leitura em aba,
armazenamento, exportações e feedback sonoro. São testes locais; não validam a resposta ao
vivo de plataformas de terceiros nem substituem um teste manual no Chrome/Vivaldi.

## Estrutura

- `manifest.json`: versão, permissões, popup, ícones e service worker.
- `popup.html` / `popup.js` / `popup.css`: entrada e normalização da lista, opções,
  estilos do popup e abertura do lote.
- `results.html` / `results.js` / `results.css`: estrutura e estilos da tela de resultados;
  `results.js` coordena fila, estado e exportações.
- `lib/resultsView.js`: renderização dos resultados, filtros, seleção e ações da interface.
- `background.js`: criação das notificações por solicitação da interface.
- `lib/analyzer.js`: coordenação de probes, fetch, leitura em aba e classificação.
- `lib/classification.js`: classificação das evidências coletadas.
- `lib/rules.js`: identificação de plataformas e probes específicos.
- `lib/tabs.js`: ciclo de vida da aba temporária e guard de requisições no modo aba.
- `lib/networkSafety.js` / `lib/dns.js`: validação de URLs, destinos e resolução DNS.
- `lib/evidence.js`: enriquecimento de evidências, incluindo favicon.
- `lib/history.js`: preferências e histórico no `chrome.storage.local`.
- `lib/exports.js`: geração de CSV, JSON e relatório HTML.
- `lib/audioFeedback.js`: som curto para controles acionáveis.
- `tests/`: regressões automatizadas em Node.js.

## Fluxo de uma análise

1. O popup normaliza, valida e deduplica as entradas e limita o lote a 200 URLs.
2. A página de resultados executa até seis verificações concorrentes, com limites adicionais
   por plataforma/host.
3. Cada URL passa pela coordenação em `lib/analyzer.js`; evidências adicionais como favicon
   são coletadas separadamente.
4. As evidências são classificadas. Falhas inesperadas ou timeouts produzem resultado
   indeterminado em vez de interromper toda a fila.
5. O histórico é atualizado apenas para verificações que não foram canceladas.
6. Ao terminar um lote não cancelado, a tela mostra um resumo. Se habilitada, a notificação
   é enviada ao service worker por `chrome.runtime.sendMessage`.

As constantes de concorrência, timeout e retry estão em `results.js`; o limite de URLs por
lote está em `popup.js`. Preserve limites por host e a validação de segurança ao modificar
o fluxo.

## Convenções para mudanças

- Mantenha a classificação conservadora: ausência de resposta, anti-bot, login e evidência
  ambígua não devem ser promovidos a “Morto” nem a “Vivo”.
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
