# Entrega 0.8.0 — correções após teste SysAid

Base: 0561b99 (0.7.0), limpa e sincronizada com main antes das mudanças.

## 1. Causas identificadas no código

Fila vazia: parsers não reconheciam paginação compacta (1 de 1, 0 de 0) e mensagens de vazio; detector exigia IDs presentes. Sem vínculo explícito com o container, não havia evidência persistente para diferenciar vazio de estrutura ausente. Item único também permitia ao picker escolher ID específico como último recurso.

Picker: injeção ocorria antes de focar a aba, sem handshake de listeners prontos. Navegação/remontagem em foco podia invalidar o contexto. Sessão existia, mas não tinha estados nem reinjeção por conclusão de navegação. Essas causas são compatíveis com o relato; não houve acesso à página corporativa para demonstrar o timing exato no Chrome do usuário.

Email: não existe infraestrutura de backend; não foi criada simulação de serviço real nem declarado envio concluído.

## 2. Correções e arquitetura

Detector aprende container/coluna/paginação com seletores estruturais e penaliza IDs dinâmicos; apenas os valores de exemplo são transitórios. Vazio inicial exige evidência de coluna e contador; texto isolado não cria monitor. Propostas passam por duas capturas estruturalmente válidas antes de aparecer e novamente antes de salvar; os IDs podem mudar entre elas.

queueLocator entra no fingerprint quando existe. Captura explicita VALID_WITH_ITEMS, VALID_EMPTY e INVALID_CAPTURE. Marcadores de vazio são escopados ao container vinculado e respeitam loading/aria-busy. Container removido, estrutura ilegível ou frame indisponível não viram zero. Mantidos retries e confirmação posterior de zero para proteger contra refresh transitório. Configurações antigas devem ser redetectadas para receber queueLocator.

Picker: ARMING → WAITING_FOR_TAB → INJECTING → READY → SELECTED/CANCELLED/ERROR. Intenção persistida antes do foco; READY somente após resposta do código injetado. Single-flight por sessão, recuperação por conclusão de frame/tab, cancelamento e limpeza de sessão/overlays. Após seleção, tenta abrir popup; em Chrome sem essa API usa aba interna da extensão, ainda autenticada por ID/URL. DOM normal, composedPath, Shadow DOM aberto e injeção best-effort mantidos.

Canais comuns via id/status/isConfigured/test/send. Dispatcher isola falhas e mantém regra de áudio. EmailConnector fica DISABLED por padrão, sem transporte; UI desativada, sem coletar endereço. Contrato de verificação/código/binding/autenticação/rate limiting e envio mínimo em EMAIL-API.md. Os testes simulam rate limiting/backend; nenhum servidor ou e-mail real foi implantado.

## 3. Testes e resultados

- npm test: 71 testes passaram, zero falhas.
- CHROMIUM_PATH=/usr/bin/chromium npm run test:browser: 29 verificações passaram, sem erros JavaScript no popup.
- npm run check: sintaxe, assets, manifesto e versões válidos; nenhum build/lint adicional definido.
- Novos cenários: 1→0, startup vazio com/sem evidência, 3 IDs trocados, todas as frases de vazio solicitadas, estrutura ausente, classificação explícita, validação com IDs variando, primeiro pedido com foco antes da injeção/READY, erro sem ACK, cancelamento e recuperação de frame sem outro clique no popup.
- Email: inválido, não verificado, sem backend, confirmação via mock, teste e três eventos mínimos, 429, falha, timeout e isolamento dos demais canais. Não demonstra entrega, verificação ou rate limiter reais.

Testes de navegador usam páginas comuns e APIs de extensão simuladas. Não comprovam o ciclo de vida real de uma extensão MV3 instalada.

## 4. Validação manual e riscos

No SysAid: refazer detecção com um chamado, removê-lo, aguardar confirmação de vazio, acrescentar outros IDs e testar paginação compacta. Validar seletor com headers/colunas reais. Sem evidência estrutural suficiente o detector pede picker em vez de assumir sucesso.

No ServiceNow: verificar estrutura dos badges, frames, Shadow DOM aberto e DOM que é remontado ao focar. Testar primeiro clique, ESC, frame lento/quebrado e retorno automático para a configuração. Em Chrome antigo o retorno pode ser aba interna em vez de popup. Políticas corporativas podem bloquear APIs/permissões.

Zero positivo→vazio aguarda confirmação em outra leitura (mínimo cinco segundos, normalmente próximo intervalo); esse atraso é intencional. Marcadores de vazio dependem da linguagem/markup suportados; outros formatos exigem novas fixtures. Autenticação/loading específicos de cada sistema continuam exigindo validação real. Email continua indisponível até implementar e auditar backend seguro.

## 5. Arquivos alterados

- CHANGELOG.md
- README.md
- background.js
- docs/DELIVERY-0.8.md
- docs/DEVELOPMENT.md
- docs/EMAIL-API.md
- docs/PRIVACY.md
- downloads/web-monitor-v0.8.0.zip
- manifest.json
- package-lock.json
- package.json
- popup.html
- popup.js
- scripts/browser-smoke.cjs
- scripts/package.py
- src/core/connectors.js
- src/core/detection.js
- src/core/detector.js
- tests/empty-picker-connectors.test.cjs
- tests/helpers.cjs
- tests/monitor.test.cjs
- tests/roadmap.test.cjs
- tests/security.test.cjs
