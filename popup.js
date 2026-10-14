const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = Object.fromEntries([
  "monitorName","intervalMinutes","counterSelector","itemSelector","alertOnNewItem","alertOnCountIncrease",
  "notificationsEnabled","soundEnabled","telegramEnabled","telegramBotToken","telegramChatId",
  "automationEnabled","automationWebhookUrl","statusDot","monitorStatus","healthStatus","healthDetail",
  "boundTabText","boundTabUrl","counterSummary","itemsSummary","totalValue","visibleValue","lastCheck","nextCheck",
  "channelGrid","itemsList","historyList","toast"
].map((id) => [id, $(`#${id}`)]));

let currentConfig = null;
let statusCache = null;

function toast(message, type = "") {
  ui.toast.textContent = message;
  ui.toast.className = `toast ${type}`.trim();
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { ui.toast.className = "toast hidden"; }, 4200);
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getFormConfig() {
  return {
    name: ui.monitorName.value.trim() || "Monitor",
    intervalMinutes: Math.max(1, Number(ui.intervalMinutes.value) || 5),
    counterSelector: ui.counterSelector.value.trim(),
    itemSelector: ui.itemSelector.value.trim(),
    alertOnNewItem: ui.alertOnNewItem.checked,
    alertOnCountIncrease: ui.alertOnCountIncrease.checked,
    notificationsEnabled: ui.notificationsEnabled.checked,
    soundEnabled: ui.soundEnabled.checked,
    telegramEnabled: ui.telegramEnabled.checked,
    telegramBotToken: ui.telegramBotToken.value.trim(),
    telegramChatId: ui.telegramChatId.value.trim(),
    automationEnabled: ui.automationEnabled.checked,
    automationWebhookUrl: ui.automationWebhookUrl.value.trim()
  };
}

async function send(type, payload = {}) {
  try { return await chrome.runtime.sendMessage({ type, ...payload }); }
  catch (error) { return { ok: false, error: error.message }; }
}

async function saveConfig({ message = true } = {}) {
  currentConfig = { ...(currentConfig || {}), ...getFormConfig() };
  const response = await send("SAVE_CONFIG", { config: currentConfig });
  if (!response.ok) { toast(response.error || "Falha ao salvar.", "error"); return false; }
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
    boundTitle: activeTab.title || parsed.hostname, enabled: false
  };
  await send("SAVE_CONFIG", { config: currentConfig });
  toast("Aba dedicada criada. Aguarde o carregamento e faça a seleção visual.", "success");
  await refresh();
}

async function beginPicker(type) {
  if (!(await saveConfig({ message: false }))) return;
  toast("Abrindo seletor visual…");
  const response = await send("BEGIN_ELEMENT_PICKER", { selectionType: type });
  if (!response.ok) return toast(response.error || "Não foi possível iniciar o seletor visual.", "error");
  window.close();
}

async function startMonitoring() {
  if (!(await saveConfig({ message: false }))) return;
  const response = await send("START_MONITORING");
  if (!response.ok) return toast(response.error || "Falha ao iniciar.", "error");
  toast(response.result?.baselineCreated ? "Monitoramento iniciado e baseline criado." : "Monitoramento iniciado.", "success");
  await refresh();
}

async function stopMonitoring() {
  const response = await send("STOP_MONITORING");
  if (!response.ok) return toast(response.error || "Falha ao pausar.", "error");
  toast("Monitoramento pausado.", "success");
  await refresh();
}

async function readNow() {
  const response = await send("CHECK_NOW", { refresh: false });
  if (!response.ok) return toast(response.error || "Falha na leitura.", "error");
  toast(response.result?.baselineCreated ? "Baseline criado." : "Leitura concluída.", "success");
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
  ui.telegramChatId.value = response.chatId;
  toast(`Chat encontrado: ${response.chatName}.`, "success");
  await refresh();
}

