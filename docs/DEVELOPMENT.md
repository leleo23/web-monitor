# Desenvolvimento e regressões

## Arquitetura

`src/core/detection.js` contém comparação, preferências, eventos, identidade da fonte e validação pura. Carregado por `importScripts` no worker clássico MV3 e CommonJS nos testes.

`background.js` continua orquestrando APIs Chrome, captura, saúde, armazenamento e providers. Migração incremental: não há adapters específicos nem múltiplas filas ainda. Funções injetadas via `executeScript` permanecem autocontidas: helpers externos não são transportados automaticamente.

Capturas registram proveniência e cobertura. Duas capturas estáveis são exigidas (três para zero). Transição positiva → zero guarda candidato separado até outra verificação confirmar após pelo menos cinco segundos. `readingKey` impede comparação de configurações diferentes; revisão invalida resultados em andamento.

IDs só são comparados quando ambos os snapshots têm cobertura completa, inferida pela igualdade entre total e IDs únicos. Total é comparável em listas parciais. A inferência não reconhece todo estado específico de autenticação/renderização de aplicações reais.

Counter/list em frames diferentes requerem seleção explícita; URLs duplicadas ambíguas são rejeitadas. Permissões dos frames são pedidas antes do picker.

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

Múltiplas filas, adapters específicos, retenção configurável, vault/relay corporativo, retries persistentes de entrega, licença e publicação na loja. Consultar políticas oficiais atuais na etapa de publicação.
