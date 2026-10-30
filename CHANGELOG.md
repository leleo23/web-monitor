# Changelog

## Unreleased — reconciliação RC1

- Permissões mínimas, CSP e hardening resiliente.
- Aba exclusivamente dedicada com persistência imediata e cache lazy de Shadow Roots.
- Som limitado a mudança confirmada/teste manual em duas camadas.
- Validação de canais, intervalo limitado, webhook genérico e versão dinâmica.
- Ver docs/RC1-SYNC.md para diferenças preservadas do HEAD.

## 0.6.0

### Added

- Monitor visual para texto, contador ou indicador: highlight, prévia revalidada, confirmação, alternativas semânticas e aviso de localização frágil.
- Home com resumo global, monitores, estados acessíveis, ações individuais e atividade recente.
- Insights locais de hoje: quantidade atual, entradas/saídas, pico/horário, alterações, última mudança e gráfico SVG leve.
- Quatro sons locais (Pulse, Bell, Digital, Critical), prévia, volume, persistência e mute por monitor.
- Monitores identificados e independentes, até 20 por instalação, com estado/histórico/alarmes próprios e remoção individual.

### Changed

- Migração idempotente conserva fila, configurações, credenciais, histórico e snapshots existentes nos seus campos originais.
- Leituras numéricas retidas em até 288 amostras por monitor; insights explicam cobertura e estimativas por variação do total.
- Eventos estruturados distinguem mudança de texto, variação numérica, IDs e entrega; textos arbitrários não viram entradas/saídas de chamados.
- ZIP de instalação tem manifest.json diretamente na raiz, evitando uma pasta adicional após extrair.

### Validation

- Regressões da v0.5.1 mantidas; novos testes de migração, isolamento, reinício simulado, prévia, insights e áudio.
- Fixtures Chromium cobrem seleção, fallback, cancelamento, UI e decodificação dos quatro WAVs. Instalação MV3 e reinício real do Chrome permanecem verificações manuais.

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
