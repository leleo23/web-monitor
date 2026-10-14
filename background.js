const ALARM_NAME = "web-monitor-check";
const OFFSCREEN_URL = "offscreen.html";
const HEALTH_FAILURE_THRESHOLD = 2;
const MAX_HISTORY = 80;

let checking = false;

chrome.runtime.onInstalled.addListener(restoreAlarm);
chrome.runtime.onStartup.addListener(restoreAlarm);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  try {
    await runCheck({ source: "alarm", refresh: true });
  } catch {
    // runCheck persiste o erro e a saúde do monitor.
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = message?.type === "ELEMENT_SELECTED"
    ? handleElementSelected(message, sender)
    : handleMessage(message, sender);

  Promise.resolve(task)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_STATUS":
      return { ok: true, ...(await getStatus()) };

    case "SAVE_CONFIG": {
      const { monitorConfig = {} } = await chrome.storage.local.get("monitorConfig");
      const next = { ...monitorConfig, ...message.config };
      await chrome.storage.local.set({ monitorConfig: next });
      if (next.enabled) await scheduleAlarm(next.intervalMinutes || 5);
      return { ok: true, config: next };
    }

    case "START_MONITORING": {
      const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
      if (!monitorConfig?.boundUrl) throw new Error("Crie uma aba dedicada antes de iniciar.");
      const next = { ...monitorConfig, enabled: true };
      await chrome.storage.local.set({ monitorConfig: next });
      await scheduleAlarm(next.intervalMinutes || 5);
      const result = await runCheck({ source: "start", refresh: false });
      return { ok: true, result };
    }

    case "STOP_MONITORING": {
      const { monitorConfig = {} } = await chrome.storage.local.get("monitorConfig");
      await chrome.storage.local.set({ monitorConfig: { ...monitorConfig, enabled: false } });
      await chrome.alarms.clear(ALARM_NAME);
      await chrome.action.setBadgeText({ text: "" });
      return { ok: true };
    }

    case "CHECK_NOW":
      return { ok: true, result: await runCheck({ source: "manual", refresh: Boolean(message.refresh) }) };

    case "TEST_ALERT":
      return await testLocalAlert();

    case "BEGIN_ELEMENT_PICKER":
      return await beginElementPicker(message.selectionType);

    case "TEST_TELEGRAM":
      return await testTelegram();

    case "DISCOVER_TELEGRAM_CHAT":
      return await discoverTelegramChat();

    case "TEST_AUTOMATION":
      return await testAutomationWebhook();

    case "FOCUS_MONITOR_TAB":
      await focusDedicatedTab();
      return { ok: true };

    case "CLEAR_HISTORY":
      await chrome.storage.local.set({ monitorHistory: [] });
      return { ok: true };

    default:
      return { ok: false, error: "Mensagem desconhecida." };
  }
}

async function restoreAlarm() {
  const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
  if (monitorConfig?.enabled) await scheduleAlarm(monitorConfig.intervalMinutes || 5);
}

async function scheduleAlarm(intervalMinutes) {
  const interval = Math.max(1, Number(intervalMinutes) || 5);
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
}

async function getStatus() {
  const data = await chrome.storage.local.get([
    "monitorConfig", "monitorSnapshot", "monitorHistory", "monitorLastError",
    "monitorHealth", "lastSelection", "channelStatus"
  ]);
  const alarm = await chrome.alarms.get(ALARM_NAME);
  return {
    config: data.monitorConfig || null,
    snapshot: data.monitorSnapshot || null,
    history: data.monitorHistory || [],
    lastError: data.monitorLastError || null,
    health: data.monitorHealth || null,
    lastSelection: data.lastSelection || null,
    channelStatus: normalizeChannelStatus(data.channelStatus),
    nextCheckAt: alarm?.scheduledTime || null
  };
}

function normalizeChannelStatus(value) {
  const blank = { status: "idle", lastSuccessAt: null, lastErrorAt: null, lastError: null };
  return {
    local: { ...blank, status: "ready", ...(value?.local || {}) },
    telegram: { ...blank, status: "unconfigured", ...(value?.telegram || {}) },
    automation: { ...blank, status: "unconfigured", ...(value?.automation || {}) }
  };
}

