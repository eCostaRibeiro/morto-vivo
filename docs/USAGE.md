# Guia de uso

## Instalar ou atualizar a extensão

O Morto-Vivo é atualmente distribuído como extensão Manifest V3 para Google Chrome e Vivaldi.
**Firefox ainda não é suportado**; a versão atual depende de APIs e de um manifesto
específicos de navegadores Chromium.

1. Extraia a pasta da extensão em um local permanente.
2. Abra a página de extensões do navegador: `chrome://extensions` no Chrome ou
   `vivaldi://extensions` no Vivaldi.
3. Ative **Modo do desenvolvedor**.
4. Para instalar, selecione **Carregar sem compactação** e escolha a pasta que contém
   `manifest.json`. Para atualizar uma cópia já carregada, use o botão **Recarregar** da
   extensão após substituir os arquivos; confirme que a tela de resultados mostra a versão
   **2.56** antes de testar as correções recentes do Modo aba.

Não mova nem apague a pasta depois de carregá-la. Como a instalação é sem compactação, o
navegador lê os arquivos diretamente desse local.

## Verificar uma lista

1. Abra o popup do Morto-Vivo.
2. Cole as URLs, uma por linha. A entrada aceita URLs defangadas comuns, como `hxxps` e
   `[.]`; URLs com espaços internos, inválidas e duplicadas são ignoradas, sem alterar
   silenciosamente o endereço digitado.
3. Clique em **Verificar Status**. A página de resultados abre em uma nova aba e atualiza
   o progresso à medida que a fila termina.

Cada lote aceita até 200 URLs únicas e válidas. Se a entrada exceder o limite, a extensão
avisa e processa somente as primeiras 200. A análise é feita em etapas concorrentes para
evitar abrir uma requisição por endereço simultaneamente.

Para listas maiores, expanda **Importar lista TXT** e escolha um arquivo `.txt` UTF-8 com
um endereço por linha. Após validar o arquivo, o botão **Verificar Status** aparece junto à
prévia da importação. São aceitas até 500 URLs válidas em um arquivo de até 1 MB; endereços
inválidos são ignorados, duplicatas são removidas e a prévia mostra os totais antes de
iniciar. O conteúdo é lido localmente e enviado à página de resultados pelo armazenamento da
extensão, não por um serviço externo. A importação de listas de URLs aceita TXT, não CSV.
O lote pode ser recuperado ao atualizar a página de resultados por até 24 horas; depois
disso, a página informa que a lista expirou e será necessário importá-la novamente.

A contagem abaixo do campo de texto é atualizada enquanto você digita ou cola. Ela mostra
URLs válidas e únicas em relação ao limite, por exemplo `30/200`; acima do limite, informa
que somente as primeiras 200 serão analisadas. A revisão da entrada também informa URLs
inválidas e duplicadas; as inválidas mostram os critérios básicos aceitos.

Na página de resultados, passe o mouse sobre botões, status e indicadores para ver dicas
rápidas. Ao navegar com teclado, use Tab para chegar aos controles e Enter ou Espaço para
acioná-los; os rótulos e descrições principais das opções também ficam visíveis no popup.
O botão de engrenagem no cabeçalho do popup ou da página de resultados abre o gerenciador
de regras de classificação.

## Filtros de resultados

Na página de resultados, o filtro **Tipo: todos** pode limitar a lista por categoria de
endereço. **Mensageria** reúne links reconhecidos de Telegram (`t.me`/`telegram.me`),
convites e links de conversa do WhatsApp (`chat.whatsapp.com`, `wa.me` e
`api.whatsapp.com`) e Discord (`discord.gg`/`discord.com`). O filtro só altera quais
resultados são exibidos; não muda a análise nem o status dos links.

## Interpretar os resultados

