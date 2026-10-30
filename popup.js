const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = Object.fromEntries([
  "monitorName","intervalMinutes","counterSelector","itemSelector","alertOnNewItem","alertOnCountIncrease","alertOnRemovedItem","alertOnCountDecrease",
  "notificationsEnabled","soundEnabled","telegramEnabled","telegramBotToken","telegramChatId",
  "automationEnabled","automationWebhookUrl","statusDot","monitorStatus","healthStatus","healthDetail",
  "boundTabText","boundTabUrl","counterSummary","itemsSummary","totalValue","visibleValue","lastCheck","nextCheck",
  "channelGrid","itemsList","historyList","toast"
].map((id) => [id, $(`#${id}`)]));

let currentConfig = null;
let formDirty = false;
let refreshSequence = 0;
let validatingSelection = false;
let selectionToken = null;

function toast(message, type = "") {
  ui.toast.textContent = message;
  ui.toast.className = `toast ${type}`.trim();
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { ui.toast.className = "toast hidden"; }, 4200);
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString('pt-BR', { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getFormConfig() {
  return {
    name: ui.monitorName.value.trim() || "Meu monitor",
    intervalMinutes: Math.min(1440, Math.max(1, Number(ui.intervalMinutes.value) || 5)),
    counterSelector: ui.counterSelector.value.trim(),
    itemSelector: ui.itemSelector.value.trim(),
    alertOnNewItem: ui.alertOnNewItem.checked,
    alertOnCountIncrease: ui.alertOnCountIncrease.checked,
    alertOnRemovedItem: ui.alertOnRemovedItem.checked,
    alertOnCountDecrease: ui.alertOnCountDecrease.checked,
    notificationsEnabled: ui.notificationsEnabled.checked,
    soundEnabled: ui.soundEnabled.checked,
    soundId: $("#soundId").value,
    volume: Number($("#soundVolume").value) / 100,
    telegramEnabled: ui.telegramEnabled.checked,
    telegramBotToken: ui.telegramBotToken.value.trim(),
    telegramChatId: ui.telegramChatId.value.trim(),
    automationEnabled: ui.automationEnabled.checked,
    automationWebhookUrl: ui.automationWebhookUrl.value.trim()
  };
}

async function send(type, payload = {}) {
  try { return await chrome.runtime.sendMessage({ type, monitorId: currentConfig?.id, ...payload }); }
  catch (error) { return { ok: false, error: error.message }; }
}

async function saveConfig({ message = true } = {}) {
  currentConfig = { ...(currentConfig || {}), ...getFormConfig() };
  if(currentConfig.telegramEnabled) {
    if(!currentConfig.telegramBotToken || !currentConfig.telegramChatId) { toast("Informe token e Chat ID antes de ativar Telegram.","error"); return false; }
    if(!(await requestTelegramPermission())) return false;
  }
  if(currentConfig.automationEnabled || currentConfig.automationWebhookUrl) {
    try {
      if(new URL(currentConfig.automationWebhookUrl).protocol !== 'https:') throw new Error('Use um endpoint HTTPS.');
      if(currentConfig.automationEnabled && !(await requestOrigin(currentConfig.automationWebhookUrl))) return false;
    } catch(error) { toast(error.message,'error'); return false; }
  }
  const response = await send("SAVE_CONFIG", { config: currentConfig });
  if (!response.ok) { toast(response.error || "Falha ao salvar.", "error"); return false; }
  currentConfig = response.config;
  formDirty = false;
  if (message) toast("Configuração salva.", "success");
  await refresh();
  return true;
}

async function requestOrigin(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("URL inválida."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("A URL precisa usar HTTP ou HTTPS.");
  const pattern = `${parsed.origin}/*`;
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

async function requestTelegramPermission() {
  const pattern = "https://api.telegram.org/*";
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

async function createDedicatedTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.url || !/^https?:/i.test(activeTab.url)) return toast("Abra primeiro a fila que deseja monitorar.", "error");
  const granted = await requestOrigin(activeTab.url);
  if (!granted) return toast("Permissão para ler esse site não foi concedida.", "error");

  const dedicatedTab = await chrome.tabs.create({ url: activeTab.url, active: false });
  const parsed = new URL(activeTab.url);
  currentConfig = {
    ...(currentConfig || {}), ...getFormConfig(),
    tabId: dedicatedTab.id, boundUrl: activeTab.url, boundOrigin: parsed.origin,
    boundTitle: activeTab.title || parsed.hostname, enabled: false, resetBaseline: true
  };
  const saved = await send("SAVE_CONFIG", { config: currentConfig });
  if (!saved.ok) { await chrome.tabs.remove(dedicatedTab.id); throw new Error(saved.error || "Falha ao salvar a nova fonte."); }
  currentConfig = saved.config;
  formDirty = false;
  toast("Aba dedicada criada. Aguarde o carregamento e faça a seleção visual.", "success");
  await refresh();
}

async function beginPicker(type) {
  let frames = [];
  try { frames = await chrome.webNavigation.getAllFrames({ tabId: currentConfig?.tabId }); }
  catch { /* The worker can recreate a closed dedicated tab. */ }
  const origins = [...new Set((frames || []).filter((frame) => /^https?:/i.test(frame.url))
    .map((frame) => `${new URL(frame.url).origin}/*`))];
  if (origins.length && !(await chrome.permissions.contains({ origins })) &&
      !(await chrome.permissions.request({ origins }))) return toast("Permissão para ler os frames da fila não foi concedida.", "error");
  if (!(await saveConfig({ message: false }))) return;
  toast("Abrindo seletor visual…");
  const response = await send("BEGIN_ELEMENT_PICKER", { selectionType: type });
  if (!response.ok || response.type!=="PICKER_READY") return toast(response.error || "O seletor não confirmou prontidão.", "error");
  window.close();
}

async function startMonitoring() {
  if (!(await saveConfig({ message: false }))) return;
  const response = await send("START_MONITORING");
  if (!response.ok) return toast(response.error || "Falha ao iniciar.", "error");
  toast(response.result?.pending || response.result?.skipped ? response.result.reason : response.result?.baselineCreated ? "Monitoramento iniciado e baseline criado." : "Monitoramento iniciado.", "success");
  await refresh();
}

async function stopMonitoring() {
  const response = await send("STOP_MONITORING");
  if (!response.ok) return toast(response.error || "Falha ao pausar.", "error");
  toast("Monitoramento pausado.", "success");
  await refresh();
}

async function readNow() {
  if (!(await saveConfig({ message: false }))) return;
  const response = await send("CHECK_NOW", { refresh: false });
  if (!response.ok) return toast(response.error || "Falha na leitura.", "error");
  toast(response.result?.pending || response.result?.skipped ? response.result.reason : response.result?.baselineCreated ? "Baseline criado." : "Leitura concluída sem enviar alertas.", "success");
  await refresh();
}

async function testLocal() {
  if (!(await saveConfig({ message: false }))) return;
  const response = await send("TEST_ALERT");
  if (!response.ok) return toast(response.error || "Falha no teste local.", "error");
  toast("Alerta local disparado.", "success");
  await refresh();
}

async function saveTelegram() {
  if (!(await saveConfig({ message: false }))) return;
  toast("Telegram salvo.", "success");
}

async function discoverTelegram() {
  // permissions.request precisa ocorrer o mais próximo possível do clique do usuário.
  if (!(await requestTelegramPermission())) return toast("Permissão para o Telegram não foi concedida.", "error");
  if (!(await saveConfig({ message: false }))) return;
  const response = await send("DISCOVER_TELEGRAM_CHAT");
  if (!response.ok) return toast(response.error || "Chat ID não encontrado.", "error");
  if (!window.confirm(`Usar a conversa “${response.chatName}” (Chat ID ${response.chatId}) para receber os alertas?`)) {
    toast("Destinatário anterior mantido."); return;
  }
  ui.telegramChatId.value = response.chatId;
  if (!(await saveConfig({ message: false }))) return;
  toast("Destinatário confirmado e salvo.", "success");
}

async function testTelegram() {
  if (!(await requestTelegramPermission())) return toast("Permissão para o Telegram não foi concedida.", "error");
  if (!(await saveConfig({ message: false }))) return;
  const response = await send("TEST_TELEGRAM");
  if (!response.ok) return toast(response.error || "Falha no teste do Telegram.", "error");
  ui.telegramEnabled.checked = true;
  await saveConfig({message:false});
  toast("Telegram conectado. Mensagem de teste enviada.", "success");
  await refresh();
}

async function saveAutomation() {
  const url = ui.automationWebhookUrl.value.trim();
  if (url) {
    try {
      const granted = await requestOrigin(url);
      if (!granted) return toast("Permissão para o webhook não foi concedida.", "error");
    } catch (error) { return toast(error.message, "error"); }
  }
  if (!(await saveConfig({ message: false }))) return;
  toast("Automação externa salva.", "success");
}

async function testAutomation() {
  const url = ui.automationWebhookUrl.value.trim();
  if (!url) return toast("Informe a URL do webhook.", "error");
  try {
    if (!(await requestOrigin(url))) return toast("Permissão para o webhook não foi concedida.", "error");
  } catch (error) { return toast(error.message, "error"); }
  if (!(await saveConfig({ message: false }))) return;
  const response = await send("TEST_AUTOMATION");
  if (!response.ok) return toast(response.error || "Falha no teste do webhook.", "error");
  toast("Webhook testado com sucesso.", "success");
  await refresh();
}

function renderConfig(config) {
  currentConfig = config || {};
  ui.monitorName.value = config?.name ?? "Meu monitor";
  ui.intervalMinutes.value = config?.intervalMinutes ?? 5;
  ui.counterSelector.value = config?.counterSelector ?? "";
  ui.itemSelector.value = config?.itemSelector ?? "";
  ui.alertOnNewItem.checked = config?.alertOnNewItem !== false;
  ui.alertOnCountIncrease.checked = config?.alertOnCountIncrease !== false;
  ui.alertOnRemovedItem.checked = config?.alertOnRemovedItem === true;
  ui.alertOnCountDecrease.checked = config?.alertOnCountDecrease === true;
  ui.notificationsEnabled.checked = config?.notificationsEnabled !== false;
  ui.soundEnabled.checked = config?.soundEnabled !== false;
  $("#soundId").value = config?.soundId || "pulse";
  $("#soundVolume").value = Math.round((config?.volume ?? 0.7) * 100);
  $("#detailName").textContent = config?.name || "Seu monitor";
  $("#visualSetup").classList.toggle("hidden", config?.type !== "visual");
  $("#queueSetup").classList.toggle("hidden", config?.type === "visual");
  $("#visualSummary").textContent = config?.visualLocator ? "Elemento confirmado: " + config.visualLocator.targetSelector : "Nenhum elemento confirmado.";
  ui.telegramEnabled.checked = config?.telegramEnabled === true;
  ui.telegramBotToken.value = config?.telegramBotToken ?? "";
  ui.telegramChatId.value = config?.telegramChatId ?? "";
  ui.automationEnabled.checked = config?.automationEnabled === true;
  ui.automationWebhookUrl.value = config?.automationWebhookUrl ?? "";

  ui.boundTabText.textContent = config?.boundTitle || config?.boundOrigin || "Nenhuma aba dedicada";
  ui.boundTabUrl.textContent = config?.boundUrl || "Abra a fila e crie a aba dedicada.";
  ui.counterSummary.textContent = locatorSummary(config?.counterLocator, config?.counterSelector, "contador");
  ui.itemsSummary.textContent = locatorSummary(config?.itemLocator, config?.itemSelector, "itens");

  renderMonitorState(config);
}

function renderMonitorState(config) {
  if (config?.enabled) {
    ui.monitorStatus.textContent = "Monitorando";
    ui.statusDot.className = "dot running";
  } else {
    ui.monitorStatus.textContent = "Pausado";
    ui.statusDot.className = "dot stopped";
  }
}

function locatorSummary(locator, selector, fallback) {
  if (locator?.targetSelector) {
    return `${locator.usesShadowDom ? "Shadow DOM" : "DOM"} • ${locator.targetSelector}${locator.matchedCount ? ` • ${locator.matchedCount} match(es)` : ""}`;
  }
  return selector ? `Seletor manual • ${selector}` : `Selecione o ${fallback}`;
}

function renderHealth(health) {
  if (!health) {
    ui.healthStatus.textContent = "Sem leitura";
    ui.healthDetail.textContent = "—";
    return;
  }
  if (health.status === "healthy") {
    ui.healthStatus.textContent = "🟢 Saudável";
    ui.healthDetail.textContent = `Última válida: ${fmtTime(health.lastSuccessAt)}`;
  } else if (health.status === "warning") {
    ui.healthStatus.textContent = "🟡 Atenção";
    ui.healthDetail.textContent = `${health.consecutiveFailures || 1} falha de leitura`;
  } else {
    ui.healthStatus.textContent = "🔴 Com problema";
    ui.healthDetail.textContent = health.lastError || "Falha de leitura";
    ui.statusDot.className = "dot error";
  }
}

function renderChannels(status, config) {
  const defs = [
    ["Desktop", status?.local, config?.notificationsEnabled !== false, true],
    ["Som", status?.sound, true, config?.soundEnabled !== false],
    ["Email", {status:'unavailable'}, false, false],
    ["Telegram", status?.telegram, Boolean(config?.telegramBotToken && config?.telegramChatId), config?.telegramEnabled === true],
    ["Automação", status?.automation, Boolean(config?.automationWebhookUrl), config?.automationEnabled === true]
  ];
  ui.channelGrid.innerHTML = "";
  for (const [name, channel, configured, enabled] of defs) {
    const div = document.createElement("div");
    const error = channel?.status === "error";
    div.className = `channel ${error ? "error" : (configured && enabled ? "ok" : "")}`;
    const state = channel?.status === 'unavailable' ? 'Indisponível' : error ? "Erro" : !configured ? "Não configurado" : !enabled ? "Desativado" : "Ativo";
    const detail = error ? (channel?.lastError || "Falha no último envio") : channel?.lastSuccessAt ? `Último envio ${fmtTime(channel.lastSuccessAt)}` : state;
    div.innerHTML = `<strong>${name} · ${state}</strong><span></span>`;
    div.querySelector("span").textContent = detail;
    ui.channelGrid.appendChild(div);
  }
}

function renderSnapshot(snapshot) {
  $('#coverageDetail').textContent = typeof snapshot?.value === "string" ? "Conteúdo visual observado localmente." : !snapshot ? '' : snapshot.coverage === 'full'
    ? 'Lista completa: entradas e saídas de chamados podem ser confirmadas.'
    : 'Lista parcial: alertas de IDs ficam suspensos; alterações do total continuam monitoradas.';
  ui.totalValue.textContent = typeof snapshot?.total === "number" ? snapshot.total : "—";
  ui.visibleValue.textContent = snapshot?.items?.length ?? "—";
  ui.visibleValue.title = snapshot?.coverage === "full" ? "Todos os chamados do total estão visíveis." : "Lista parcial: alertas de IDs ficam suspensos; alterações do total continuam monitoradas.";
  ui.lastCheck.textContent = fmtTime(snapshot?.checkedAt);
  ui.itemsList.innerHTML = "";
  if (typeof snapshot?.value === "string") {
    ui.itemsList.className = "items";
    ui.itemsList.textContent = snapshot.value.slice(0, 240); return;
  }
  if (!snapshot?.items?.length) {
    ui.itemsList.className = "items empty";
    ui.itemsList.textContent = snapshot?.total === 0 ? "Fila vazia confirmada." : "Nenhum estado salvo.";
    return;
  }
  ui.itemsList.className = "items";
  snapshot.items.slice(0, 30).forEach((item) => {
    const pill = document.createElement("span");
    pill.className = "item-pill";
    pill.textContent = item;
    ui.itemsList.appendChild(pill);
  });
  if (snapshot.items.length > 30) {
    const pill = document.createElement("span");
    pill.className = "item-pill";
    pill.textContent = `+${snapshot.items.length - 30}`;
    ui.itemsList.appendChild(pill);
  }
}

function renderHistory(history) {
  ui.historyList.innerHTML = "";
  if (!history?.length) {
    ui.historyList.className = "history empty";
    ui.historyList.textContent = "Nenhum evento registrado.";
    return;
  }
  ui.historyList.className = "history";
  history.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const time = document.createElement("div");
    time.className = "history-time";
    time.textContent = new Date(entry.at).toLocaleString();
    const text = document.createElement("div");
    text.className = "history-text";
    text.textContent = entry.summary;
    row.append(time, text);
    ui.historyList.appendChild(row);
  });
}

async function refresh() {
  const sequence = ++refreshSequence;
  const response = await send("GET_STATUS");
  if (sequence !== refreshSequence) return;
  if (!response.ok) return toast(response.error || "Falha ao carregar status.", "error");
  if (!formDirty) renderConfig(response.config);
  else currentConfig = response.config || {};
  renderMonitorState(response.config);
  renderHealth(response.health);
  if (response.lastError) ui.healthDetail.textContent = response.lastError.message;
  if (response.pending) {
    ui.healthStatus.textContent = "🟡 Aguardando confirmação";
    ui.healthDetail.textContent = "Possível fila vazia. Última leitura válida preservada.";
  } else if (response.effectError && !response.lastError) {
    ui.healthDetail.textContent = "Leitura válida; falha ao atualizar histórico ou apresentação.";
  }
  renderChannels(response.channelStatus, response.config);
  renderSnapshot(response.snapshot);
  renderHistory(response.history);
  ui.nextCheck.textContent = fmtTime(response.nextCheckAt);
  renderHome(response.monitors || []);
  renderInsights(response.insights);
  renderSelection(response.selectionDraft);
  if(response.pickerStatus?.state==="ERROR") toast(response.pickerStatus.message || "Falha ao ativar seletor.","error");
  if (response.selectionDraft && !response.selectionDraft.previewToken && !validatingSelection) {
    activateTab('setup');
    await revalidateSelection();
  }
}

$$('.tab').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.tab)));