async function runCheck({ source = "manual", refresh = false } = {}) {
  if (checking) return { skipped: true, reason: "Uma verificação já está em andamento." };
  checking = true;

  try {
    const { monitorConfig, monitorSnapshot } = await chrome.storage.local.get(["monitorConfig", "monitorSnapshot"]);
    if (!monitorConfig) throw new Error("Nenhuma configuração foi salva.");

    const tab = await ensureDedicatedTabReady(monitorConfig, { refresh });
    if (!tab) throw new Error("A aba dedicada não pôde ser preparada.");

    if (tab.id !== monitorConfig.tabId) {
      monitorConfig.tabId = tab.id;
      await chrome.storage.local.set({ monitorConfig });
    }

    const snapshot = await captureWithRetry(tab.id, monitorConfig);
    if (!snapshot) {
      throw new Error("Não encontrei os elementos configurados na página. A sessão pode ter expirado ou a página pode ter mudado.");
    }

    snapshot.checkedAt = Date.now();
    snapshot.source = source;

    const comparison = compareSnapshots(monitorSnapshot, snapshot);
    await chrome.storage.local.set({ monitorSnapshot: snapshot, monitorLastError: null });

    await markHealthSuccess(monitorConfig);
    await updateBadge(snapshot.total);

    const event = buildHistoryEvent(monitorSnapshot, snapshot, comparison);
    if (event) await appendHistory(event);

    if (monitorSnapshot && shouldAlert(monitorConfig, comparison)) {
      await dispatchChangeAlert(monitorConfig, monitorSnapshot, snapshot, comparison);
    }

    return { snapshot, comparison, baselineCreated: !monitorSnapshot };
  } catch (error) {
    const lastError = { message: error.message, at: Date.now() };
    await chrome.storage.local.set({ monitorLastError: lastError });
    await chrome.action.setBadgeText({ text: "!" });
    const { monitorConfig = {} } = await chrome.storage.local.get("monitorConfig");
    await markHealthFailure(monitorConfig, error.message);
    throw error;
  } finally {
    checking = false;
  }
}

async function resolveDedicatedTab(config) {
  if (config?.tabId) {
    try { return await chrome.tabs.get(config.tabId); } catch {}
  }

  const tabs = await chrome.tabs.query({});
  const exact = tabs.find((tab) => tab.url === config?.boundUrl);
  if (exact) return exact;

  if (config?.boundOrigin) {
    return tabs.find((tab) => {
      try { return new URL(tab.url).origin === config.boundOrigin; } catch { return false; }
    }) || null;
  }
  return null;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

async function ensureDedicatedTabReady(config, { refresh = false } = {}) {
  let tab = await resolveDedicatedTab(config);

  if (!tab && config?.boundUrl) {
    tab = await chrome.tabs.create({ url: config.boundUrl, active: false });
  }
  if (!tab) return null;

  // Corrige automaticamente abas que ficaram em chrome-error://, about:blank ou outra URL inválida.
  if (!isHttpUrl(tab.url) && isHttpUrl(config?.boundUrl)) {
    await chrome.tabs.update(tab.id, { url: config.boundUrl });
    await waitForStableTab(tab.id, 30000);
    tab = await chrome.tabs.get(tab.id);
  } else if (refresh) {
    if (tab.url !== config.boundUrl && isHttpUrl(config?.boundUrl)) {
      await chrome.tabs.update(tab.id, { url: config.boundUrl });
    } else {
      await chrome.tabs.reload(tab.id);
    }
    await waitForStableTab(tab.id, 30000);
    tab = await chrome.tabs.get(tab.id);
  } else if (tab.status === "loading") {
    await waitForStableTab(tab.id, 30000);
    tab = await chrome.tabs.get(tab.id);
  }

  // Alguns erros de navegação preservam a URL original em tabs.get(), mas o frame 0
  // aparece como errorOccurred no webNavigation. Nesse caso fazemos uma recuperação explícita.
  let frames = await safeGetFrames(tab.id);
  let top = frames.find((frame) => frame.frameId === 0);
  if ((!top || top.errorOccurred || !isInjectableFrameUrl(top.url)) && isHttpUrl(config?.boundUrl)) {
    await chrome.tabs.update(tab.id, { url: config.boundUrl });
    await waitForStableTab(tab.id, 30000);
    tab = await chrome.tabs.get(tab.id);
    frames = await safeGetFrames(tab.id);
    top = frames.find((frame) => frame.frameId === 0);
  }

  // Dá tempo para Workspaces/iframes/AJAX montarem o conteúdo.
  await sleep(900);
  return tab;
}

async function focusDedicatedTab() {
  const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
  const tab = await resolveDedicatedTab(monitorConfig || {});
  if (!tab) return;
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
}

async function waitForStableTab(tabId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const frames = await safeGetFrames(tabId);
      const top = frames.find((frame) => frame.frameId === 0);
      const topHealthy = top && !top.errorOccurred && isInjectableFrameUrl(top.url);
      if (tab.status === "complete" && topHealthy) return;
    } catch {}
    await sleep(450);
  }
}

function isInjectableFrameUrl(url) {
  const value = String(url || "");
  return /^https?:\/\//i.test(value) || value === "about:blank" || value === "about:srcdoc";
}

async function safeGetFrames(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return Array.isArray(frames) ? frames : [];
  } catch {
    return [];
  }
}

async function getInjectableFrames(tabId) {
  let frames = await safeGetFrames(tabId);
  if (!frames.length) {
    frames = [{ frameId: 0, url: (await chrome.tabs.get(tabId)).url, errorOccurred: false }];
  }

  return frames.filter((frame) =>
    Number.isInteger(frame.frameId) &&
    !frame.errorOccurred &&
    isInjectableFrameUrl(frame.url)
  );
}

