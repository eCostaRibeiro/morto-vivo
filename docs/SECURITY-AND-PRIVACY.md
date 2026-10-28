# Segurança e privacidade

## Permissões da extensão

O manifesto solicita:

- `storage`: salvar configurações e histórico local de verificações.
- `scripting`: ler o DOM em uma aba do navegador no modo aba.
- `debugger`: instalar o guard de rede usado pela leitura em aba. O Chromium não permite
  declarar essa permissão como opcional, então ela é solicitada na instalação da extensão,
  mesmo que o modo aba não seja usado.
- Acesso HTTP/HTTPS a qualquer host: necessário para analisar URLs arbitrárias.
- `notifications` como permissão opcional: solicitada somente quando a pessoa ativa a opção
  de notificação.

O navegador pode apresentar avisos de permissões amplas, especialmente para acesso a sites
e depuração. Esses acessos existem para os fluxos de análise; não habilite o modo aba em um
perfil com sessão sensível que não seja apropriado para a atividade.

## Tráfego de rede

Para verificar uma URL, a extensão faz requisições ao destino fornecido e pode consultar
registros DNS via DNS-over-HTTPS (Cloudflare com fallback transparente para Google Public
DNS) antes de conectar. Isso significa que o nome do host é enviado aos serviços DNS usados
pela extensão, além das requisições feitas ao próprio site. Redirecionamentos HTTP e
`meta refresh` são avaliados e validados antes de seguir para o próximo destino.

Em sites genéricos, uma falha de transporte ou timeout em HTTPS pode levar a uma única
tentativa HTTP sem cookies. O fallback não é usado quando HTTPS responde, quando a validação
de segurança bloqueia o destino ou para plataformas reconhecidas; redirecionamentos opacos
podem acionar a tentativa, mas seu destino não é seguido sem validação. Resultados obtidos
por HTTP são identificados e têm a confiança limitada a média (uma confiança baixa não é
elevada), pois a conexão não é criptografada.

O modo aba abre páginas de plataformas reconhecidas e, quando explicitamente ativado, pode
abrir também um site genérico cujo redirecionamento seja opaco ao `fetch`. A página usa a
sessão autenticada do navegador, se houver, e pode executar código. Um interceptor valida
navegações principais e chamadas XHR/Fetch para bloquear destinos privados/reservados.
Recursos estáticos como imagens, estilos e scripts não são interceptados individualmente.
Downloads iniciados pela aba analisada são negados durante a leitura, e novas abas abertas
por ela são fechadas. Esses controles são de melhor esforço e não substituem um perfil
isolado do navegador.

A verificação do TikTok é serializada e pausada para o restante do lote quando detecta HTTP
429 ou um desafio explícito de verificação; um resultado indeterminado genérico não pausa a
fila. O modo aba reutiliza uma aba em segundo plano quando necessário;
não usa navegação anônima nem tenta contornar controles, limites, cookies ou identidade da
plataforma.

A proteção é uma mitigação de melhor esforço, não uma garantia contra DNS rebinding: o
navegador pode resolver o host novamente ao conectar. Não use a extensão como substituto
de um proxy de saída ou de controles de rede corporativos.

## Dados locais

- Configurações e histórico são gravados em `chrome.storage.local`.
- Uma lista TXT importada é validada no popup e armazenada localmente sob um identificador
  aleatório para chegar à página de resultados; ela permanece disponível para recarga da
  página por até 24 horas e, após esse prazo, é removida na próxima importação ou abertura
  de lote. O conteúdo não é enviado a um servidor externo.
- CSVs de regras são lidos localmente e validados antes de preencher o rascunho; a
  exportação também é local e só inclui as regras salvas. Arquivos importados/exportados
  permanecem sob controle de quem usa a extensão. A exportação escapa campos e neutraliza
  prefixos que planilhas poderiam interpretar como fórmulas.
- O histórico guarda status anterior, status mais recente, motivos e horários por URL; é
  limitado a 3.000 URLs e até 20 mudanças por URL.
- Classificações manuais também são guardadas localmente por URL, separadas do histórico
  automático, limitadas a 3.000 entradas e removidas apenas ao substituí-las manualmente
  nos cards; **Limpar histórico** não as apaga.
- O favicon é mantido em memória na sessão de resultados para evitar downloads repetidos;
  não é persistido no histórico.
- Capturas de tela não são feitas nem armazenadas.
- A extensão não inclui integração com servidor próprio nem envia resultados a um serviço
  remoto de Morto-Vivo.
- Exportações são iniciadas pelo usuário e podem conter URLs, títulos e evidências. Trate
  os arquivos exportados de acordo com as regras de dados da sua organização.

## JavaScript remoto e conteúdo de terceiros

O código da extensão é empacotado localmente. A extensão não deve carregar scripts remotos.
Páginas analisadas podem conter conteúdo de terceiros e dados não confiáveis; conteúdo
capturado é exibido como texto e exportações tratam caracteres especiais relevantes.

Avisos CSP que mencionam scripts como Osano ou Scribd podem ser gerados por páginas
visitadas ou pelo contexto do navegador. A extensão não precisa permitir esses scripts.
Não enfraqueça a CSP nem adicione hosts remotos para silenciar avisos.

## Limites e uso seguro

- Um resultado indeterminado não significa que o link esteja morto.
- Respostas de login, anti-bot e bloqueio não são tratadas como prova de status.
- O modo aba usa cookies e a sessão existente do navegador; prefira um perfil dedicado para
  análise.
- A extensão não burla CAPTCHA, autenticação, anti-bot ou controles de acesso.
- Considere as regras das plataformas consultadas e as políticas internas antes de analisar
  grandes lotes.