function activateTab(name) {
  $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
  $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function selectMonitor(id, tab = 'details') {
  if (formDirty && !window.confirm('Descartar alterações não salvas para abrir outro monitor?')) return;
  const response = await send('SELECT_MONITOR', { monitorId: id });
  if (!response.ok) throw new Error(response.error);
  formDirty = false; currentConfig = response.config; selectionToken = null;
  activateTab(tab); await refresh();
}

function cardAction(button, action) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await action(); } catch (error) { toast(error.message || 'Falha na ação.', 'error'); }
    finally { button.disabled = false; await refresh(); }
  });
}

function renderHome(monitors) {
  const active = monitors.filter(m => m.enabled).length;
  $('#globalStatus').textContent = active ? `${active} monitor${active === 1 ? '' : 'es'} ativo${active === 1 ? '' : 's'}` : 'Monitoramento pausado';
  $('#monitorCount').textContent = `${monitors.length} configurado${monitors.length === 1 ? '' : 's'}`;
  const quantified = monitors.filter(m => Number.isFinite(m.snapshot?.total));
  $('#globalCurrent').textContent = quantified.length ? quantified.reduce((sum,m)=>sum+m.snapshot.total,0) : '—';
  $('#globalAdded').textContent = '+' + monitors.reduce((sum,m)=>sum+(m.insights?.added || 0),0);
  $('#globalRemoved').textContent = '−' + monitors.reduce((sum,m)=>sum+(m.insights?.removed || 0),0);
  $('#globalDataNote').textContent = monitors.some(m=>m.insights?.estimated)
    ? 'Entradas/saídas estimadas pelo total em listas parciais. Dados de hoje retidos localmente.'
    : 'Últimas leituras válidas. Monitores de texto não entram no total de itens.';
  const list = $('#monitorList'); list.replaceChildren();
  const select = $('#monitorSelect'); select.replaceChildren();
  for (const monitor of monitors) {
    const option = node('option', monitor.name); option.value = monitor.id; select.append(option);
    const card = node('article',undefined,'monitor-card'); card.dataset.monitorId = monitor.id;
    const head = node('div',undefined,'monitor-head');
    const name = node('button',monitor.name,'monitor-name'); cardAction(name,()=>selectMonitor(monitor.id));
    head.append(name,node('span',monitor.status.label,'monitor-status')); card.append(head);
    const meta = node('div',undefined,'monitor-meta');
    meta.append(node('span',monitor.snapshot?.total != null ? `${monitor.snapshot.total} itens` : monitor.snapshot?.value ? monitor.snapshot.value.slice(0,60) : 'Sem leitura'),
      node('span','Última: '+fmtTime(monitor.snapshot?.checkedAt))); card.append(meta);
    const actions = node('div',undefined,'monitor-actions');
    const details = node('button','Detalhes','secondary'); cardAction(details,()=>selectMonitor(monitor.id));
    const toggle = node('button',monitor.enabled ? 'Pausar' : 'Iniciar','ghost');
    cardAction(toggle,async()=>{const r=await send(monitor.enabled?'STOP_MONITORING':'START_MONITORING',{monitorId:monitor.id}); if(!r.ok)throw new Error(r.error);});
    const history = node('button','Histórico','link-btn'); cardAction(history,()=>selectMonitor(monitor.id,'history'));
    actions.append(details,toggle,history); card.append(actions); list.append(card);
  }
  select.value = currentConfig?.id || '';
  if (!monitors.length) list.append(node('p','Crie seu primeiro monitor para acompanhar uma página.','empty'));
  const activity = $('#recentActivity'); activity.replaceChildren();
  const events = monitors.flatMap(m=>(m.activity || []).map(event=>({...event,monitorId:m.id,name:m.name})))
    .sort((a,b)=>b.at-a.at).slice(0,8);
  for (const event of events) {
    const row=node('div',undefined,'history-row');
    row.append(node('div',`${fmtTime(event.at)} · ${event.name}`,'history-time'),node('div',event.summary,'history-text')); activity.append(row);
  }
  if (!events.length) activity.textContent='Nenhuma alteração registrada.';
}

