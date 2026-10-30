# Web Monitor v0.8.0

Extensão Chrome Manifest V3 para filas web, com contador, IDs e alertas Desktop, som, Telegram e webhook. Requer Chrome **116+**, navegador aberto e sessão válida na fila.

## Instalação e atualização

1. Baixe e extraia o ZIP.
2. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta que contém `manifest.json`.

Para atualizar, copie os arquivos novos, incluindo as pastas `src` e `sounds`, para a **mesma pasta da instalação anterior** e clique em **Recarregar** no cartão da extensão. Manter a mesma pasta/ID evita criar uma instalação com configurações separadas. A migração da v0.8.0 mantém a fila existente, histórico e preferências. A primeira leitura cria um baseline seguro quando a configuração da fonte mudou.

Não precisa de Node, npm ou servidor para usar a extensão. As dependências são apenas ferramentas de desenvolvimento.

## Primeiro uso

1. Abra a fila autenticada.
2. Na **Home**, clique em **Criar monitor → Fila de chamados**; uma aba dedicada será criada. Para a fila já migrada, use **Configurar** para ajustar sua fonte.
3. Selecione o contador: total ou paginação, como `Mostrando 1-8 de 8`.
4. Selecione a célula que contém apenas o ID, não a linha inteira. Exemplos: `370415`, `INC0012345`, `REQ-1234`.
5. Autorize os sites/frames necessários quando o Chrome solicitar.
6. Clique em **Ler agora** e confira o resultado; essa ação não envia alertas.
7. Clique em **Iniciar**.

Se houver mais de um frame compatível em uma configuração antiga, refaça a seleção visual. O intervalo é de 1 a 1440 minutos; suspensão do computador e ciclo de vida do Chrome podem atrasar verificações.

## Monitor visual

Na Home, escolha **Criar monitor → Selecionar elemento na página**. Passe o mouse para ver o destaque e clique no texto, número ou indicador desejado. Depois **abra novamente o Web Monitor**, confira a prévia e clique em **Confirmar monitor**. A extensão testa novamente o seletor antes de salvar; se o conteúdo mudou, revalide a prévia. Monitores confirmados ficam pausados até você clicar em **Iniciar**.

Esse modo observa mudanças no conteúdo do elemento, mesmo sem adapter. Se houver atributos semânticos únicos, salva alternativas de localização. Seletores estruturais frágeis têm aviso. A localização preserva frame e Shadow DOM aberto. Não permite executar código informado pelo usuário nem capturar campos de senha/inputs ocultos. Elementos sem texto, vazios ou com mais de 10.000 caracteres não são aceitos.

## Home e insights

A Home lista os monitores, seus estados (Ativo, Carregando, Atenção, Erro, Pausado) e as mudanças recentes. Use **Detalhes** ou **Histórico** no cartão; cada monitor pode ser iniciado/pausado separadamente. Selecione o monitor desejado antes de editar configurações e integrações. Excluir um monitor exige confirmação e remove apenas seus dados.

Em **Monitor**, os insights mostram dados de **hoje no horário local**: quantidade atual, entradas, saídas, pico/horário, última alteração e número de mudanças. O gráfico não exige biblioteca adicional. Totais de monitores de texto sem quantidade numérica ficam desconhecidos e não entram no total global.

Os dados são locais e limitados a 80 eventos e 288 leituras por monitor; não são um relatório completo do dia. Em listas parciais ou contadores visuais, entradas/saídas pela variação do total são **estimativas mínimas**, não identificação de chamados. Eventos antigos sem campos estruturados ficam preservados, mas não fabricam métricas. Uma mudança de texto conta como alteração, nunca como chamado novo/removido.

## Escolher o som

Em **Integrações**, escolha **Pulse, Bell, Digital ou Critical**, ajuste o volume e clique em **Ouvir**. A prévia não salva nem ativa alertas. Clique em **Salvar som** para persistir a escolha deste monitor. Desmarque **Alerta sonoro** e salve para silenciar. Sons são arquivos locais do pacote, sem downloads em runtime. Pulse conserva o áudio original; os outros são tons originais sintetizados para a extensão.

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