async function executeInFramesBestEffort(tabId, func, args = []) {
  const frames = await getInjectableFrames(tabId);
  const settled = await Promise.all(frames.map(async (frame) => {
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frame.frameId] },
        func,
        args
      });
      return { ok: true, frameId: frame.frameId, frameUrl: frame.url, result: result?.[0]?.result };
    } catch (error) {
      return { ok: false, frameId: frame.frameId, frameUrl: frame.url, error: error.message };
    }
  }));
  return settled;
}

async function captureWithRetry(tabId, config) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await captureAllFrames(tabId, config);
    if (result?.foundSomething) return result.snapshot;
    await sleep(900);
  }
  return null;
}

async function captureAllFrames(tabId, config) {
  const frameResults = await executeInFramesBestEffort(tabId, captureFrameState, [{
    counterSelector: config.counterSelector || "",
    itemSelector: config.itemSelector || "",
    counterLocator: config.counterLocator || null,
    itemLocator: config.itemLocator || null
  }]);

  const results = frameResults
    .filter((entry) => entry.ok && entry.result)
    .map((entry) => ({ frameId: entry.frameId, frameUrl: entry.frameUrl, ...entry.result }));

  const bestCounter = results
    .filter((r) => typeof r.total === "number")
    .sort((a, b) => (b.counterConfidence || 0) - (a.counterConfidence || 0))[0] || null;

  const bestItems = results
    .filter((r) => Array.isArray(r.items) && r.items.length > 0)
    .sort((a, b) => b.items.length - a.items.length)[0] || null;

  if (!bestCounter && !bestItems) return { foundSomething: false, snapshot: null };

  return {
    foundSomething: true,
    snapshot: {
      total: bestCounter?.total ?? null,
      counterText: bestCounter?.counterText ?? null,
      items: bestItems?.items ?? [],
      frameUrl: bestCounter?.href || bestItems?.href || null
    }
  };
}

function captureFrameState(config) {
  function deepAll(selector, initialRoot = document) {
    if (!selector) return [];
    const results = [];
    const seen = new Set();
    const roots = [initialRoot];

    while (roots.length) {
      const root = roots.shift();
      if (!root?.querySelectorAll) continue;
      let matches = [], elements = [];
      try {
        matches = [...root.querySelectorAll(selector)];
        elements = [...root.querySelectorAll("*")];
      } catch {
        continue;
      }
      for (const match of matches) {
        if (!seen.has(match)) { seen.add(match); results.push(match); }
      }
      for (const element of elements) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }
    return results;
  }

  function deepOne(selector, root = document) {
    return deepAll(selector, root)[0] || null;
  }

  function resolveLocator(locator, fallbackSelector, all) {
    if (locator?.targetSelector && Array.isArray(locator.shadowChain)) {
      let root = document;
      let valid = true;
      for (const hostSelector of locator.shadowChain) {
        let host = null;
        try { host = root.querySelector(hostSelector); } catch { valid = false; break; }
        if (!host?.shadowRoot) { valid = false; break; }
        root = host.shadowRoot;
      }
      if (valid) {
        try {
          const matches = all
            ? [...root.querySelectorAll(locator.targetSelector)]
            : [root.querySelector(locator.targetSelector)].filter(Boolean);
          if (matches.length) return matches;
        } catch {}
      }
    }

    return all ? deepAll(fallbackSelector) : [deepOne(fallbackSelector)].filter(Boolean);
  }

  function readCounter(element) {
    if (!element) return "";
    const candidates = [
      element.getAttribute?.("value"),
      element.value,
      element.getAttribute?.("data-value"),
      element.getAttribute?.("aria-valuenow"),
      element.getAttribute?.("aria-label"),
      element.textContent
    ];
    for (const candidate of candidates) {
      if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
        return String(candidate).trim();
      }
    }
    return "";
  }

  function parseLastNumber(text) {
    const values = String(text || "").match(/\d+/g);
    return values?.length ? Number(values[values.length - 1]) : null;
  }

  function readItem(element) {
    if (!element) return "";
    const candidates = [
      element.textContent,
      element.getAttribute?.("value"),
      element.getAttribute?.("data-value"),
      element.getAttribute?.("aria-label")
    ];
    for (const candidate of candidates) {
      if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
        return String(candidate).trim();
      }
    }
    return "";
  }

  const counterElements = resolveLocator(config.counterLocator, config.counterSelector, false);
  const itemElements = resolveLocator(config.itemLocator, config.itemSelector, true);

  const counter = counterElements[0] || null;
  const counterText = readCounter(counter);
  const total = parseLastNumber(counterText);
  const items = [...new Set(itemElements.map(readItem).filter(Boolean))];

  return {
    total,
    counterText,
    items,
    counterConfidence: config.counterLocator && counter ? 2 : (counter ? 1 : 0),
    href: location.href,
    isTop: window.top === window
  };
}

