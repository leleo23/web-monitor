# Entrega 0.7.0

## A. Sincronização RC1

HEAD original: d93af5f, 0.6.0. Relatório detalhado: RC1-SYNC.md. Correções em 5854548; cobertura adicional de rede/offscreen em 05100d8. Não houve substituição cega nem downgrade. Preservados: múltiplos monitores, insights, seletor visual e quatro sons. Preservados readingKey, parsing restrito e zero reforçado; Chrome mínimo 116 necessário às APIs atuais. As lacunas de permissões, abas, hardening, cache, áudio e validação de integrações foram reconciliadas.

## B. Funcionalidades novas

Onboarding guiado, detector com presets de sinais SysAid/ServiceNow e fallback genérico/manual, confirmação revalidada, wizard explicativo Telegram, diagnóstico sem modificar baseline, teste explícito de canais, importação/exportação segura de preferências. Email/Teams/Slack apenas indicados como futuros; sem endpoints ou backend fictícios.

## C. Arquivos alterados

- CHANGELOG.md
- README.md
- background.js
- docs/DELIVERY-0.7.md
- docs/DEVELOPMENT.md
- docs/PRIVACY.md
- docs/RC1-SYNC.md
- downloads/web-monitor-v0.7.0.zip
- manifest.json
- offscreen.js
- package-lock.json
- package.json
- popup.html
- popup.js
- scripts/browser-smoke.cjs
- scripts/package.py
- src/core/detector.js
- src/core/portable.js
- tests/rc1.test.cjs
- tests/roadmap.test.cjs
- tests/security.test.cjs

## D. Testes

63 testes Node passaram; 22 fixtures Chromium passaram. Incluem baseline/loading/zero, abas, isolamento, migração, cache lazy, parser, motivos de som nas duas camadas, offscreen single-flight, timeout nos três endpoints, exportação sem segredos, diagnóstico sem efeitos sobre estado, propostas com confirmação e sinais de presets/Shadow DOM. Sintaxe, manifest, assets e versões validados por npm run check.

Não há lint/build adicionais definidos. Testes de navegador usam APIs de extensão simuladas. Não foram usados tokens reais nem enviados testes a contatos/serviços reais. Instalação MV3, concessão/revogação de activeTab/hosts e reinício real do Chrome não são comprovados por essas fixtures.

## E. Riscos e teste real

SysAid: verificar contador/IDs, loading, zero transitório, iframe indisponível e paginação. ServiceNow: verificar frame, Shadow DOM aberto aninhado, semântica dos badges e lazy fallback. Ambos: confirmar somente aba própria controlada, recuperação após fechá-la, permissões reais sem tabs, assinatura/credenciais e redirecionamentos. Detector é heurístico e limitado; se falhar, usar picker. Tempo de configuração 1–2 min é objetivo de UX, não medição de ambiente corporativo. Exportação é deliberadamente de preferências: fonte e seletores exigem nova confirmação para não transportar possíveis segredos.
