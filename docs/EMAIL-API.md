# EmailConnector — contrato proposto, não implantado

Não existe backend de e-mail neste repositório. Não há host, credencial ou transporte HTTP habilitado. A UI, o connector e este contrato são preparação; nenhum endereço é salvo/enviado pela extensão. O factory de canais usa EmailConnector sem transporte, status DISABLED, independentemente de campos adulterados na configuração local.

## Interface de transporte futuro

`requestVerification(email, {signal}) -> {challengeId}`

`confirm(challengeId, code, {signal}) -> {verified: true}`

`send({event, occurredAt}, {signal}) -> entrega aceita`

O connector só aceita teste/envio depois de confirmação. Há timeout de 12 segundos e AbortSignal; erros são minimizados. Transporte é injetado apenas nos testes, sem API real ou endpoint inventado na extensão. A confirmação em memória no cliente não substitui autorização/verificação no servidor.

## API a implementar antes de habilitar a feature

Caminhos abaixo são proposta relativa, não serviços existentes:

- POST `/v1/email/challenges`: `{email}`; resposta genérica 202 com challenge opaco. Nunca indicar se a conta/endereço já existe.
- POST `/v1/email/challenges/{challengeId}/confirm`: `{code}`; vincula destinatário verificado à sessão autenticada. Código errado/expirado não retorna verified.
- POST `/v1/email/events`: `{event, occurredAt}`. Destinatário resolvido exclusivamente pela sessão/binding verificado no servidor; não aceitar destinatário arbitrário no evento.
- POST `/v1/email/test`: mesmo evento `test`, com o mesmo binding e controles de envio.
- DELETE `/v1/email/binding`: revoga destinatário e impede novos envios; exigir autenticação.

Eventos permitidos: `test`, `queue_changed`, `monitor_error`, `monitor_recovered`. Rejeitar outros campos: URL, ticket, total, nome, IDs, descrição ou conteúdo. Preferências de mudança/erro/recuperação devem ser confirmadas pelo titular e validadas pelo servidor, com desativação fácil.

## Controles obrigatórios do backend

- Provedor transacional com credenciais somente no servidor/vault. Sem senha SMTP, client secret ou chave global no bundle.
- HTTPS, autenticação própria de sessão/binding, proteção CSRF/replay e CORS limitado a origens de extensão autorizadas. Um ID de extensão ou flag VERIFIED enviado pelo cliente não autentica o usuário.
- Desafios aleatórios, códigos armazenados com hash, TTL sugerido de 10 min, limite de 5 tentativas e rotação após confirmar/revogar.
- Rate limiting real por IP/sessão/endereço: proposta inicial de 3 verificações por 15 min e 10 eventos/minuto por binding; calibrar antes de produção. Retornar 429 e Retry-After sem enviar mensagem.
- Controle global de abuso, deduplicação/replay por sessão/evento/horário, limites do provedor e filas com política explícita de retry. Evitar armazenar conteúdo sensível em logs.
- Verificação do destinatário antes de qualquer teste/alerta, trilha mínima de consentimento, exclusão e documentação de retenção/privacidade.

## Validação existente e pendente

Testes unitários simulam email inválido, ausência de backend, não verificado, confirmação, quatro tipos de evento, 429, erro, timeout e isolamento dos outros canais. Não demonstram entrega real, autenticação, envio de código ou execução de um rate limiter no servidor. Só habilitar a UI após implementar e validar esses requisitos em ambiente controlado com destinatários de teste autorizados.