function renderInsights(insights) {
  const value = insights || {};
  $('#insightAdded').textContent = '+' + (value.added || 0);
  $('#insightRemoved').textContent = '−' + (value.removed || 0);
  $('#insightPeak').textContent = value.peak ?? '—';
  $('#insightPeakAt').textContent = value.peakAt ? fmtTime(value.peakAt) : '';
  $('#insightChanges').textContent = value.changes || 0;
  $('#lastChangeText').textContent = value.lastChangeAt ? 'Última alteração: '+new Date(value.lastChangeAt).toLocaleString() : 'Nenhuma alteração observada.';
  $('#insightNote').textContent = (value.estimated ? 'Entradas/saídas estimadas pela variação do total. ' : '')+
    (value.legacyEvents ? 'Eventos antigos sem detalhes não entram nos totais. ' : '')+
    'Dados retidos: até 80 eventos e 288 leituras por monitor. Não representa necessariamente o dia inteiro.';
  const chart = $('#quantityChart'); chart.replaceChildren();
  const points = (value.timeline || []).slice(-96);
  if (points.length < 2) { chart.append(node('p','A evolução aparecerá após duas leituras numéricas.','subtle')); return; }
  const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 440 100'); svg.setAttribute('role','img'); svg.setAttribute('aria-label','Evolução da quantidade nas leituras de hoje');
  const max=Math.max(1,...points.map(p=>p.total)), first=points[0].at, span=Math.max(1,points.at(-1).at-first);
  const line=document.createElementNS(ns,'polyline');
  line.setAttribute('points',points.map(p=>`${10+420*(p.at-first)/span},${85-70*p.total/max}`).join(' '));
  line.setAttribute('fill','none'); line.setAttribute('stroke','#2563eb'); line.setAttribute('stroke-width','2.5'); svg.append(line);
  const title=document.createElementNS(ns,'title'); title.textContent=points.map(p=>`${fmtTime(p.at)}: ${p.total}`).join('; '); svg.prepend(title); chart.append(svg);
  chart.append(node('p',`${fmtTime(points[0].at)} → ${fmtTime(points.at(-1).at)} · até ${max} itens`,'subtle'));
}

