# Morto-Vivo

Extensão para Chrome e Vivaldi para analisar listas de URLs e classificar cada endereço como **Vivo**, **Zumbi**,
**Morto** ou **Indeterminado**, com o motivo e as evidências disponíveis. A versão atual da
extensão é **2.56**, definida em `manifest.json`.

Esta versão melhora o suporte ao TikTok: reconhece vídeos e publicações de fotos/carrosséis
quando há estado público correspondente, valida o ID retornado pelo oEmbed e não trata
respostas ambíguas ou HTTP 404 isolado como remoção confirmada. Links curtos também podem
ser classificados pelo destino canônico após o redirecionamento. Perfis e conteúdos sem
evidência suficiente permanecem indeterminados. As consultas TikTok são serializadas e a
fila é pausada após HTTP 429 ou HTTP 403 com desafio explícito; frases em bios e legendas
não pausam o lote. No modo aba, perfis TikTok podem aguardar até 45 segundos pela evidência
renderizada; a leitura retorna antes ao encontrar um cabeçalho de perfil, uma tela de desafio
ou uma mensagem explícita de conta não encontrada. O aviso localizado “Não foi possível
localizar esta conta” é interpretado como indisponibilidade do perfil, inclusive quando
aparece no cabeçalho ou depois da navegação da página. Anúncios da Shopee com indicação de
estoque esgotado são classificados como mortos quando essa evidência aparece na página ou
na API. Redirecionamentos `meta refresh` só são seguidos quando o atraso é de até cinco
segundos; destino com NXDOMAIN fica indeterminado e identifica o domínio de destino.
Links da Biblioteca de Anúncios da Meta também são identificados por ID, distinguindo anúncio
ativo, pausado/inativo e indisponível na biblioteca sem tratar toda indisponibilidade como
takedown.

### Decisões de classificação HTTP

Em sites genéricos, uma resposta HTTP 403 continua classificada como **Zumbi**: o acesso
está negado para a consulta, mas isso não comprova que o conteúdo foi removido. Uma resposta
HTTP 404 continua **Morto** com alta confiança para a URL consultada; isso não significa que
o domínio inteiro esteja fora do ar. Esses status genéricos não são tratados como prova de
derrubada/takedown.

Esta versão torna mais conservadora a identificação de páginas de erro Cloudflare: menções
em artigos ou páginas normais não são tratadas como falha, o bloqueio 1020 fica
indeterminado e respostas HTTP 520 são identificadas como erro Cloudflare. Também detecta
páginas estacionadas da GoDaddy e de outros provedores conhecidos quando a página inicial
redireciona por JavaScript para um lander na mesma origem e há sinais explícitos de domínio
à venda. Em sites genéricos, falhas de conexão, timeout ou redirecionamento opaco em HTTPS
podem acionar uma tentativa HTTP identificada no resultado e limitada a confiança média,
sem seguir destinos de redirecionamento ocultos. Uma falha de
conexão/TLS com DNS público, sem resposta nem via HTTP, permanece Indeterminada com baixa
confiança e tag de falha de rede. Páginas de domínio estacionado usam uma indicação separada
de takedown, e registradores/marketplaces não são tratados como serviços de parking por si só.

Na página de resultados, cada card pode receber uma classificação manual persistida
localmente, sem apagar o resultado automático nem seus motivos. Também é possível selecionar
vários cards e aplicar a mesma classificação manual em lote. Divergências entre a decisão
manual e a nova classificação automática ficam visíveis no card; as categorias exibem os
resultados em blocos para manter a página responsiva em listas grandes.

**Firefox ainda não é suportado.** A compatibilidade está em avaliação; veja o plano no
[guia de desenvolvimento](docs/DEVELOPMENT.md).

## Começar

1. Baixe ou extraia a pasta da extensão no computador.
2. Abra `chrome://extensions` (ou `vivaldi://extensions` no Vivaldi).
3. Ative o **Modo do desenvolvedor** e escolha **Carregar sem compactação**.
4. Selecione a pasta que contém `manifest.json`.
5. Abra o popup, cole as URLs — uma por linha — ou expanda **Importar lista TXT** para um
   lote maior; clique em **Verificar Status** para iniciar a análise.

O popup mostra a contagem de URLs válidas únicas em relação ao limite de 200 URLs coladas.
Arquivos TXT aceitam até 500 URLs válidas. A engrenagem abre o gerenciador de regras, onde
é possível editar regras personalizadas e importá-las ou exportá-las em CSV.

### Requisitos e fluxo local

- Requer Node.js 18 ou superior para rodar a validação automatizada do projeto.
- A extensão não precisa de build nem de bundling: ela é carregada diretamente do diretório
  do projeto como extensão não compactada.
- Para validar sintaxe e testes locais, execute no diretório da raiz:

```powershell
npm run check
```

O comando executa a verificação de sintaxe e a suíte automática com `node --test`.

## Documentação

- [Guia de uso](docs/USAGE.md): instalação, opções, resultados, notificações e solução de problemas.
- [Guia de desenvolvimento](docs/DEVELOPMENT.md): arquitetura, testes e convenções para mudanças.
- [Segurança e privacidade](docs/SECURITY-AND-PRIVACY.md): permissões, tráfego de rede, armazenamento e limites.
- [Apresentação técnica](docs/PRESENTATION.md): deck em Markdown/Marp com recursos, arquitetura e limites da extensão.