function compareSnapshots(previous, current) {
  if (!previous) return { delta: null, added: [], removed: [] };
  const oldSet = new Set(previous.items || []);
  const newSet = new Set(current.items || []);
  return {
    delta: typeof previous.total === "number" && typeof current.total === "number"
      ? current.total - previous.total : null,
    added: (current.items || []).filter((item) => !oldSet.has(item)),
    removed: (previous.items || []).filter((item) => !newSet.has(item))
  };
}

function shouldAlert(config, comparison) {
  return (
    (config.alertOnNewItem !== false && comparison.added.length > 0) ||
    (config.alertOnCountIncrease !== false && comparison.delta > 0) ||
    (config.alertOnCountDecrease === true && comparison.delta < 0) ||
    (config.alertOnRemovedItem === true && comparison.removed.length > 0)
  );
}

async function dispatchChangeAlert(config, previous, current, comparison) {
  const delivery = { local: "disabled", telegram: "disabled", automation: "disabled" };

  if (config.notificationsEnabled !== false) {
    try {
      await showNotification({
        title: buildLocalTitle(config, comparison),
        message: buildLocalMessage(previous, current, comparison)
      });
      delivery.local = "sent";
      await setChannelSuccess("local");
    } catch (error) {
      delivery.local = "error";
      await setChannelError("local", error.message);
    }
  }

  if (config.soundEnabled !== false) {
    try { await playSound(); } catch {}
  }

  if (config.telegramEnabled && config.telegramBotToken && config.telegramChatId) {
    try {
      await sendTelegramMessage(config, sanitizedText("change", current.checkedAt));
      delivery.telegram = "sent";
      await setChannelSuccess("telegram");
    } catch (error) {
      delivery.telegram = "error";
      await setChannelError("telegram", error.message);
    }
  }

  if (config.automationEnabled && config.automationWebhookUrl) {
    try {
      await sendAutomationWebhook(config, "queue_changed", current.checkedAt);
      delivery.automation = "sent";
      await setChannelSuccess("automation");
    } catch (error) {
      delivery.automation = "error";
      await setChannelError("automation", error.message);
    }
  }

  await appendHistory({
    at: current.checkedAt,
    type: "notification",
    severity: "attention",
    summary: `Alerta enviado • Desktop: ${delivery.local} • Telegram: ${delivery.telegram} • Automação: ${delivery.automation}`,
    delivery
  });
}

function buildLocalTitle(config, comparison) {
  const name = config.name || "Monitor";
  if (comparison.added.length === 1) return `${name} — novo item detectado`;
  if (comparison.added.length > 1) return `${name} — ${comparison.added.length} novos itens`;
  if (comparison.delta > 0) return `${name} — fila aumentou`;
  return `${name} — alteração detectada`;
}

function buildLocalMessage(previous, current, comparison) {
  const parts = [];
  if (comparison.added.length) {
    const ids = comparison.added.slice(0, 5).map((id) => `#${id}`).join(", ");
    parts.push(`Novo(s): ${ids}${comparison.added.length > 5 ? ` +${comparison.added.length - 5}` : ""}`);
  }
  if (comparison.delta !== null && comparison.delta !== 0) {
    parts.push(`Fila: ${previous.total} → ${current.total} (${comparison.delta > 0 ? "+" : ""}${comparison.delta})`);
  }
  if (comparison.delta > 0 && !comparison.added.length) {
    parts.push("Nenhum novo ID foi identificado entre os itens visíveis.");
  }
  parts.push(`Horário: ${formatTimeOnly(current.checkedAt)}`);
  return parts.join(" • ");
}

function sanitizedText(kind, timestamp) {
  if (kind === "health_error") {
    return `⚠️ Web Monitor\n\nO monitor apresentou falhas consecutivas.\nVerifique o ambiente corporativo.\n\nHorário: ${formatTimeOnly(timestamp)}`;
  }
  if (kind === "recovery") {
    return `✅ Web Monitor\n\nO monitor voltou a funcionar normalmente.\n\nHorário: ${formatTimeOnly(timestamp)}`;
  }
  if (kind === "test") {
    return `✅ Web Monitor\n\nTeste de notificação remota realizado com sucesso.\n\nHorário: ${formatTimeOnly(timestamp)}`;
  }
  return `🚨 Web Monitor\n\nFoi detectada uma alteração na fila monitorada.\nVerifique o ambiente corporativo.\n\nHorário: ${formatTimeOnly(timestamp)}`;
}

function buildHistoryEvent(previous, current, comparison) {
  if (!previous) {
    return { at: current.checkedAt, type: "baseline", severity: "info", summary: `Baseline criado: total ${current.total ?? "—"}, ${current.items.length} item(ns).` };
  }
  const changed = comparison.added.length || comparison.removed.length || (comparison.delta !== null && comparison.delta !== 0);
  if (!changed) return null;
  const parts = [];
  if (comparison.delta !== null && comparison.delta !== 0) parts.push(`total ${previous.total}→${current.total} (${comparison.delta > 0 ? "+" : ""}${comparison.delta})`);
  if (comparison.added.length) parts.push(`+ ${comparison.added.join(", ")}`);
  if (comparison.removed.length) parts.push(`- ${comparison.removed.join(", ")}`);
  return { at: current.checkedAt, type: "change", severity: comparison.added.length || comparison.delta > 0 ? "attention" : "info", summary: parts.join(" • ") };
}

