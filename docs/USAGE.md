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
   extensão após substituir os arquivos.

Não mova nem apague a pasta depois de carregá-la. Como a instalação é sem compactação, o
navegador lê os arquivos diretamente desse local.

## Verificar uma lista

1. Abra o popup do Morto-Vivo.
2. Cole as URLs, uma por linha. A entrada aceita URLs defangadas comuns, como `hxxps` e
   `[.]`; URLs inválidas e duplicadas são ignoradas.
3. Clique em **Verificar Status**. A página de resultados abre em uma nova aba e atualiza
   o progresso à medida que a fila termina.

Cada lote aceita até 200 URLs únicas e válidas. Se a entrada exceder o limite, a extensão
avisa e processa somente as primeiras 200.

A revisão da entrada informa quantas URLs únicas são válidas, inválidas ou duplicadas; as
inválidas também mostram os critérios básicos aceitos.

## Filtros de resultados

Na página de resultados, o filtro **Tipo: todos** pode limitar a lista por categoria de
endereço. **Mensageria** reúne links reconhecidos de Telegram (`t.me`/`telegram.me`),
convites e links de conversa do WhatsApp (`chat.whatsapp.com`, `wa.me` e
`api.whatsapp.com`) e Discord (`discord.gg`/`discord.com`). O filtro só altera quais
resultados são exibidos; não muda a análise nem o status dos links.

## Interpretar os resultados

- **Vivo**: há sinais suficientes de conteúdo público correspondente à URL.
- **Zumbi**: o endereço responde, mas apresenta sinais como erro temporário do servidor,
  página estacionada ou anúncio pausado.
- **Morto**: há evidência explícita de remoção, como NXDOMAIN ou certos códigos/páginas de
  remoção reconhecidos pela plataforma.
- **Indeterminado**: a evidência não permite concluir com segurança. Isso inclui desafios
  anti-bot, login obrigatório, timeouts e respostas ambíguas.

O resultado é uma avaliação técnica do que estava acessível no momento da consulta. Por
exemplo, “indisponível publicamente” não prova necessariamente que uma conta ou publicação
foi excluída: privacidade, região, login e mudanças da plataforma também podem afetar a
resposta. Confirme manualmente resultados importantes antes de tomar decisões.

### TikTok e Facebook

O TikTok pode apresentar uma página de espera ou verificação anti-bot. Ela não é considerada
prova de que um perfil esteja ativo ou removido. Para vídeos, o Morto-Vivo usa o estado
público renderizado na página apenas quando o identificador corresponde ao vídeo da URL;
uma indicação explícita de remoção é tratada separadamente.

O Facebook pode retornar login, redirecionamentos ou respostas que não provam remoção. O
modo aba pode fornecer conteúdo renderizado adicional. Mesmo assim, resultados ambíguos
permanecem indeterminados.

## Opções

O popup e a página de resultados acompanham automaticamente a preferência de aparência
clara/escura do sistema operacional ou do navegador.

### Modo aba

Ative **Modo aba** quando páginas de plataformas compatíveis precisarem ser lidas pelo
navegador. A extensão abre uma aba em segundo plano e usa a sessão já autenticada do
navegador. Para investigação, prefira um perfil de navegador dedicado. O modo aba não é
usado para domínios desconhecidos nem para LinkedIn. O Facebook Marketplace tem um fluxo
especial de leitura em aba.

### Notificação de conclusão

Ative **Notificação do navegador ao concluir o monitoramento** para receber uma notificação
do navegador além do resumo mostrado na página de resultados. Ao ativar, a extensão solicita
a permissão opcional e envia uma notificação de teste. Se não aparecer, confira as
permissões de notificação do navegador e as configurações de notificações/Não Perturbe do
sistema operacional.

O resumo da página aparece ao terminar um lote não cancelado, mesmo que as notificações do
navegador estejam desativadas. Lotes cancelados e a ação **Refazer** de um único registro
não enviam notificação de conclusão.

### Feedback sonoro

Os botões e controles com semântica de botão emitem um som curto ao serem acionados. A
notificação de conclusão usa o comportamento sonoro padrão do navegador; o navegador ou o
sistema operacional pode silenciá-lo.

## Ações na página de resultados

- **Cancelar análise**: interrompe o início de novas URLs; as que ainda não começaram são
  marcadas como canceladas. Resultados cancelados não atualizam o histórico de status.
- **Refazer**: executa novamente a verificação de um registro.
- **Reverificar indeterminados**: cria um novo lote com os resultados indeterminados.
- **Detalhes**: exibe sinais capturados, motivo, dados de fallback e tempos da análise.
- Clique no cartão para copiar o endereço original; **Copiar URL** oferece a mesma ação em
  um botão acessível por teclado.
- Clique no cabeçalho de uma categoria para expandir/recolher os resultados; o botão
  **Expandir/Recolher** oferece o mesmo controle por teclado.
- Categorias sem resultados são ocultadas. Em categorias com links, o menu **Ações** reúne
  **Abrir todos** e **Copiar todos**; abrir muitos links solicita confirmação.
- O título da categoria visível tem destaque maior para facilitar a leitura da seção atual.
- Use a caixa **Selecionar** em cada card e **Abrir selecionados** para abrir apenas os
  registros escolhidos. **Limpar seleção** desmarca todos. A seleção é preservada enquanto
  os resultados são atualizados; ao abrir em lote, os cards recebem a mesma marcação verde
  de **ABERTO**. Abrir um link pelo clique do botão do meio do mouse também marca o card.
- **Selecionar visíveis** e **Desmarcar visíveis** afetam apenas os resultados que passam
  pelos filtros atuais; seleções ocultas pelo filtro são preservadas. O resumo informa
  quantos resultados estão visíveis. As ações de seleção aparecem quando há itens
  selecionados; opções secundárias ficam no menu **Mais seleção**.
- Busca, tipo, **Reverificar indeterminados** e o **Refazer** de cada cartão ficam sempre
  visíveis. Exportações e cópia das URLs mortas ficam agrupadas no menu **Ações**. Em cada
  cartão, **Abrir** e **Copiar URL** também continuam disponíveis diretamente; **Detalhes**
  ficam no menu **Mais**.
- Menus fecham automaticamente após escolher uma ação e devolvem o foco ao controle do menu.
- O progresso mostra itens concluídos, em andamento e na fila, além do tempo decorrido e
  de uma estimativa restante após os primeiros resultados.
- **CSV**, **JSON** e **Relatório HTML**: exportam os resultados do lote.
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

### O navegador mostra erros CSP de sites

Mensagens CSP sobre scripts de sites externos indicam que uma página teve um recurso remoto
bloqueado pela política de segurança do navegador. Elas não são, por si só, falhas do
Morto-Vivo. Não permita scripts remotos nem enfraqueça a política de segurança para eliminar
esses avisos.