function renderSelection(draft) {
  $('#selectionPreview').classList.toggle('hidden',!draft);
  selectionToken = draft?.previewToken || null;
  $('#visualPreviewText').textContent = draft?.preview || '';
  $('#selectorWarning').textContent = draft?.locator?.stability === 'fragile'
    ? 'A localização depende da estrutura da página e pode mudar. Revalide antes de confirmar.'
    : 'Confira o conteúdo. O elemento será testado novamente antes de salvar.';
  $('#confirmSelectionBtn').disabled = !selectionToken;
}

async function revalidateSelection() {
  if (validatingSelection) return;
  validatingSelection = true;
  try {
    const response = await send('PREVIEW_SELECTION');
    if (!response.ok) throw new Error(response.error);
    selectionToken = response.previewToken;
    $('#visualPreviewText').textContent = response.preview;
    $('#confirmSelectionBtn').disabled = false;
  } catch(error) { toast(error.message,'error'); }
  finally { validatingSelection=false; }
}

async function createMonitor(type, automatic = false) {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (!tab?.url || !/^https?:/i.test(tab.url)) throw new Error('Abra a página que deseja monitorar antes de criar um monitor.');
  if (!(await requestOrigin(tab.url))) throw new Error('Permissão para a página não concedida.');
  if (formDirty && !window.confirm('Descartar edições não salvas e criar outro monitor?')) return;
  const response=await send('CREATE_MONITOR',{monitorType:type});
  if (!response.ok) throw new Error(response.error);
  formDirty=false; currentConfig=response.config; renderConfig(response.config);
  $('#createChooser').classList.add('hidden'); activateTab('setup');
  await createDedicatedTab();
  if (automatic) await detectQueue();
  else if (type==='visual') await beginPicker('visual');
}