async function appendHistory(event) {
  const { monitorHistory = [] } = await chrome.storage.local.get("monitorHistory");
  await chrome.storage.local.set({ monitorHistory: [event, ...monitorHistory].slice(0, MAX_HISTORY) });
}

async function updateBadge(total) {
  const text = typeof total === "number" ? (total > 999 ? "999+" : String(total)) : "";
  await chrome.action.setBadgeText({ text });
}

async function showNotification({ title, message }) {
  await chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL("icon128.png"), title, message, priority: 2 });
}

async function testLocalAlert() {
  await showNotification({ title: "Web Monitor — teste local", message: "Notificação local funcionando corretamente." });
  const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
  if (monitorConfig?.soundEnabled !== false) await playSound();
  await setChannelSuccess("local");
  return { ok: true };
}

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
    if (contexts.length) return;
  }
  await chrome.offscreen.createDocument({ url: OFFSCREEN_URL, reasons: ["AUDIO_PLAYBACK"], justification: "Reproduzir som quando houver alteração." });
}

async function playSound() {
  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({ type: "PLAY_SOUND" });
}

async function markHealthSuccess(config) {
  const { monitorHealth } = await chrome.storage.local.get("monitorHealth");
  const wasError = monitorHealth?.status === "error";
  const next = {
    status: "healthy",
    consecutiveFailures: 0,
    lastSuccessAt: Date.now(),
    lastErrorAt: monitorHealth?.lastErrorAt || null,
    lastError: null
  };
  await chrome.storage.local.set({ monitorHealth: next });
  if (!wasError) return;

  const delivery = await dispatchHealthChannels(config, "recovery");
  await appendHistory({
    at: Date.now(), type: "health-recovery", severity: "info",
    summary: `Monitor recuperado • Desktop: ${delivery.local} • Telegram: ${delivery.telegram} • Automação: ${delivery.automation}`
  });
}

async function markHealthFailure(config, errorMessage) {
  const { monitorHealth } = await chrome.storage.local.get("monitorHealth");
  const failures = (monitorHealth?.consecutiveFailures || 0) + 1;
  const status = failures >= HEALTH_FAILURE_THRESHOLD ? "error" : "warning";
  const becameError = status === "error" && monitorHealth?.status !== "error";
  const next = {
    status,
    consecutiveFailures: failures,
    lastSuccessAt: monitorHealth?.lastSuccessAt || null,
    lastErrorAt: Date.now(),
    lastError: errorMessage
  };
  await chrome.storage.local.set({ monitorHealth: next });
  if (!becameError) return;

  const delivery = await dispatchHealthChannels(config, "health_error", failures, next.lastSuccessAt);
  await appendHistory({
    at: Date.now(), type: "health-error", severity: "critical",
    summary: `Monitor com problema após ${failures} falhas • Desktop: ${delivery.local} • Telegram: ${delivery.telegram} • Automação: ${delivery.automation}`
  });
}

async function dispatchHealthChannels(config, kind, failures = 0, lastSuccessAt = null) {
  const delivery = { local: "disabled", telegram: "disabled", automation: "disabled" };

  if (config.notificationsEnabled !== false) {
    try {
      const title = kind === "recovery" ? `${config.name || "Monitor"} — recuperado` : `${config.name || "Monitor"} — monitor com problema`;
      const message = kind === "recovery"
        ? "A leitura voltou a funcionar normalmente."
        : `Falha em ${failures} verificações consecutivas. Última leitura válida: ${lastSuccessAt ? formatDateTime(lastSuccessAt) : "não disponível"}.`;
      await showNotification({ title, message });
      delivery.local = "sent";
      await setChannelSuccess("local");
    } catch (error) {
      delivery.local = "error";
      await setChannelError("local", error.message);
    }
  }

  if (kind === "health_error" && config.soundEnabled !== false) {
    try { await playSound(); } catch {}
  }

  if (config.telegramEnabled && config.telegramBotToken && config.telegramChatId) {
    try {
      await sendTelegramMessage(config, sanitizedText(kind, Date.now()));
      delivery.telegram = "sent";
      await setChannelSuccess("telegram");
    } catch (error) {
      delivery.telegram = "error";
      await setChannelError("telegram", error.message);
    }
  }

  if (config.automationEnabled && config.automationWebhookUrl) {
    try {
      await sendAutomationWebhook(config, kind === "recovery" ? "monitor_recovered" : "monitor_error", Date.now());
      delivery.automation = "sent";
      await setChannelSuccess("automation");
    } catch (error) {
      delivery.automation = "error";
      await setChannelError("automation", error.message);
    }
  }

  return delivery;
}

async function setChannelSuccess(channel) {
  const { channelStatus } = await chrome.storage.local.get("channelStatus");
  const value = normalizeChannelStatus(channelStatus);
  value[channel] = { ...value[channel], status: channel === "local" ? "ready" : "connected", lastSuccessAt: Date.now(), lastError: null };
  await chrome.storage.local.set({ channelStatus: value });
}

