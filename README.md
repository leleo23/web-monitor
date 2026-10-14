# Web Monitor v0.5.1

Extensão Chrome Manifest V3 para filas web, com contador, IDs e alertas Desktop, som, Telegram e webhook. Requer Chrome **116+**, navegador aberto e sessão válida na fila.

## Instalação e atualização

1. Baixe e extraia o ZIP.
2. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta que contém `manifest.json`.

Para atualizar, copie os arquivos novos, incluindo a pasta `src`, para a **mesma pasta da instalação anterior** e clique em **Recarregar** no cartão da extensão. Manter a mesma pasta/ID evita criar uma instalação com configurações separadas. A primeira leitura da v0.5.1 cria um baseline seguro; preferências e credenciais existentes são preservadas.

Não precisa de Node, npm ou servidor para usar a extensão. As dependências são apenas ferramentas de desenvolvimento.

## Primeiro uso

1. Abra a fila autenticada.
2. Em **Configurar**, crie a aba dedicada.
3. Selecione o contador: total ou paginação, como `Mostrando 1-8 de 8`.
4. Selecione a célula que contém apenas o ID, não a linha inteira. Exemplos: `370415`, `INC0012345`, `REQ-1234`.
5. Autorize os sites/frames necessários quando o Chrome solicitar.
6. Clique em **Ler agora** e confira o resultado; essa ação não envia alertas.
7. Clique em **Iniciar**.

Se houver mais de um frame compatível em uma configuração antiga, refaça a seleção visual. O intervalo é de 1 a 1440 minutos; suspensão do computador e ciclo de vida do Chrome podem atrasar verificações.

## Proteções contra alertas indevidos

- Duas capturas consecutivas iguais são exigidas; para zero, três.
- Uma fila que passa de positiva a zero preserva o snapshot até outra verificação confirmar zero, separada por pelo menos cinco segundos. No intervalo padrão, a confirmação pode esperar a próxima verificação de cinco minutos.
- Leituras parciais/inválidas não substituem o estado válido. Fonte ou seletor alterado cria outro baseline.
- Pausar limpa o alarme e descarta capturas em andamento. Envios já iniciados não podem ser desfeitos.
- Frames diferentes só são combinados quando contador e lista foram explicitamente vinculados pela seleção visual. Ambiguidades são rejeitadas.
- Em listas paginadas/virtualizadas, o total continua monitorado. IDs só geram alertas entre duas leituras com todos os itens do total visíveis.
- Editar um seletor manual invalida seu locator visual anterior.

Essas proteções reduzem falsos positivos; dados plausíveis incorretos que permaneçam estáveis ainda exigem investigação e adapters específicos.

## Integrações e dados

**Desktop:** detalhes locais, incluindo IDs e total. **Som:** estado próprio e falha visível. **Telegram:** aviso genérico e horário, com confirmação do destinatário descoberto. **Webhook/Power Automate:** HTTPS, sem redirecionamentos; envia apenas `schemaVersion`, `source`, `event` e `occurredAt`. Eventos: `test`, `queue_changed`, `monitor_error`, `monitor_recovered`. E-mail/Teams são ações do fluxo externo; não há SMTP implementado.

Chamadas remotas têm timeout de 10 segundos. Não há fila persistente de reenvio nem garantia de entrega exatamente uma vez. Teste os canais na interface.

Token e webhook ficam no perfil local, com acesso restrito aos contextos confiáveis da extensão. **Esse armazenamento não é um cofre criptográfico.** Use bot dedicado; apague os campos e salve para remover credenciais. Nunca coloque tokens em arquivos ou commits. Consulte [tratamento de dados](docs/PRIVACY.md).

## Limites

- Uma fila por instalação; não há adapters específicos ou múltiplas filas ainda.
- Shadow DOM aberto, inclusive aninhado; fechado não é acessível.
- Monitor automático exige contador para distinguir vazio de falha.
- Contador aceita inteiros, rótulos simples e paginação `Mostrando … de …` / `Showing … of …`; outros formatos precisam de testes específicos.
- Histórico retém e exibe até 80 eventos, sem retenção por idade ou limite configurável.
- Verificações automáticas recarregam a aba; o custo precisa ser medido em aplicações pesadas.
- SysAid/ServiceNow e integrações devem ser validados no ambiente real; fixtures não provam compatibilidade corporativa.

## Desenvolvimento

Node 20+ (CI usa 24) e npm:

```sh
npm ci
npm run check
npm test
```

Fixtures DOM/interface com Playwright:

```sh
npx playwright install chromium
npm run test:browser
```

Com Chromium instalado em Linux: `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. APIs Chrome são simuladas nesses testes; instalação, permissões e alarmes reais precisam de validação manual. Não remova políticas administrativas para executar testes.

ZIP com Python 3: `python3 scripts/package.py`. O pacote exclui dependências, testes e arquivos locais usando lista explícita de assets.

Veja [arquitetura e validação](docs/DEVELOPMENT.md) e [changelog](CHANGELOG.md). Licença e documentação final de publicação permanecem pendentes; a extensão não está publicada na Chrome Web Store.
