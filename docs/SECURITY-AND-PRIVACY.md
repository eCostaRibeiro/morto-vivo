# Segurança e privacidade

## Permissões da extensão

O manifesto solicita:

- `storage`: salvar configurações e histórico local de verificações.
- `scripting`: ler o DOM em uma aba do navegador no modo aba.
- `debugger`: instalar o guard de rede usado pela leitura em aba.
- Acesso HTTP/HTTPS a qualquer host: necessário para analisar URLs arbitrárias.
- `notifications` como permissão opcional: solicitada somente quando a pessoa ativa a opção
  de notificação.

O navegador pode apresentar avisos de permissões amplas, especialmente para acesso a sites
e depuração. Esses acessos existem para os fluxos de análise; não habilite o modo aba em um
perfil com sessão sensível que não seja apropriado para a atividade.

## Tráfego de rede

Para verificar uma URL, a extensão faz requisições ao destino fornecido e pode consultar
registros DNS via DNS-over-HTTPS do Cloudflare antes de conectar. Isso significa que o nome
do host é enviado ao serviço DNS usado pela extensão, além das requisições feitas ao próprio
site. Redirecionamentos são avaliados antes de seguir para o próximo destino.

O modo aba abre páginas de plataformas reconhecidas usando a sessão autenticada do
navegador, se houver. Um interceptor valida navegações principais e chamadas XHR/Fetch para
bloquear destinos privados/reservados. Recursos estáticos como imagens, estilos e scripts
não são interceptados individualmente.

A proteção é uma mitigação de melhor esforço, não uma garantia contra DNS rebinding: o
navegador pode resolver o host novamente ao conectar. Não use a extensão como substituto
de um proxy de saída ou de controles de rede corporativos.

## Dados locais

- Configurações e histórico são gravados em `chrome.storage.local`.
- O histórico guarda status anterior, status mais recente, motivos e horários por URL; é
  limitado a 3.000 URLs e até 20 mudanças por URL.
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
