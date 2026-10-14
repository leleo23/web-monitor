# Changelog

## 0.5.1

### Fixed

- Leituras parciais e instáveis não substituem imediatamente o snapshot válido.
- Fila vazia exige confirmação; ciclo temporário 8 → 0 → 8 não produz oito chamados novos.
- Baseline reiniciado ao trocar fonte/seletores; snapshot antigo não gera alertas na migração.
- Pausa limpa alarmes e invalida capturas em andamento.
- Proveniência de frames impede combinação automática de fontes distintas.
- Paginação não é interpretada como entrada/saída de IDs.
- Contador não interpreta horários como total; textos de carregamento não são IDs.
- Edição manual de seletor invalida locator anterior.
- Timeout de navegação explícito e proteção contra captura após redirecionamento.
- Falhas de apresentação/entrega não invalidam leituras; mutações concorrentes são serializadas.

### Changed

- “Ler agora” não envia notificações.
- Som tem confirmação de reprodução e estado próprio.
- Integrações remotas têm timeout, erros minimizados e redirecionamentos bloqueados.
- Descoberta Telegram pede confirmação antes de salvar destinatário.
- Storage restrito a contextos confiáveis; comandos/picker validam contexto e sessão.
- UI atualiza estado sem apagar edições e exibe os 80 eventos retidos.
- Controles de alertas de remoção/redução e indicação de cobertura.
- Chrome mínimo 116; configurações e credenciais existentes preservadas.

### Added

- Módulo puro de detecção/validação, regressões Node e fixtures DOM/interface.
- CI, documentação e empacotamento com lista explícita de arquivos.

## 0.5.0

Versão original importada do ZIP do proprietário: seleção visual em frames, recuperação da aba, locators de Shadow DOM aberto, Desktop/áudio, Telegram e webhook sanitizados. Compatibilidade corporativa requer validação no ambiente real.
