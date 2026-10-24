# Morto-Vivo

Extensão para Chrome e Vivaldi para analisar listas de URLs e classificar cada endereço como **Vivo**, **Zumbi**,
**Morto** ou **Indeterminado**, com o motivo e as evidências disponíveis. A versão atual da
extensão é definida em `manifest.json`.

**Firefox ainda não é suportado.** A compatibilidade está em avaliação; veja o plano no
[guia de desenvolvimento](docs/DEVELOPMENT.md).

## Começar

1. Baixe ou extraia a pasta da extensão no computador.
2. Abra `chrome://extensions` (ou `vivaldi://extensions` no Vivaldi).
3. Ative o **Modo do desenvolvedor** e escolha **Carregar sem compactação**.
4. Selecione a pasta que contém `manifest.json`.
5. Abra o popup da extensão, cole as URLs — uma por linha — e clique em **Verificar Status**.

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

## Desenvolvimento rápido

Requer Node.js 18 ou superior. Na pasta do projeto:

```powershell
npm run check
```

O comando verifica a sintaxe JavaScript e executa os testes automatizados. Consulte o
[guia de desenvolvimento](docs/DEVELOPMENT.md) para detalhes.
