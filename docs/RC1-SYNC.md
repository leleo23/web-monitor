# Reconciliação RC1

Base inspecionada: d93af5f, versão 0.6.0, limpa e igual ao main remoto.

Já existiam: identidade de leitura por configuração (readingKey), baseline isolado por monitor, captura estável, confirmação reforçada de zero, frames best-effort, locator primeiro, contador formatado, timeout incluindo body, webhook HTTPS, offscreen single-flight, payloads sanitizados, histórico e som configurável.

Lacunas corrigidas: activeTab em vez de tabs, CSP explícita, hardening opcional tolerante a falha, aba exclusivamente dedicada com persistência imediata na recriação (inclusive foco), cache lazy de Shadow Roots compartilhado por captura, motivo de áudio validado no worker/offscreen e silêncio para saúde/recuperação, configuração mínima/permissão de canais no backend/UI, intervalo limitado em JavaScript, nome genérico, aviso de privacidade, webhook genérico e versão dinâmica.

Diferenças intencionais: Chrome mínimo 116 preservado (getContexts); readingKey preservado em vez de renomear/configFingerprint e invalidar snapshots; timeout 12 s; zero exige três amostras estáveis e confirmação posterior; parsing restrito preservado para não interpretar horários como contadores. Não foram removidos os monitores visuais, insights ou os quatro sons.

Validação: 57 testes Node e 18 fixtures Chromium passaram. Execução MV3 instalada, permissões reais sem tabs e integrações corporativas continuam exigindo validação manual. Nenhuma credencial foi utilizada nos testes.
