# Tratamento de dados — versão 0.6.0

Descreve o código atual; a política para publicação na loja ainda precisa de revisão.

## Dados locais

A extensão guarda no perfil Chrome configuração (nome, endereço, seletores/locators), IDs capturados, total, horários, saúde, destinatário Telegram, token e URL do webhook. Retém até 80 eventos e 288 amostras por monitor, sem expiração por idade. No modo visual, guarda o conteúdo selecionado (até 10.000 caracteres) na última leitura e uma prévia temporária. Sons, volume, seletores alternativos e a identidade do monitor também ficam locais. Campos de senha/inputs ocultos não são capturados. Falhas preservam a última leitura válida; trocar fonte/seletores reinicializa o snapshot, mas não apaga o histórico anterior.

Storage restrito aos contextos confiáveis da extensão, sem criptografia adicional ou servidor de custódia. Quem tiver acesso ao perfil ou ferramentas de desenvolvimento pode acessar esses dados. Use perfil protegido e credenciais dedicadas com privilégios mínimos. Requisitos corporativos de vault precisam de relay autenticado projetado separadamente.

## Dados enviados

- Desktop: nome, IDs e quantidade podem aparecer localmente, inclusive na tela bloqueada conforme configurações do sistema.
- Telegram, se ativado: evento genérico/horário, token e Chat ID necessários à API. Descoberta consulta atualizações que podem conter mensagens; extrai conversa candidata e não persiste mensagens.
- Webhook HTTPS escolhido: versão do schema, origem `web-monitor`, evento e horário. A URL pode conter uma credencial do fluxo.
- Sistema monitorado: navegador recarrega a fila com a sessão existente; cookies não são copiados para Telegram/webhook.

Não há telemetria ou servidor próprio implementado. Serviços externos têm retenção/políticas próprias. Eventos sem IDs ainda revelam horários de atividade e indisponibilidade.

## Remover e controlar

Pause para interromper novas verificações; desative canais para futuros envios. Apague token, Chat ID e webhook e salve para remover credenciais. **Limpar** remove eventos do histórico do monitor selecionado; amostras para o gráfico continuam retidas. **Excluir este monitor** remove sua configuração, histórico e amostras, após confirmação. Desinstalar remove o storage do perfil ativo conforme o Chrome; backups e mensagens entregues a terceiros não são apagados por isso.

Permissões podem ser revogadas nas configurações da extensão. Requisições iniciadas e notificações entregues não podem ser desfeitas pela pausa.