- Até 20 monitores independentes por instalação. Ainda não há adapters oficiais específicos de SysAid/ServiceNow.
- Shadow DOM aberto, inclusive aninhado; fechado não é acessível.
- Monitor automático exige contador para distinguir vazio de falha.
- Contador aceita inteiros, rótulos simples e paginação `Mostrando … de …` / `Showing … of …`; outros formatos precisam de testes específicos.
- Histórico retém e exibe até 80 eventos, sem retenção por idade ou limite configurável.
- Verificações automáticas recarregam a aba; o custo precisa ser medido em aplicações pesadas.
- SysAid/ServiceNow, permissões, reload da extensão, reinício real do Chrome e integrações devem ser validados no ambiente real; fixtures e simulação de worker não substituem essa validação.

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

ZIP com Python 3: `python3 scripts/package.py`. O manifesto fica diretamente na raiz do ZIP: extraia e selecione a pasta onde você vê `manifest.json`, `background.js`, `src` e `sounds`. O pacote exclui dependências, testes e arquivos locais usando lista explícita de assets.

Veja [arquitetura e validação](docs/DEVELOPMENT.md) e [changelog](CHANGELOG.md). Licença e documentação final de publicação permanecem pendentes; a extensão não está publicada na Chrome Web Store.


## Configuração guiada (0.7.0)

Na Home, use **Criar monitor → Configurar monitor automaticamente** com a fila aberta. A extensão cria sua própria aba, detecta sinais de SysAid/ServiceNow ou usa heurísticas genéricas, mostra contador, itens, exemplos e pontuação. Confirme uma sugestão para revalidá-la; depois escolha alertas, use **Testar monitor** / **Testar alertas** e inicie. A pontuação é heurística, não uma probabilidade ou garantia de compatibilidade. Nenhum monitor inicia automaticamente ao confirmar.

Se não houver sugestão segura, use **Selecionar manualmente**. Seletores ficam em **Configuração avançada**. O detector limita o trabalho por frame a 5.000 elementos e 50 roots; páginas grandes ou estruturas diferentes podem exigir o picker. Os presets são sinais de DOM/identificadores, sem URLs ou empresas codificadas.

**Testar monitor** não grava baseline, saúde, histórico nem amostras. Pode recriar e persistir a aba dedicada se ela foi fechada. Estado de canal configurado não prova entrega; **Testar alertas** envia os testes explícitos dos canais ativados. Som só toca para mudança confirmada ou teste solicitado, nunca por saúde/recuperação.

**Conectar Telegram** orienta token → conversa → teste → conectado. Chat ID fica em opções avançadas. Email, Teams e Slack continuam **Em breve**; webhook HTTPS é uma opção avançada, sem backend próprio.

**Exportar configuração** transfere somente preferências validadas (tipo, intervalo, flags e áudio). Por privacidade, não inclui nem nome livre, URLs ou seletores, que também podem conter segredos. Importar cria um monitor pausado e exige confirmar a página/elementos novamente. Credenciais existentes de outros monitores não são alteradas.

Veja docs/RC1-SYNC.md e docs/DELIVERY-0.7.md para reconciliação, arquivos e limites de validação. Chrome mínimo 116 mantido; a permissão permanente tabs foi substituída por activeTab com concessões opcionais por origem.


## Atualização 0.8.0 — filas vazias e picker

Refaça a detecção uma vez para que configurações antigas ganhem o vínculo explícito com o container. A extensão salva a estrutura (tabela/grid, coluna e paginação), sem incorporar o ID do chamado ou o texto do contador no seletor. Com evidência suficiente, é possível configurar uma fila já vazia. Sem essa evidência, continua sendo necessário selecionar manualmente.

`1 de 1`, `1-1 de 1`, `0 de 0`, `0 resultados`, `Nenhum chamado`, `No records found` e `No results` são reconhecidos. Mensagens de vazio são aceitas somente dentro do container vinculado, sem sinal de loading. Container ausente ou página carregando continuam inválidos; não viram fila vazia por suposição. A proteção de zero temporário permanece: transição positiva → zero aguarda confirmação posterior antes de substituir a leitura válida.

O picker persiste a intenção no worker, foca a aba antes de injetar, recebe `PICKER_READY` somente após instalar os listeners e recupera a seleção após navegação de frame. ESC cancela a sessão em todos os frames. Depois de selecionar, tenta abrir o popup automaticamente; se a API não estiver disponível, abre a configuração em uma aba da extensão. Isso pode mudar levemente o retorno visual em versões antigas do Chrome.

**Email está desativado.** A UI não armazena ou envia endereço e não pode marcar conexão verificada. O connector, interface comum de canais e contrato de backend são preparação. Veja docs/EMAIL-API.md para verificação por código, sessão autenticada, rate limiting e privacidade necessários antes de habilitar. Não há SMTP, API key global ou servidor de e-mail implantado.