async function setChannelError(channel, message) {
  const { channelStatus } = await chrome.storage.local.get("channelStatus");
  const value = normalizeChannelStatus(channelStatus);
  value[channel] = { ...value[channel], status: "error", lastErrorAt: Date.now(), lastError: message };
  await chrome.storage.local.set({ channelStatus: value });
}

async function ensureRemotePermission(pattern) {
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) throw new Error("Permissão de acesso ao serviço remoto ainda não foi concedida. Use o botão Testar/Conectar na extensão.");
}

async function sendTelegramMessage(config, text) {
  await ensureRemotePermission("https://api.telegram.org/*");
  const token = String(config.telegramBotToken || "").trim();
  const chatId = String(config.telegramChatId || "").trim();
  if (!token || !chatId) throw new Error("Token do bot ou Chat ID ausente.");

  const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw new Error(data.description || `Telegram respondeu HTTP ${response.status}.`);
  return data;
}

async function testTelegram() {
  const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
  if (!monitorConfig?.telegramBotToken) throw new Error("Informe o token do bot primeiro.");
  if (!monitorConfig?.telegramChatId) throw new Error("Informe ou descubra o Chat ID primeiro.");
  try {
    await sendTelegramMessage(monitorConfig, sanitizedText("test", Date.now()));
    await setChannelSuccess("telegram");
    await appendHistory({ at: Date.now(), type: "telegram-test", severity: "info", summary: "Teste do Telegram enviado com sucesso." });
    return { ok: true };
  } catch (error) {
    await setChannelError("telegram", error.message);
    throw error;
  }
}

