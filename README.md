# Web Monitor v0.5.0

## O que foi corrigido

### 1. Picker robusto em iframes
A versão anterior usava `allFrames: true`. Em páginas com frames em estado de erro, o Chrome podia cancelar a injeção inteira com mensagens como:

`Frame with ID 0 is showing error page`

A v0.5 usa `chrome.webNavigation.getAllFrames()` e injeta o picker frame a frame. Frames com erro ou não acessíveis são ignorados individualmente. Isso evita que um frame ruim derrube SysAid ou ServiceNow inteiro.

### 2. Recuperação da aba dedicada
Se a aba dedicada ficar em página de erro ou URL inválida, o Web Monitor tenta voltar para a URL configurada antes de capturar ou abrir o seletor visual.

### 3. Shadow DOM de verdade
A seleção visual usa `event.composedPath()` e cria um locator estruturado que sabe atravessar Shadow DOM aberto. O monitor não depende apenas de um seletor CSS global.

Um locator contém:
- cadeia de hosts de Shadow DOM;
- seletor do elemento dentro do root correto;
- modo single/list.

Isso foi feito especialmente para cenários como ServiceNow Workspace, por exemplo um `now-badge` dentro de vários web components.

### 4. Compatibilidade mantida
- DOM normal: continua funcionando.
- SysAid em iframe: continua funcionando.
- ServiceNow Workspace em Shadow DOM aberto: agora é suportado.
- Configurações antigas com apenas seletor CSS ainda têm fallback por busca profunda.

## UX/UI
A interface foi reorganizada em quatro áreas:
- Visão geral
- Configurar
- Integrações
- Histórico

Seletores técnicos ficam escondidos em “Configuração técnica”. O fluxo recomendado agora é simplesmente criar a aba dedicada e usar os botões Selecionar.

## Integrações

### Desktop + som
Detalhado e local.

### Telegram
Sanitizado. Não envia IDs, quantidade, nome da fila, URL ou conteúdo.

### E-mail / Teams via Power Automate
A extensão agora possui um canal de webhook genérico. Ele envia apenas:

```json
{
  "schemaVersion": 1,
  "source": "web-monitor",
  "event": "queue_changed",
  "occurredAt": "2026-10-07T...Z"
}
```

O fluxo do Power Automate pode usar esse evento para enviar e-mail ou publicar no Teams.

Eventos possíveis:
- `test`
- `queue_changed`
- `monitor_error`
- `monitor_recovered`

Não foi implementado SMTP direto na extensão porque isso exigiria armazenar credenciais de e-mail/API no navegador e seria uma arquitetura pior para ambiente corporativo.

## Primeiro uso
1. Abra a fila.
2. Crie/substitua a aba dedicada.
3. Em Configurar, selecione visualmente o contador.
4. Selecione visualmente um item/chamado.
5. Clique em Ler agora.
6. Se a leitura estiver correta, inicie o monitoramento.

## Observação
O suporte é para Shadow DOM **aberto**. Shadow DOM fechado não é acessível por JavaScript normal da extensão.