function bindAction(id, action) {
  $(id).addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await action(); }
    catch (error) { toast(error.message || "Não foi possível concluir a ação.", "error"); }
    finally { button.disabled = false; await refresh(); }
  });
}

async function detectQueue(){
  if(!(await saveConfig({message:false})))return;
  toast('Detectando elementos…');
  const response=await send('DETECT_QUEUE');if(!response.ok)throw new Error(response.error);
  const container=$('#detectionResults');container.replaceChildren();
  if(!response.candidates.length){container.append(node('p','Não foi possível sugerir uma fila com segurança. Use a seleção manual.'));return;}
  for(const candidate of response.candidates){
    const card=node('div',undefined,'card');card.append(node('strong',`${candidate.preset} · confiança ${candidate.confidence}%`),
      node('p',`Total: ${candidate.total} · Itens: ${candidate.items}`),node('p','Exemplos: '+candidate.examples.join(', ')));
    const use=node('button','Usar configuração','primary');cardAction(use,async()=>{
      const saved=await send('APPLY_DETECTION',{candidateId:candidate.id});if(!saved.ok)throw new Error(saved.error);
      currentConfig=saved.config;formDirty=false;container.replaceChildren();activateTab('integrations');toast('Configuração confirmada. Escolha alertas e teste antes de iniciar.','success');
    });card.append(use);container.append(card);
  }
}
function showDiagnostic(response){
  if(!response.ok){$('#diagnosticResults').textContent='✗ '+response.error;throw new Error(response.error);}
  $('#diagnosticResults').textContent=response.checks.map(check=>`${check.status==='ok'?'✓':check.status==='disabled'?'○':'✗'} ${check.name}: ${check.error || (check.value ?? (check.status==='disabled'?'Desativado':'OK'))}`).join('\n');
}
bindAction('#autoSetupBtn',()=>createMonitor('queue',true));
bindAction('#detectQueueBtn',detectQueue);
bindAction('#manualSetupBtn',()=>{ $('#queueSetup').classList.remove('hidden'); $('#queueSetup').scrollIntoView({block:'nearest'}); });
bindAction('#finishSetupBtn',async()=>{await startMonitoring();activateTab('details');});
bindAction('#testChannelsBtn',async()=>{showDiagnostic(await send('TEST_ALL_ALERTS'));activateTab('setup');});
bindAction('#diagnoseBtn',async()=>showDiagnostic(await send('TEST_MONITOR')));
bindAction('#testAllAlertsBtn',async()=>showDiagnostic(await send('TEST_ALL_ALERTS')));
bindAction('#findTelegramBtn',discoverTelegram);
bindAction('#exportConfigBtn',async()=>{
  const response=await send('EXPORT_CONFIG');if(!response.ok)throw new Error(response.error);
  const url=URL.createObjectURL(new Blob([JSON.stringify(response.data,null,2)],{type:'application/json'}));
  const link=node('a');link.href=url;link.download='web-monitor-preferencias.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('#importConfigFile').addEventListener('change',async event=>{
  try{
    const file=event.target.files[0];if(!file)return;if(file.size>4096)throw new Error('Arquivo muito grande.');
    const response=await send('IMPORT_CONFIG',{data:JSON.parse(await file.text())});if(!response.ok)throw new Error(response.error);
    currentConfig=response.config;formDirty=false;activateTab('setup');await refresh();toast('Preferências importadas. Use a página atual e confirme os elementos.');
  }catch(error){toast(error.message,'error');}finally{event.target.value='';}
});
bindAction('#newMonitorBtn' ,()=>{$('#createChooser').classList.toggle('hidden');});
bindAction('#createVisualBtn',()=>createMonitor('visual'));
bindAction('#createQueueBtn',()=>createMonitor('queue'));
bindAction('#pickVisualBtn',()=>beginPicker('visual'));
bindAction('#revalidateSelectionBtn',revalidateSelection);
bindAction('#confirmSelectionBtn',async()=>{
  const response=await send('CONFIRM_SELECTION',{previewToken:selectionToken});
  if(!response.ok)throw new Error(response.error);
  currentConfig=response.config; selectionToken=null;
  if(formDirty)await saveConfig({message:false});
  toast('Elemento confirmado. Inicie o monitor quando quiser.','success'); activateTab('details');
});
bindAction('#discardSelectionBtn',async()=>{const r=await send('DISCARD_SELECTION');if(!r.ok)throw new Error(r.error);});
bindAction('#previewSoundBtn',async()=>{const r=await send('PREVIEW_SOUND',{soundId:$('#soundId').value,volume:Number($('#soundVolume').value)/100});if(!r.ok)throw new Error(r.error);toast('Prévia do som reproduzida.');});
bindAction('#saveSoundBtn',()=>saveConfig());
bindAction('#deleteMonitorBtn',async()=>{
  if(!currentConfig?.id || !window.confirm('Excluir este monitor, seu histórico e preferências?'))return;
  const response=await send('DELETE_MONITOR'); if(!response.ok)throw new Error(response.error);
  currentConfig=response.config;formDirty=false;selectionToken=null;activateTab('dashboard');
});
$('#monitorSelect').addEventListener('change',event=>selectMonitor(event.target.value).catch(error=>toast(error.message,'error')));
bindAction('#createDedicatedBtn', createDedicatedTab);
bindAction('#pickCounterBtn', () => beginPicker('counter'));
bindAction('#pickItemsBtn', () => beginPicker('items'));
bindAction('#saveBtn', () => saveConfig());
bindAction('#startBtn', startMonitoring);
bindAction('#stopBtn', stopMonitoring);
bindAction('#testCaptureBtn', readNow);
bindAction('#testAlertBtn', testLocal);
bindAction('#saveTelegramBtn', saveTelegram);
bindAction('#discoverChatBtn', discoverTelegram);
bindAction('#testTelegramBtn', testTelegram);
bindAction('#saveAutomationBtn', saveAutomation);
bindAction('#testAutomationBtn', testAutomation);
bindAction('#focusTabBtn', async () => {
  const response = await send('FOCUS_MONITOR_TAB');
  if (!response.ok) throw new Error(response.error || 'Não foi possível abrir a fila.');
});
bindAction('#clearHistoryBtn', async () => {
  const response = await send('CLEAR_HISTORY');
  if (!response.ok) throw new Error(response.error || 'Falha ao limpar histórico.');
  toast('Histórico limpo.', 'success');
});
$$('input, textarea, #soundId').forEach((field) => field.addEventListener('input', () => { formDirty = true; }));
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') refresh().catch(() => toast('Falha ao atualizar status.', 'error'));
});
refresh();

$("#extensionVersion").textContent = "v" + chrome.runtime.getManifest().version;
