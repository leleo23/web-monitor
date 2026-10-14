# Desenvolvimento e regressões

## Arquitetura

`src/core/detection.js` contém comparação, preferências, eventos, identidade da fonte e validação pura. Carregado por `importScripts` no worker clássico MV3 e CommonJS nos testes.

`background.js` continua orquestrando APIs Chrome, captura, saúde, armazenamento e providers. Migração incremental: não há adapters específicos ainda. Funções injetadas via `executeScript` permanecem autocontidas: helpers externos não são transportados automaticamente.

Capturas registram proveniência e cobertura. Duas capturas estáveis são exigidas (três para zero). Transição positiva → zero guarda candidato separado até outra verificação confirmar após pelo menos cinco segundos. `readingKey` impede comparação de configurações diferentes; revisão invalida resultados em andamento.

IDs só são comparados quando ambos os snapshots têm cobertura completa, inferida pela igualdade entre total e IDs únicos. Total é comparável em listas parciais. A inferência não reconhece todo estado específico de autenticação/renderização de aplicações reais.

Contador/lista em frames diferentes requerem seleção explícita; URLs duplicadas ambíguas são rejeitadas. Permissões dos frames são pedidas antes do picker.

Mutações de storage são serializadas na instância do worker. Não há fila persistente de entrega: encerramento do worker entre commit/envio pode perder um alerta. Reenvio futuro exige definir idempotência e consentimento.

## Verificação

- `npm run check`: sintaxe, assets e versões.
- `npm test`: lógica/background com APIs simuladas, incluindo falsos positivos, pausa, migração, concorrência, segurança e timeout.
- `npm run test:browser`: DOM/paginação/parsing/Shadow DOM e popup real com APIs simuladas. Servidor temporário local serve apenas assets necessários e fecha ao terminar.

CI executa as três etapas; resultado local não comprova execução remota.

## Checklist manual

1. Instalar/atualizar na mesma pasta em Chrome 116+.
2. Selecionar contador e ID na fila autenticada; verificar permissões de frames.
3. Ler agora sem alertas; iniciar e criar/remover chamado no ambiente de teste.
4. Simular carregamento parcial, sessão expirada, fila vazia e ciclo 8→0→8.
5. Pausar durante captura, trocar fonte, editar seletor e reiniciar worker/navegador.
6. Testar Desktop, áudio, Telegram e webhook com credenciais somente na interface.
7. Verificar paginação, revogação de permissão e iframe indisponível.

O Chromium gerenciado deste ambiente bloqueia extensões descompactadas. Não contornar a política. Fixtures/UI em páginas comuns continuam testáveis; registrar separadamente a execução da extensão instalada.

## Pendências deliberadas

Adapters específicos, retenção configurável, vault/relay corporativo, retries persistentes de entrega, licença e publicação na loja. Consultar políticas oficiais atuais na etapa de publicação.


## Modelo v0.6.0 e migração

`src/core/storage.js` isola monitores. `monitorCatalog` identifica os registros; `activeMonitorId` é apenas a seleção do popup. O monitor original usa ID `legacy` e mantém os campos `monitorConfig`, `monitorSnapshot`, `monitorHistory` etc. intactos. Novos monitores usam `monitor:<id>` com os mesmos campos internos. A migração é idempotente; credenciais/preferências originais não são descartadas. Cada alarme usa `web-monitor-check:<id>` e é reconstruído no startup. Operações assíncronas carregam explicitamente o ID, sem depender da seleção atual do popup.

Visual: `type: visual`, `visualLocator` com frame/shadowChain/primary/fallbacks, `selectorStrategy` e `createdAt`. A seleção cria `monitorSelectionDraft`, separado do monitor confirmado. Prévia revalida duas leituras estáveis e emite um token; confirmação revalida conteúdo e revisão antes de persistir. Conteúdo arbitrário gera `valueChanged`, não IDs. Senhas e inputs ocultos são recusados.

`src/core/insights.js` calcula o dia local, ignora entregas na contagem de mudanças, distingue IDs confirmados de estimativas pelo total e usa até 288 leituras numéricas para pico/evolução. Dados retidos não garantem cobertura do dia completo; eventos antigos não estruturados não são interpretados por heurísticas de texto.

`src/core/sounds.js` é a lista fechada dos quatro arquivos locais, compartilhada pelo worker e documento offscreen. Som e volume são por monitor. Prévia é um comando explícito separado; mute impede alertas automáticos, sem bloquear a prévia solicitada pelo usuário.

A validação de reinício usa uma nova instância do worker com o storage persistido. É evidência de migração e persistência de dados; o ciclo de vida real do Chrome/MV3 continua exigindo checklist manual. Timers de fetch são limpos em finally; o picker remove listeners/overlays na seleção, ESC e substituição. Não foram adicionados MutationObservers ou timers de polling rápido.