async function discoverTelegramChat() {
  const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
  const token = String(monitorConfig?.telegramBotToken || "").trim();
  if (!token) throw new Error("Informe o token do bot primeiro.");
  await ensureRemotePermission("https://api.telegram.org/*");

  try {
    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates`);
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw new Error(data.description || `Telegram respondeu HTTP ${response.status}.`);
    const updates = Array.isArray(data.result) ? [...data.result].reverse() : [];
    let chat = null;
    for (const update of updates) {
      chat = update.message?.chat || update.edited_message?.chat || update.channel_post?.chat || update.edited_channel_post?.chat;
      if (chat?.id !== undefined) break;
      chat = null;
    }
    if (!chat) throw new Error("Nenhuma conversa encontrada. Envie uma mensagem para o bot e tente novamente.");
    const next = { ...monitorConfig, telegramChatId: String(chat.id) };
    await chrome.storage.local.set({ monitorConfig: next });
    await setChannelSuccess("telegram");
    return {
      ok: true,
      chatId: String(chat.id),
      chatName: chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "Conversa"
    };
  } catch (error) {
    await setChannelError("telegram", error.message);
    throw error;
  }
}

async function sendAutomationWebhook(config, event, timestamp) {
  const url = String(config.automationWebhookUrl || "").trim();
  if (!url) throw new Error("URL do webhook não configurada.");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("O webhook de automação precisa usar HTTPS.");
  await ensureRemotePermission(`${parsed.origin}/*`);

  // Payload intencionalmente sanitizado: nenhum ID, quantidade, nome de fila ou URL interna.
  const payload = {
    schemaVersion: 1,
    source: "web-monitor",
    event,
    occurredAt: new Date(timestamp).toISOString()
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Webhook respondeu HTTP ${response.status}.`);
  return true;
}

async function testAutomationWebhook() {
  const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
  if (!monitorConfig?.automationWebhookUrl) throw new Error("Informe a URL do webhook primeiro.");
  try {
    await sendAutomationWebhook(monitorConfig, "test", Date.now());
    await setChannelSuccess("automation");
    await appendHistory({ at: Date.now(), type: "automation-test", severity: "info", summary: "Teste da automação enviado com sucesso." });
    return { ok: true };
  } catch (error) {
    await setChannelError("automation", error.message);
    throw error;
  }
}

async function beginElementPicker(selectionType) {
  if (!["counter", "items"].includes(selectionType)) throw new Error("Tipo de seleção inválido.");

  const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
  if (!monitorConfig?.boundUrl) throw new Error("Crie primeiro a aba dedicada.");

  const tab = await ensureDedicatedTabReady(monitorConfig, { refresh: false });
  if (!tab) throw new Error("Não foi possível preparar a aba dedicada para seleção.");

  // Primeiro remove pickers antigos sem usar allFrames. Falhas em um frame não derrubam os demais.
  await executeInFramesBestEffort(tab.id, cleanupPicker, []);
  const injections = await executeInFramesBestEffort(tab.id, installPicker, [selectionType]);
  const successCount = injections.filter((entry) => entry.ok).length;

  if (!successCount) {
    const firstError = injections.find((entry) => !entry.ok)?.error || "Nenhum frame acessível.";
    throw new Error(`Não consegui ativar o seletor visual nesta página. ${firstError}`);
  }

  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  return { ok: true, frames: successCount };
}

async function handleElementSelected(message, sender) {
  const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
  if (!monitorConfig) throw new Error("Configuração do monitor não encontrada.");
  if (!["counter", "items"].includes(message.selectionType)) throw new Error("Seleção inválida.");

  const next = { ...monitorConfig };
  if (message.selectionType === "counter") {
    next.counterSelector = String(message.selector || "").trim();
    next.counterLocator = message.locator || null;
  } else {
    next.itemSelector = String(message.selector || "").trim();
    next.itemLocator = message.locator || null;
  }

  await chrome.storage.local.set({
    monitorConfig: next,
    lastSelection: {
      type: message.selectionType,
      selector: String(message.selector || "").trim(),
      locator: message.locator || null,
      matchedCount: message.matchedCount ?? null,
      sampleText: message.sampleText || "",
      at: Date.now()
    }
  });

  if (sender.tab?.id) await executeInFramesBestEffort(sender.tab.id, cleanupPicker, []);
  return { ok: true };
}

function installPicker(selectionType) {
  const BANNER_ID = "__web_monitor_picker_banner";
  const OVERLAY_ID = "__web_monitor_picker_overlay";

  function cleanupLocal() {
    const state = globalThis.__webMonitorPicker;
    if (state) {
      document.removeEventListener("pointermove", state.onMove, true);
      document.removeEventListener("keydown", state.onKey, true);
      document.removeEventListener("click", state.onClick, true);
    }
    document.getElementById(state?.BANNER_ID || BANNER_ID)?.remove();
    document.getElementById(state?.OVERLAY_ID || OVERLAY_ID)?.remove();
    delete globalThis.__webMonitorPicker;
  }

  // A função injetada precisa ser autocontida: referências externas não são
  // transportadas pelo chrome.scripting.executeScript().
  cleanupLocal();

  function cssEscape(value) {
    return globalThis.CSS?.escape
      ? CSS.escape(String(value))
      : String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
  }

  function attrEscape(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function countInRoot(root, selector) {
    try { return root?.querySelectorAll ? root.querySelectorAll(selector).length : 0; } catch { return 0; }
  }

  function stableAttributes(element) {
    return ["data-cy", "data-testid", "data-test", "data-qa", "name", "aria-label", "role"]
      .map((name) => [name, element.getAttribute?.(name)])
      .filter(([, value]) => value);
  }

  function uniqueSelectorInRoot(element, root) {
    if (!(element instanceof Element) || !root?.querySelectorAll) return "";

    if (element.id) {
      const selector = `#${cssEscape(element.id)}`;
      if (countInRoot(root, selector) === 1) return selector;
    }

    const tag = element.tagName.toLowerCase();
    for (const [name, value] of stableAttributes(element)) {
      const selector = `${tag}[${name}="${attrEscape(value)}"]`;
      if (countInRoot(root, selector) === 1) return selector;
    }

    const classes = [...element.classList].filter((name) => !name.startsWith("__web_monitor")).slice(0, 3);
    if (classes.length) {
      const selector = tag + classes.map((name) => `.${cssEscape(name)}`).join("");
      if (countInRoot(root, selector) === 1) return selector;
    }

    if (tag.includes("-") && countInRoot(root, tag) === 1) return tag;

    // Caminho relativo ao root atual. Pode usar nth-of-type como último recurso,
    // mas nunca tenta atravessar uma fronteira de Shadow DOM com CSS puro.
    const parts = [];
    let current = element;
    while (current && current instanceof Element) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part = `#${cssEscape(current.id)}`;
        parts.unshift(part);
        break;
      }
      const usefulClasses = [...current.classList].filter((name) => !name.startsWith("__web_monitor")).slice(0, 2);
      if (usefulClasses.length) part += usefulClasses.map((name) => `.${cssEscape(name)}`).join("");
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((node) => node.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      const candidate = parts.join(" > ");
      if (countInRoot(root, candidate) === 1) return candidate;
      current = parent;
    }
    return parts.join(" > ");
  }

  function patternSelectorInRoot(element, root) {
    if (!(element instanceof Element) || !root?.querySelectorAll) return null;
    const tag = element.tagName.toLowerCase();
    const candidates = [];

    for (const [name, value] of stableAttributes(element)) {
      const selector = `${tag}[${name}="${attrEscape(value)}"]`;
      const count = countInRoot(root, selector);
      if (count > 1) candidates.push({ selector, count, score: 100 - Math.min(count, 50) / 10 });
    }

    const classes = [...element.classList].filter((name) => !name.startsWith("__web_monitor")).slice(0, 3);
    if (classes.length) {
      const selector = tag + classes.map((name) => `.${cssEscape(name)}`).join("");
      const count = countInRoot(root, selector);
      if (count > 1) candidates.push({ selector, count, score: 75 - Math.min(count, 50) / 10 });
    }

    if (tag.includes("-")) {
      const count = countInRoot(root, tag);
      if (count > 1) candidates.push({ selector: tag, count, score: 55 - Math.min(count, 50) / 10 });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  function shadowChainFor(element) {
    const chain = [];
    let root = element.getRootNode();
    while (root instanceof ShadowRoot) {
      const host = root.host;
      const parentRoot = host.getRootNode();
      const hostSelector = uniqueSelectorInRoot(host, parentRoot);
      if (!hostSelector) return null;
      chain.unshift(hostSelector);
      root = parentRoot;
    }
    return chain;
  }

  function buildLocator(element, targetSelector, mode, count) {
    const chain = shadowChainFor(element);
    if (!chain) return null;
    return {
      version: 1,
      mode,
      shadowChain: chain,
      targetSelector,
      matchedCount: count,
      usesShadowDom: chain.length > 0
    };
  }

  function eventElements(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    return path.filter((node) => node instanceof Element && node.id !== BANNER_ID && node.id !== OVERLAY_ID);
  }

  function chooseCounter(path) {
    const candidates = [];
    for (const element of path) {
      const root = element.getRootNode();
      const selector = uniqueSelectorInRoot(element, root);
      if (!selector) continue;
      const hasValue = [element.getAttribute?.("value"), element.value, element.getAttribute?.("aria-valuenow")]
        .some((value) => value !== undefined && value !== null && String(value).trim() !== "");
      const tag = element.tagName.toLowerCase();
      const stable = stableAttributes(element).length > 0;
      let score = hasValue ? 150 : 0;
      if (element.id) score += 80;
      if (stable) score += 55;
      if (tag.includes("-")) score += 30;
      score -= selector.length / 100;
      candidates.push({ element, selector, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  function chooseItems(path) {
    const candidates = [];
    for (const element of path) {
      const root = element.getRootNode();
      const pattern = patternSelectorInRoot(element, root);
      if (pattern) candidates.push({ element, ...pattern });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length) return candidates[0];

    // Fila com apenas um item: aceita seletor único do ancestral mais semântico.
    for (const element of path) {
      const root = element.getRootNode();
      const selector = uniqueSelectorInRoot(element, root);
      if (selector) return { element, selector, count: 1, score: 1 };
    }
    return null;
  }

  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.textContent = selectionType === "counter"
    ? "Web Monitor • Clique no contador da fila • ESC cancela"
    : "Web Monitor • Clique em um item/chamado da lista • ESC cancela";
  Object.assign(banner.style, {
    position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
    zIndex: "2147483647", background: "#111827", color: "#fff", padding: "11px 16px",
    borderRadius: "10px", font: "600 12px/1.35 Arial,sans-serif", boxShadow: "0 8px 30px rgba(0,0,0,.28)",
    pointerEvents: "none", maxWidth: "480px", textAlign: "center"
  });
  if (window.top === window) document.documentElement.appendChild(banner);

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: "fixed", zIndex: "2147483646", pointerEvents: "none", border: "3px solid #2563eb",
    background: "rgba(37,99,235,.08)", borderRadius: "6px", boxSizing: "border-box", display: "none"
  });
  document.documentElement.appendChild(overlay);

  function updateOverlay(element) {
    if (!(element instanceof Element)) { overlay.style.display = "none"; return; }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) { overlay.style.display = "none"; return; }
    Object.assign(overlay.style, {
      display: "block", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`
    });
  }

  function onMove(event) { updateOverlay(eventElements(event)[0] || event.target); }
  function onKey(event) { if (event.key === "Escape") cleanupLocal(); }
  function onClick(event) {
    const path = eventElements(event);
    if (!path.length) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const chosen = selectionType === "counter" ? chooseCounter(path) : chooseItems(path);
    if (!chosen) return;
    const locator = buildLocator(chosen.element, chosen.selector, selectionType === "counter" ? "single" : "list", chosen.count || 1);
    const sampleText = chosen.element.getAttribute?.("value") || chosen.element.textContent?.trim() || chosen.element.getAttribute?.("aria-label") || "";

    chrome.runtime.sendMessage({
      type: "ELEMENT_SELECTED",
      selectionType,
      selector: chosen.selector,
      locator,
      matchedCount: chosen.count || 1,
      sampleText: String(sampleText).slice(0, 160)
    });
    cleanupLocal();
  }

  globalThis.__webMonitorPicker = { onMove, onKey, onClick, BANNER_ID, OVERLAY_ID };
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("click", onClick, true);
}

function cleanupPicker() {
  const state = globalThis.__webMonitorPicker;
  if (state) {
    document.removeEventListener("pointermove", state.onMove, true);
    document.removeEventListener("keydown", state.onKey, true);
    document.removeEventListener("click", state.onClick, true);
  }
  document.getElementById(state?.BANNER_ID || "__web_monitor_picker_banner")?.remove();
  document.getElementById(state?.OVERLAY_ID || "__web_monitor_picker_overlay")?.remove();
  delete globalThis.__webMonitorPicker;
}

function formatDateTime(timestamp) { return new Date(timestamp).toLocaleString(); }
function formatTimeOnly(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