- **Vivo**: há sinais suficientes de conteúdo público correspondente à URL.
- **Zumbi**: o endereço responde, mas apresenta sinais como erro temporário do servidor,
  página estacionada ou anúncio pausado. Erros de origem identificados da Cloudflare
  (520, 521, 522, 523, 524, 525, 526, 530 e 1016) também são tratados como falhas
  temporárias, não como prova de takedown; a detecção exige sinais específicos no título/
  início de uma resposta curta ou o código HTTP correspondente. Respostas HTTP 200 precisam
  ainda da assinatura da página de erro da Cloudflare, como `Ray ID`. Se a resposta HTTP
  for 530 e o corpo identificar o código 1016, o motivo exibido é o erro de DNS da origem.
  O bloqueio Cloudflare 1020 só é indicado como indeterminado quando a resposta é HTTP 403,
  pois representa controle de acesso e não confirma que o site esteja fora do ar.
  Uma página curta de estacionamento GoDaddy que informa hospedagem gratuita e oferece
  adquirir o domínio é classificada como **Morto**, pois não apresenta o conteúdo ativo do
  endereço; apenas o texto de copyright da GoDaddy não é suficiente para isso. Quando a
  página inicial usa JavaScript para redirecionar a um caminho relativo da mesma origem, a
  extensão consulta esse caminho sem executar o script e valida novamente o destino antes
  da requisição. Landers curtos de outros provedores também podem ser classificados como
  **Morto** quando combinam uma chamada explícita para comprar/fazer oferta pelo domínio
  com sinais de parking conhecidos (por exemplo Sedo, Afternic, ParkingCrew, Bodis ou
  HugeDomains), ou quando um desses provedores declara explicitamente que o domínio está
  estacionado. Um texto isolado sobre domínio à venda, menção a um provedor ou caminho
  `/lander` não basta; sem uma assinatura clara, o comportamento conservador é mantido.
- **Morto**: há evidência explícita de remoção, como NXDOMAIN ou certos códigos/páginas de
  remoção reconhecidos pela plataforma.
- **Indeterminado**: a evidência não permite concluir com segurança. Isso inclui desafios
  anti-bot, login obrigatório, timeouts e respostas ambíguas. Um aviso de reputação como
  “Suspected Phishing” também fica indeterminado: pode ser um bloqueio intersticial e não
  comprova que o site foi removido ou derrubado. Páginas de bloqueio identificadas como
  provenientes de antivírus, como o Kaspersky, também ficam indeterminadas: o bloqueio pode
  ocorrer no navegador ou na rede local e não comprova que o site esteja indisponível para
  outros usuários. Respostas HTTP 200 com tipo de conteúdo
  não textual são exibidas como arquivo disponível para download; redirecionamentos para
  outro domínio ficam como indeterminados, com aviso para confirmar o destino e confiança
  média.
  Em sites genéricos, se HTTPS falhar por conexão, timeout ou redirecionamento não verificável,
  a extensão pode tentar HTTP uma vez; o resultado sinaliza o uso de HTTP e fica com confiança
  limitada a média, sem aumentar uma confiança baixa já existente. Um resultado HTTP não
  substitui uma resposta HTTPS válida. Se o DNS confirmar endereço público mas a conexão TLS
  falhar sem resposta HTTP, o resultado permanece Indeterminado com baixa confiança e tag de
  falha de rede; isso não prova remoção nem takedown.
  Domínios estacionados ou anunciados para venda recebem a indicação **DOMÍNIO ESTACIONADO**,
  separada de **DERRUBADO / SUSPENSO**; a classificação não confirma takedown.

O resultado é uma avaliação técnica do que estava acessível no momento da consulta. Por
exemplo, “indisponível publicamente” não prova necessariamente que uma conta ou publicação
foi excluída: privacidade, região, login e mudanças da plataforma também podem afetar a
resposta. Confirme manualmente resultados importantes antes de tomar decisões.

### TikTok e Facebook

O TikTok pode apresentar uma página de espera ou verificação anti-bot. Ela não é considerada
prova de que um perfil esteja ativo ou removido. Para vídeos, o Morto-Vivo usa o estado
público renderizado na página apenas quando o identificador corresponde ao vídeo da URL;
uma indicação explícita de remoção é tratada separadamente. Publicações de fotos/carrosséis
também podem ser reconhecidas quando o estado público inclui imagens e o ID corresponde ao
caminho da publicação. Links curtos `vm.tiktok.com`/`vt.tiktok.com` podem usar o oEmbed e,
se redirecionarem, o destino canônico é usado para validar o estado capturado. Respostas de
erro do oEmbed ou HTTP 404 sem evidência explícita de remoção não bastam para concluir que
o conteúdo foi removido; o resultado permanece indeterminado quando não há outros sinais
confiáveis.