async function testTelegram() {
  if (!(await requestTelegramPermission())) return toast("Permissão para o Telegram não foi concedida.", "error");
  if (!(await saveConfig({ message: false }))) return;
  const response = await send("TEST_TELEGRAM");
  if (!response.ok) return toast(response.error || "Falha no teste do Telegram.", "error");
  toast("Mensagem de teste enviada ao Telegram.", "success");
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
  ui.monitorName.value = config?.name ?? "Fila SOC N2";
  ui.intervalMinutes.value = config?.intervalMinutes ?? 5;
  ui.counterSelector.value = config?.counterSelector ?? "";
  ui.itemSelector.value = config?.itemSelector ?? "";
  ui.alertOnNewItem.checked = config?.alertOnNewItem !== false;
  ui.alertOnCountIncrease.checked = config?.alertOnCountIncrease !== false;
  ui.notificationsEnabled.checked = config?.notificationsEnabled !== false;
  ui.soundEnabled.checked = config?.soundEnabled !== false;
  ui.telegramEnabled.checked = config?.telegramEnabled === true;
  ui.telegramBotToken.value = config?.telegramBotToken ?? "";
  ui.telegramChatId.value = config?.telegramChatId ?? "";
  ui.automationEnabled.checked = config?.automationEnabled === true;
  ui.automationWebhookUrl.value = config?.automationWebhookUrl ?? "";

  ui.boundTabText.textContent = config?.boundTitle || config?.boundOrigin || "Nenhuma aba dedicada";
  ui.boundTabUrl.textContent = config?.boundUrl || "Abra a fila e crie a aba dedicada.";
  ui.counterSummary.textContent = locatorSummary(config?.counterLocator, config?.counterSelector, "contador");
  ui.itemsSummary.textContent = locatorSummary(config?.itemLocator, config?.itemSelector, "itens");

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
    ["Telegram", status?.telegram, Boolean(config?.telegramBotToken && config?.telegramChatId), config?.telegramEnabled === true],
    ["Automação", status?.automation, Boolean(config?.automationWebhookUrl), config?.automationEnabled === true]
  ];
  ui.channelGrid.innerHTML = "";
  for (const [name, channel, configured, enabled] of defs) {
    const div = document.createElement("div");
    const error = channel?.status === "error";
    div.className = `channel ${error ? "error" : (configured && enabled ? "ok" : "")}`;
    const state = error ? "Erro" : !configured ? "Não configurado" : !enabled ? "Desativado" : "Ativo";
    const detail = error ? (channel?.lastError || "Falha no último envio") : channel?.lastSuccessAt ? `Último envio ${fmtTime(channel.lastSuccessAt)}` : state;
    div.innerHTML = `<strong>${name} · ${state}</strong><span></span>`;
    div.querySelector("span").textContent = detail;
    ui.channelGrid.appendChild(div);
  }
}

function renderSnapshot(snapshot) {
  ui.totalValue.textContent = typeof snapshot?.total === "number" ? snapshot.total : "—";
  ui.visibleValue.textContent = snapshot?.items?.length ?? "—";
  ui.lastCheck.textContent = fmtTime(snapshot?.checkedAt);
  ui.itemsList.innerHTML = "";
  if (!snapshot?.items?.length) {
    ui.itemsList.className = "items empty";
    ui.itemsList.textContent = "Nenhum estado salvo.";
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
  history.slice(0, 30).forEach((entry) => {
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
  const response = await send("GET_STATUS");
  if (!response.ok) return toast(response.error || "Falha ao carregar status.", "error");
  statusCache = response;
  renderConfig(response.config);
  renderHealth(response.health);
  renderChannels(response.channelStatus, response.config);
  renderSnapshot(response.snapshot);
  renderHistory(response.history);
  ui.nextCheck.textContent = fmtTime(response.nextCheckAt);
}

$$('.tab').forEach((button) => button.addEventListener('click', () => {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab === button));
  $$('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${button.dataset.tab}`));
}));

$('#createDedicatedBtn').addEventListener('click', createDedicatedTab);
$('#pickCounterBtn').addEventListener('click', () => beginPicker('counter'));
$('#pickItemsBtn').addEventListener('click', () => beginPicker('items'));
$('#saveBtn').addEventListener('click', () => saveConfig());
$('#startBtn').addEventListener('click', startMonitoring);
$('#stopBtn').addEventListener('click', stopMonitoring);
$('#testCaptureBtn').addEventListener('click', readNow);
$('#testAlertBtn').addEventListener('click', testLocal);
$('#saveTelegramBtn').addEventListener('click', saveTelegram);
$('#discoverChatBtn').addEventListener('click', discoverTelegram);
$('#testTelegramBtn').addEventListener('click', testTelegram);
$('#saveAutomationBtn').addEventListener('click', saveAutomation);
$('#testAutomationBtn').addEventListener('click', testAutomation);
$('#focusTabBtn').addEventListener('click', () => send('FOCUS_MONITOR_TAB'));
$('#clearHistoryBtn').addEventListener('click', async () => { await send('CLEAR_HISTORY'); toast('Histórico limpo.', 'success'); await refresh(); });

refresh();