Em páginas de perfil lidas no navegador, mensagens explícitas de conta não encontrada (por
exemplo, “Couldn't find this account” ou “Não foi possível localizar esta conta”) são
classificadas como **Morto** com confiança média e tag `account-unavailable`. Isso indica
que o perfil não está disponível naquele endereço, mas não confirma derrubada: o nome pode
ter mudado, estar incorreto ou nunca ter existido. A regra não marca takedown e não se aplica
a URLs de vídeos ou publicações.

As verificações do TikTok são serializadas, com intervalo entre consultas. Se uma resposta
indicar limite HTTP 429 ou um desafio explícito de verificação, o restante das URLs do TikTok
no lote é marcado como indeterminado e não é consultado; sinais genéricos de classificação
indeterminada não pausam a fila. URLs de outras plataformas continuam normalmente.
Quando o **Modo aba** estiver ativo e a leitura em navegador for necessária, as páginas do
TikTok usam uma aba em segundo plano reutilizada durante o lote; a
extensão usa o fluxo de verificação mais conservador. Perfis TikTok são abertos diretamente
no navegador, sem classificação preliminar por fetch, e aguardam evidências renderizadas por
até 45 segundos. A leitura retorna antes ao encontrar um cabeçalho de perfil, desafio explícito
ou mensagem de conta não encontrada, mesmo quando a página inclui navegação/rodapé. O texto
“Não foi possível localizar esta conta” é tratado como evidência mesmo se estiver no cabeçalho
principal; cabeçalhos de navegação como “Para você” não são interpretados como nome de perfil.
Quando existe um cabeçalho real de perfil, frases iguais dentro da bio não são usadas para
declarar a conta indisponível. O limite de 45 segundos é da espera pelo DOM/evidências, não
altera o timeout global da análise. Se o prazo terminar sem evidência suficiente, o resultado
fica indeterminado. Se a leitura da aba falhar, o resultado também fica indeterminado.
Vídeos e outras URLs seguem consultando o fetch/oEmbed antes de usar a aba quando necessário.
Isso reduz aberturas simultâneas, mas não contorna
limites ou verificações da plataforma; a extensão não troca
cookies, IP nem identidade e não ativa navegação anônima.
Se uma URL receber HTTP 429 ou HTTP 403 com desafio explícito, o lote para de consultar
os demais perfis TikTok: eles aparecem como não consultados, e não como falha ao abrir a aba.
Frases de verificação em bios ou legendas de perfis não pausam a fila.

O Facebook pode retornar login, redirecionamentos ou respostas que não provam remoção. O
modo aba pode fornecer conteúdo renderizado adicional. Mesmo assim, resultados ambíguos
permanecem indeterminados: conteúdo indisponível publicamente pode ser privado ou restrito,
sem que isso confirme remoção. Redirecionamentos para outro domínio também ficam
indeterminados até que o destino seja confirmado.

### Shopee

Em páginas de produto da Shopee, a indicação explícita de estoque esgotado — como
“Esgotado” ou “OUT OF STOCK” — é classificada como **Morto** com a tag `out-of-stock`.
Quando o modo aba está ativo, a página renderizada também é verificada mesmo se a API
encontrar o produto, para que um anúncio esgotado não seja marcado como vivo apenas por
continuar cadastrado. Essa classificação indica indisponibilidade para compra, não remoção
definitiva do anúncio.

Links da Biblioteca de Anúncios da Meta (`facebook.com/ads/library/?id=...`) são
reconhecidos como tipo **Anúncio** e classificados pelo status mostrado para o mesmo ID:
**Ativo** fica Vivo e **Inativo**,
pausado ou encerrado fica Zumbi. Se a Meta informar explicitamente que o anúncio não está
na Biblioteca de Anúncios, o resultado fica Morto com confiança média. Isso indica que o
anúncio não está disponível nessa biblioteca; não comprova que tenha sido removido, pois a
própria Meta informa que anúncios sem impressões também podem não aparecer. Telas de login,
bloqueios e resultados sem correspondência exata do ID permanecem Indeterminados.

### YouTube e Bluesky

Para vídeos do YouTube, a extensão usa o oEmbed público como evidência de disponibilidade
ou indisponibilidade do vídeo. A sonda não é usada para validar canais: uma resposta de
erro do oEmbed não prova que um canal foi removido.

Para perfis e publicações do Bluesky, a extensão consulta a API pública. Perfis e posts
encontrados são classificados como vivos; respostas explícitas de inexistência/remoção
podem ser classificadas como mortas. Restrições, bloqueios ou respostas inconclusivas não
são tratados como prova de remoção.

## Opções

O popup e a página de resultados acompanham automaticamente a preferência de aparência
clara/escura do sistema operacional ou do navegador.

### Modo aba

Ative **Modo aba** quando páginas de plataformas compatíveis precisarem ser lidas pelo
navegador ou quando um redirecionamento opaco impedir a leitura por `fetch`. Nesse caso,
a extensão abre uma aba em segundo plano e usa a sessão já autenticada do navegador.
O guard valida navegações e chamadas XHR/Fetch antes de permiti-las; se o guard ou a leitura
falhar, o resultado continua indeterminado. Recursos como imagens, estilos e scripts não
são validados individualmente. A página pode executar código, então prefira um perfil de
navegador dedicado. O Facebook Marketplace tem um fluxo especial de leitura em aba. A
extensão solicita a permissão de depuração na instalação; o Chromium não permite pedi-la
como opcional no momento do uso.
Quando existem regras personalizadas, a leitura em aba aguarda até 7 segundos após o
carregamento (e até 6,5 segundos para anúncios do Marketplace) antes de capturar o texto,
para dar tempo a conteúdo que aparece com atraso. Esse tempo extra só se aplica às páginas
que já são elegíveis para modo aba; a leitura HTTP normal não executa JavaScript.

### Notificação de conclusão

Ative **Notificação do navegador ao concluir o monitoramento** para receber uma notificação
do navegador além do resumo mostrado na página de resultados. Ao ativar, a extensão solicita
a permissão opcional e envia uma notificação de teste. Se não aparecer, confira as
permissões de notificação do navegador e as configurações de notificações/Não Perturbe do
sistema operacional.

O resumo da página aparece ao terminar um lote não cancelado, mesmo que as notificações do
navegador estejam desativadas. Lotes cancelados e a ação **Refazer** de um único registro
não enviam notificação de conclusão.

### Regras de classificação personalizadas

Clique na engrenagem do cabeçalho do popup ou da página de resultados para abrir o
gerenciador de regras. Adicione cada regra escolhendo `vivo`, `zumbi` ou `morto` e
informando uma frase literal. Por exemplo:

```text
morto | anúncio removido
zumbi | manutenção programada
vivo | produto disponível
```

As frases são literais (não são expressões regulares), comparadas sem diferença entre
maiúsculas/minúsculas ou acentos. Quando a frase começa ou termina com letra ou número,
ela precisa estar delimitada por início/fim de texto ou pontuação; por exemplo, `morto`
não casa dentro de `mortorista`. Linhas vazias e iniciadas por `#` são ignoradas. Não há
um limite numérico fixo de regras; cada termo pode ter de 2 a 1.000 caracteres, e a primeira
regra correspondente vence. O editor aceita várias linhas, que são normalizadas como espaços;
links Markdown são comparados pelo texto visível (por exemplo, `[Política](https://exemplo.test)`
corresponde a `Política`). A busca considera o título e até os primeiros 50.000 caracteres do
texto capturado da página, incluindo rodapés em páginas curtas. Prefira um trecho distintivo,
em vez de colar o conteúdo inteiro da página. Use **Adicionar regra** para criar uma regra,
**Remover** para excluí-la e **Salvar regras** para aplicar as alterações. Fechar sem salvar
descarta as alterações desde o último salvamento.

**Exportar CSV** baixa uma cópia das regras salvas (não inclui edições ainda não salvas),
com as colunas `status` e `frase`, para backup ou transferência. O arquivo usa UTF-8 com
BOM, separador `;` e cabeçalho `status;frase`. **Importar CSV** carrega um arquivo
exportado anteriormente. A importação substitui o rascunho que está no editor, mas não
altera as regras ativas até clicar em **Salvar regras**; um arquivo inválido é rejeitado
sem modificar o rascunho. Se houver alterações ainda não salvas, a interface pede
confirmação antes de substituí-las. CSV é usado para regras; listas de URLs são importadas
em TXT.

Uma regra personalizada é aplicada depois de CAPTCHA, códigos HTTP explícitos, sinais de
remoção específicos da plataforma, soft-404 e páginas estacionadas; antes da classificação
genérica de conteúdo público da plataforma. Uma regra correspondente não sobrepõe uma
barreira de login detectada, nem respostas definitivas das sondas de API. Sem uma regra
correspondente, banners de login não impedem por si só a classificação normal de um perfil
público. Resultados influenciados por uma regra recebem a tag **REGRA PERSONALIZADA** e
confiança média; confirme-os manualmente antes de agir.

### Feedback sonoro

Botões, links, menus, caixas de seleção, cabeçalhos de categoria e cartões emitem um som
curto ao serem acionados; filtros de lista emitem o som quando uma opção é alterada.
Campos de texto não emitem som a cada tecla. A notificação de conclusão usa o comportamento
sonoro padrão do navegador; o navegador ou o sistema operacional pode silenciá-lo.

### Animações

Os cartões entram com uma transição breve; a barra acompanha o progresso suavemente; e
menus, avisos, detalhes e categorias usam transições curtas ao abrir ou fechar. A preferência
do sistema por movimento reduzido diminui essas transições para evitar movimento não
essencial.

## Ações na página de resultados

- **Cancelar análise**: interrompe o início de novas URLs; as que ainda não começaram são
  marcadas como canceladas. Resultados cancelados não atualizam o histórico de status.
- **Refazer**: executa novamente a verificação de um registro.
- **Reverificar indeterminados**: cria um novo lote com os resultados indeterminados.
- **Voltar ao topo**: depois de rolar a página, mostra um controle para retornar ao início
  e focar o campo de filtro.
- **Detalhes**: exibe sinais capturados, motivo, dados de fallback e tempos da análise.
- **Mais → Classificação da lista**: move o card para Vivo, Zumbi, Morto ou Indeterminado,
  ou restaura a classificação automática. A escolha manual é salva localmente por URL e
  reaplicada em análises futuras; o card recebe o badge **CLASSIFICAÇÃO MANUAL** e os
  detalhes/exportações preservam também o status e o motivo automáticos. Quando a nova
  classificação automática divergir da manual, o card mostra os dois status. Nesse caso,
  a indicação de takedown não é exportada como ativa junto do status manual; os detalhes
  automáticos continuam disponíveis para comparação. Uma classificação manual como Morto
  não cria, por si só, evidência de takedown.
- Clique no cartão para copiar o endereço original; **Copiar URL** oferece a mesma ação em
  um botão acessível por teclado.
- Clique no cabeçalho de uma categoria para expandir/recolher os resultados; o botão
  **Expandir/Recolher** oferece o mesmo controle por teclado.
- Categorias sem resultados são ocultadas. Em categorias com links, o menu **Ações** reúne
  **Abrir todos** e **Copiar todos**; abrir muitos links solicita confirmação.
- Para manter a página responsiva em listas grandes, cada categoria mostra até 50 cards por
  vez. Use **Mostrar mais** para carregar o próximo bloco ou **Mostrar todos** para expandir
  a categoria inteira. Os filtros continuam considerando todos os resultados, inclusive os
  ainda não exibidos.
- O título da categoria visível tem destaque maior para facilitar a leitura da seção atual.
- Use a caixa **Selecionar** em cada card e **Abrir selecionados** para abrir apenas os
  registros escolhidos. **Limpar seleção** desmarca todos. A seleção é preservada enquanto
  os resultados são atualizados; ao abrir em lote, os cards recebem a mesma marcação verde
  de **ABERTO**. Abrir um link pelo clique do botão do meio do mouse também marca o card.
- **Selecionar visíveis** e **Desmarcar visíveis** afetam apenas os resultados que passam
  pelos filtros atuais; seleções ocultas pelo filtro são preservadas. O resumo informa
  quantos resultados estão visíveis. As ações de seleção aparecem quando há itens
  selecionados; opções secundárias ficam no menu **Mais seleção**. Use **Classificação em
  lote** para mover todos os cards selecionados, inclusive os ocultos pelo filtro, para um
  status manual ou restaurar a classificação automática. Após salvar com sucesso, a seleção
  é limpa; se o salvamento falhar, os cards permanecem selecionados para nova tentativa.
- Busca, tipo, **Reverificar indeterminados** e o **Refazer** de cada cartão ficam sempre
  visíveis. Exportações e cópia das URLs mortas ficam agrupadas no menu **Ações**. Em cada
  cartão, **Abrir** e **Copiar URL** também continuam disponíveis diretamente; **Detalhes**
  ficam no menu **Mais**.
- Menus fecham automaticamente após escolher uma ação e devolvem o foco ao controle do menu.
- O progresso mostra itens concluídos, em andamento e na fila, além do tempo decorrido e
  de uma estimativa restante após os primeiros resultados.
- **CSV**, **JSON** e **Relatório HTML**: exportam os resultados do lote. O CSV também
  inclui tipo de conteúdo da resposta e sinaliza redirecionamentos para outro domínio.
- **Copiar mortos (defang)**: copia as URLs classificadas como mortas em formato defangado.
- Os filtros de texto e tipo alteram a visualização, não as verificações já executadas.

### Teclado e tecnologias assistivas

Os controles podem ser percorridos com **Tab** e **Shift+Tab**; use **Enter** ou **Espaço**
para ativar botões, opções e categorias recolhíveis. Os resultados incluem controles
separados para copiar, abrir e exibir detalhes, e o progresso/avisos são anunciados por
leitores de tela compatíveis. A interface também respeita as preferências do sistema para
redução de movimento e cores de alto contraste.

## Histórico e armazenamento

O histórico local mantém o status anterior por URL para destacar mudanças entre verificações.
Use **Limpar histórico de verificações** no popup para removê-lo. O histórico não é um
agendador: a extensão não monitora URLs automaticamente em segundo plano nem executa
verificações periódicas.

Se a interface mostrar um aviso de armazenamento, a leitura ou gravação no armazenamento da
extensão falhou. A mensagem inclui detalhes para diagnóstico.

## Solução de problemas

### A notificação de teste ou de conclusão não aparece

1. Confirme que **Notificação do navegador ao concluir o monitoramento** está ativada.
2. Desative e ative a opção novamente para repetir a solicitação e o aviso de teste.
3. Confira as permissões da extensão e as configurações do navegador para notificações.
4. Confira se o Windows ou outro sistema operacional não está usando Não Perturbe/Assistência
   de foco.

### Muitos resultados ficam indeterminados

Indeterminado significa que não houve evidência confiável suficiente — não é sinônimo de
link morto. Consulte **Detalhes**, tente **Refazer** ou **Reverificar indeterminados** e
confirme manualmente no site. O modo aba pode ajudar em plataformas compatíveis, mas não
contorna desafios anti-bot ou requisitos de login.
O cabeçalho da categoria mostra os motivos mais frequentes mesmo quando a lista está
recolhida; a versão carregada aparece no topo da página. Confirme a versão antes de
diagnosticar uma diferença entre o código atualizado e a extensão em execução.

### O navegador mostra erros CSP de sites

Mensagens CSP sobre scripts de sites externos indicam que uma página teve um recurso remoto
bloqueado pela política de segurança do navegador. Elas não são, por si só, falhas do
Morto-Vivo. Não permita scripts remotos nem enfraqueça a política de segurança para eliminar
esses avisos.
