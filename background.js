importScripts("src/core/detection.js");
const { compareSnapshots, shouldAlert, buildHistoryEvent, readingKey, snapshotKey, validateSnapshot } = WebMonitorCore;

const ALARM_NAME = "web-monitor-check";
const OFFSCREEN_URL = "offscreen.html";
const HEALTH_FAILURE_THRESHOLD = 2;
const MAX_HISTORY = 80;
const CAPTURE_ATTEMPTS = 12;
const CAPTURE_DELAY_MS = 900;
const REMOTE_TIMEOUT_MS = 10000;
let stateQueue = Promise.resolve();
let offscreenCreation = null;

function withStateUpdate(operation) {
  const result = stateQueue.then(operation);
  stateQueue = result.catch(() => {});
  return result;
}

function readError(code, message) {
  return Object.assign(new Error(message), { code });
}

function safeError(error) {
  return String(error?.message || error || "Falha desconhecida.")
    .replace(/https?:\/\/[^\s]+/gi, "[URL omitida]")
    .replace(/(?:bot)?\d{5,}:[A-Za-z0-9_-]{15,}/g, "[token omitido]").slice(0, 400);
}

async function initializeStorage() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}
const storageReady = initializeStorage();
storageReady.catch(() => {});

async function updateMonitorConfig(patch) {
  const { monitorConfig = {} } = await chrome.storage.local.get("monitorConfig");
  const next = { ...monitorConfig, ...patch };
  delete next.resetBaseline;
  for (const field of ["counter", "item"]) {
    if (Object.hasOwn(patch, `${field}Selector`) && patch[`${field}Selector`] !== monitorConfig[`${field}Selector`] &&
        (!Object.hasOwn(patch, `${field}Locator`) || JSON.stringify(patch[`${field}Locator`]) === JSON.stringify(monitorConfig[`${field}Locator`]))) {
      next[`${field}Locator`] = null;
    }
  }
  const interval = Number(next.intervalMinutes ?? 5);
  if (!Number.isFinite(interval) || interval < 1 || interval > 1440) throw new Error("O intervalo deve ficar entre 1 e 1440 minutos.");
  next.intervalMinutes = interval;
  if (next.boundUrl && !isHttpUrl(next.boundUrl)) throw new Error("A fila precisa usar HTTP ou HTTPS.");
  if (next.automationWebhookUrl && new URL(next.automationWebhookUrl).protocol !== "https:") throw new Error("O webhook precisa usar HTTPS.");
  const changed = patch.resetBaseline === true || readingKey(next) !== readingKey(monitorConfig);
  next.revision = (monitorConfig.revision || 0) + 1;
  const values = { monitorConfig: next, pickerSession: null };
  if (changed) Object.assign(values, { monitorSnapshot: null, monitorPendingSnapshot: null, monitorHealth: null, monitorLastError: null, monitorEffectError: null, lastSelection: null });
  await chrome.storage.local.set(values);
  if (next.enabled) await scheduleAlarm(next.intervalMinutes);
  else await chrome.alarms.clear(ALARM_NAME);
  return next;
}

function saveMonitorConfig(patch) {
  return withStateUpdate(() => updateMonitorConfig(patch));
}

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
  // Audio has its own response from the offscreen document.
  if (message?.type === "PLAY_SOUND") return false;
  const task = (async () => {
    await storageReady;
    if (sender.id !== chrome.runtime.id) throw new Error("Emissor inválido.");
    if (message?.type === "ELEMENT_SELECTED") return handleElementSelected(message, sender);
    if (sender.tab || sender.url !== chrome.runtime.getURL("popup.html")) throw new Error("Comando permitido somente na interface da extensão.");
    return handleMessage(message);
  })();

  Promise.resolve(task)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: safeError(error) }));

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_STATUS":
      return { ok: true, ...(await getStatus()) };

    case "SAVE_CONFIG": {
      if (!message.config || typeof message.config !== "object" || Array.isArray(message.config)) throw new Error("Configuração inválida.");
      const next = await saveMonitorConfig(message.config);
      return { ok: true, config: next };
    }

    case "START_MONITORING": {
      const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
      if (!monitorConfig?.boundUrl) throw new Error("Crie uma aba dedicada antes de iniciar.");
      if (!monitorConfig.counterSelector && !monitorConfig.counterLocator) throw new Error("Selecione um contador para distinguir uma fila vazia de uma falha de leitura.");
      await saveMonitorConfig({ enabled: true });
      const result = await runCheck({ source: "start", refresh: false });
      return { ok: true, result };
    }

    case "STOP_MONITORING": {
      await saveMonitorConfig({ enabled: false });
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
      await withStateUpdate(() => chrome.storage.local.set({ monitorHistory: [] }));
      return { ok: true };

    default:
      return { ok: false, error: "Mensagem desconhecida." };
  }
}

async function restoreAlarm() {
  await storageReady;
  const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
  if (monitorConfig?.enabled) await scheduleAlarm(monitorConfig.intervalMinutes || 5);
  else await chrome.alarms.clear(ALARM_NAME);
}

async function scheduleAlarm(intervalMinutes) {
  const interval = Math.max(1, Number(intervalMinutes) || 5);
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
}

async function getStatus() {
  const data = await chrome.storage.local.get([
    "monitorConfig", "monitorSnapshot", "monitorHistory", "monitorLastError",
    "monitorHealth", "lastSelection", "channelStatus", "monitorPendingSnapshot", "monitorEffectError"
  ]);
  const alarm = await chrome.alarms.get(ALARM_NAME);
  return {
    config: data.monitorConfig || null,
    snapshot: data.monitorSnapshot || null,
    history: data.monitorHistory || [],
    lastError: data.monitorLastError || null,
    health: data.monitorHealth || null,
    pending: Boolean(data.monitorPendingSnapshot),
    effectError: data.monitorEffectError || null,
    lastSelection: data.lastSelection || null,
    channelStatus: normalizeChannelStatus(data.channelStatus),
    nextCheckAt: alarm?.scheduledTime || null
  };
}

function normalizeChannelStatus(value) {
  const blank = { status: "idle", lastSuccessAt: null, lastErrorAt: null, lastError: null };
  return {
    local: { ...blank, status: "ready", ...(value?.local || {}) },
    sound: { ...blank, ...(value?.sound || {}) },
    telegram: { ...blank, status: "unconfigured", ...(value?.telegram || {}) },
    automation: { ...blank, status: "unconfigured", ...(value?.automation || {}) }
  };
}

async function checkStillCurrent(config, source) {
  const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
  return monitorConfig && monitorConfig.revision === config.revision && readingKey(monitorConfig) === readingKey(config) &&
    (source === "manual" || monitorConfig.enabled === true);
}

async function recordEffectError(error) {
  await withStateUpdate(() => chrome.storage.local.set({ monitorEffectError: { message: safeError(error), at: Date.now() } }));
}

async function runCheck({ source = "manual", refresh = false } = {}) {
  await storageReady;
  if (checking) return { skipped: true, reason: "Uma verificação já está em andamento." };
  checking = true;
  let config;
  let committed = false;
  try {
    const data = await chrome.storage.local.get("monitorConfig");
    config = data.monitorConfig;
    if (!config) throw readError("SELECTOR_FAILED", "Nenhuma configuração foi salva.");
    if (source !== "manual" && !config.enabled) return { skipped: true, reason: "Monitor pausado." };
    if (source !== "manual" && !config.counterSelector && !config.counterLocator) throw readError("SELECTOR_FAILED", "Selecione um contador para validar a leitura da fila.");
    const tab = await ensureDedicatedTabReady(config, { refresh });
    if (!tab) throw readError("UNSUPPORTED_PAGE", "A aba dedicada não pôde ser preparada.");
    const snapshot = await captureWithRetry(tab.id, config);
    snapshot.checkedAt = Date.now();
    snapshot.source = source;
    snapshot.readingKey = readingKey(config);

    const result = await withStateUpdate(async () => {
      if (!(await checkStillCurrent(config, source))) return { skipped: true, reason: "Monitor pausado ou configuração alterada durante a leitura." };
      const { monitorSnapshot, monitorPendingSnapshot } = await chrome.storage.local.get(["monitorSnapshot", "monitorPendingSnapshot"]);
      // Old v0.5 snapshots lack provenance: create one safe baseline on upgrade.
      const previous = monitorSnapshot?.readingKey === snapshot.readingKey ? monitorSnapshot : null;
      if (snapshot.total === 0 && previous?.total > 0) {
        if (!monitorPendingSnapshot || monitorPendingSnapshot.readingKey !== snapshot.readingKey ||
            snapshotKey(monitorPendingSnapshot) !== snapshotKey(snapshot) || snapshot.checkedAt - monitorPendingSnapshot.checkedAt < 5000) {
          await chrome.storage.local.set({ monitorPendingSnapshot: snapshot, monitorLastError: null });
          return { pending: true, reason: "Fila vazia aguardando confirmação em outra leitura. A última leitura válida foi preservada." };
        }
      }
      const comparison = compareSnapshots(previous, snapshot);
      await chrome.storage.local.set({
        monitorSnapshot: snapshot, monitorPendingSnapshot: null, monitorLastError: null, monitorEffectError: null,
        monitorConfig: { ...config, tabId: tab.id }
      });
      return { snapshot, comparison, baselineCreated: !previous, previous };
    });
    if (result.skipped || result.pending) return result;
    committed = true;
    // Presentation and delivery failures must never invalidate a successful read.
    for (const effect of [
      () => markHealthSuccess(config, snapshot.total === 0 ? "NO_ITEMS" : "OK", source !== "manual"),
      () => updateBadge(snapshot.total),
      () => { const event = buildHistoryEvent(result.previous, snapshot, result.comparison); return event ? appendHistory(event) : undefined; }
    ]) {
      if (!(await checkStillCurrent(config, source))) break;
      try { await effect(); } catch (error) { await recordEffectError(error); }
    }
    if (source !== "manual" && result.previous && shouldAlert(config, result.comparison) && await checkStillCurrent(config, source)) {
      try { await dispatchChangeAlert(config, result.previous, snapshot, result.comparison); }
      catch (error) { await recordEffectError(error); }
    }
    const { previous, ...publicResult } = result;
    return publicResult;
  } catch (error) {
    if (committed) { await recordEffectError(error); return { effectError: safeError(error) }; }
    if (config && !(await checkStillCurrent(config, source))) return { skipped: true, reason: "Configuração alterada durante a leitura." };
    const lastError = { message: safeError(error), code: error.code || "READ_ERROR", at: Date.now() };
    await withStateUpdate(() => chrome.storage.local.set({ monitorLastError: lastError, monitorPendingSnapshot: null }));
    try { await chrome.action.setBadgeText({ text: "!" }); } catch (effectError) { await recordEffectError(effectError); }
    try { await markHealthFailure(config || {}, lastError.message, lastError.code, source !== "manual"); }
    catch (effectError) { await recordEffectError(effectError); }
    throw error;
  } finally { checking = false; }
}

async function resolveDedicatedTab(config) {
  if (config?.tabId) {
    try { return await chrome.tabs.get(config.tabId); } catch {}
  }

  const tabs = await chrome.tabs.query({});
  const exact = tabs.find((tab) => tab.url === config?.boundUrl);
  if (exact) return exact;

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
  if (tab.url !== config.boundUrl && isHttpUrl(config?.boundUrl)) {
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

  if (!top || top.errorOccurred || !isInjectableFrameUrl(top.url)) throw readError("UNSUPPORTED_PAGE", "A página não está acessível para leitura.");
  if (tab.url !== config.boundUrl) throw readError("UNSUPPORTED_PAGE", "A aba foi redirecionada. Abra a fila, verifique a sessão e vincule a fonte novamente se o endereço mudou.");

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
  throw readError("PAGE_LOADING", "A página não terminou de carregar no prazo esperado.");
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
  let previousKey = null;
  let stableReads = 0;
  let lastCode = "SELECTOR_FAILED";
  for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt += 1) {
    const result = await captureAllFrames(tabId, config);
    if (result.foundSomething) {
      const key = snapshotKey(result.snapshot);
      stableReads = key === previousKey ? stableReads + 1 : 1;
      previousKey = key;
      if (stableReads >= (result.snapshot.total === 0 ? 3 : 2)) return result.snapshot;
      lastCode = "PAGE_LOADING";
    } else { previousKey = null; stableReads = 0; lastCode = result.code; }
    if (attempt + 1 < CAPTURE_ATTEMPTS) await sleep(CAPTURE_DELAY_MS);
  }
  throw readError(lastCode, lastCode === "PAGE_LOADING"
    ? "A leitura não ficou estável ou a lista ainda está carregando. O estado anterior foi preservado."
    : "Não foi possível validar os elementos da fila. Verifique seletores, sessão e permissões dos iframes.");
}

async function captureAllFrames(tabId, config) {
  const frameResults = await executeInFramesBestEffort(tabId, captureFrameState, [{
    counterSelector: config.counterSelector || "", itemSelector: config.itemSelector || "",
    counterLocator: config.counterLocator || null, itemLocator: config.itemLocator || null
  }]);
  const results = frameResults.filter((entry) => entry.ok && entry.result)
    .map((entry) => ({ frameId: entry.frameId, ...entry.result }));
  const counterUrl = config.counterLocator?.frameUrl;
  const itemUrl = config.itemLocator?.frameUrl;
  let candidates;
  // Cross-frame composition is allowed only when the user explicitly selected both sources.
  if (counterUrl && itemUrl && counterUrl !== itemUrl) {
    const counters = results.filter((r) => r.href === counterUrl && r.counterFound && Number.isSafeInteger(r.total));
    const lists = results.filter((r) => r.href === itemUrl && (!r.invalidItems && (r.items.length || counters[0]?.total === 0)));
    if (counters.length !== 1 || lists.length !== 1) return { foundSomething: false, code: "SELECTOR_FAILED" };
    candidates = [{ ...lists[0], total: counters[0].total, counterFound: true, counterText: counters[0].counterText,
      readyState: counters[0].readyState === "loading" ? "loading" : lists[0].readyState,
      counterFrameUrl: counterUrl, itemFrameUrl: itemUrl }];
  } else {
    const url = counterUrl || itemUrl;
    candidates = results.filter((r) => !url || r.href === url);
  }
  const valid = candidates.filter((r) => !validateSnapshot(config, r));
  if (valid.length !== 1) return { foundSomething: false,
    code: valid.length > 1 ? "SELECTOR_FAILED" : (candidates.map((r) => validateSnapshot(config, r)).find(Boolean) || "SELECTOR_FAILED") };
  const selected = valid[0];
  return { foundSomething: true, snapshot: {
    total: selected.total, counterText: selected.counterText, items: selected.items,
    frameUrl: selected.href, counterFrameUrl: selected.counterFrameUrl || selected.href,
    itemFrameUrl: selected.itemFrameUrl || selected.href,
    coverage: Number.isSafeInteger(selected.total) && selected.total === selected.items.length ? "full" : "visible"
  } };
}

function captureFrameState(config) {
  let selectorFailed = false;
  function deepAll(selector, initialRoot = document) {
    if (!selector) return [];
    const results = [];
    const seen = new Set();
    const roots = [initialRoot];

    while (roots.length) {
      const root = roots.pop();
      if (!root?.querySelectorAll) continue;
      let matches = [], elements = [];
      try {
        matches = [...root.querySelectorAll(selector)];
        elements = [...root.querySelectorAll("*")];
      } catch {
        selectorFailed = true;
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

  function deepOne(selector, initialRoot = document) {
    if (!selector) return null;
    const roots = [initialRoot];
    while (roots.length) {
      const root = roots.pop();
      try {
        const match = root.querySelector(selector);
        if (match) return match;
        for (const element of root.querySelectorAll("*")) if (element.shadowRoot) roots.push(element.shadowRoot);
      } catch { selectorFailed = true; }
    }
    return null;
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

  function parseCounter(text) {
    const value = String(text || "").trim();
    const integer = "(?:\\d{1,3}(?:[.,]\\d{3})+|\\d+)";
    const plain = new RegExp(`^(${integer})$`).exec(value);
    const pagination = new RegExp(`^(?:Mostrando|Showing)\\s+${integer}\\s*[-–]\\s*${integer}\\s+(?:de|of)\\s+(${integer})$`, "i").exec(value);
    const label = new RegExp(`^(?:(${integer})\\s+(?:itens?|items?|chamados?|tickets?)|(?:itens?|items?|chamados?|tickets?)\\s*:?\\s*(${integer}))$`, "i").exec(value);
    const matched = plain?.[1] || pagination?.[1] || label?.[1] || label?.[2];
    if (!matched) return null;
    const number = Number(matched.replace(/[.,]/g, ""));
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
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
      if (candidate !== undefined && candidate !== null && parseCounter(candidate) !== null) {
        return String(candidate).trim();
      }
    }
    return "";
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
  const total = parseCounter(counterText);
  const values = itemElements.map(readItem);
  // Numeric SysAid IDs and identifiers such as INC0012345; whole-row text is not an ID.
  const validId = (value) => /^(?:[A-Za-z][A-Za-z_-]*)?\d+[A-Za-z0-9._/-]*$/.test(value);
  const invalidItems = values.filter((value) => !validId(value)).length;
  const items = [...new Set(values.filter(validId))];

  return {
    total,
    counterText,
    items,
    counterFound: Boolean(counter) && !selectorFailed,
    invalidItems: invalidItems + (selectorFailed ? 1 : 0),
    readyState: document.readyState,
    href: location.href,
    isTop: window.top === window
  };
}

function deliverySummary(delivery) {
  const labels = { local: "Desktop", sound: "Som", telegram: "Telegram", automation: "Automação" };
  const states = { sent: "enviado", error: "falhou", disabled: "desativado", cancelled: "cancelado" };
  return Object.entries(delivery).map(([key, value]) => `${labels[key]}: ${states[value]}`).join(" • ");
}

async function dispatchChannels(config, details) {
  const delivery = {};
  const providers = [
    ["local", config.notificationsEnabled !== false, () => showNotification(details)],
    ["sound", details.sound && config.soundEnabled !== false, playSound],
    ["telegram", config.telegramEnabled === true, () => sendTelegramMessage(config, sanitizedText(details.kind, details.timestamp))],
    ["automation", config.automationEnabled === true, () => sendAutomationWebhook(config, details.event, details.timestamp)]
  ];
  await Promise.all(providers.map(async ([channel, enabled, send]) => {
    delivery[channel] = "disabled";
    if (!enabled) return;
    if (!(await checkStillCurrent(config, "alarm"))) { delivery[channel] = "cancelled"; return; }
    try { await send(); delivery[channel] = "sent"; await setChannelSuccess(channel); }
    catch (error) { delivery[channel] = "error"; await setChannelError(channel, safeError(error)); }
  }));
  return delivery;
}

async function dispatchChangeAlert(config, previous, current, comparison) {
  const delivery = await dispatchChannels(config, {
    title: buildLocalTitle(config, comparison), message: buildLocalMessage(previous, current, comparison),
    kind: "change", event: "queue_changed", timestamp: current.checkedAt, sound: true
  });
  await appendHistory({ at: current.checkedAt, type: "notification",
    severity: Object.values(delivery).includes("error") ? "warning" : "info",
    summary: `Resultado dos alertas • ${deliverySummary(delivery)}`, delivery });
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

async function appendHistory(event) {
  await withStateUpdate(async () => {
    const { monitorHistory = [] } = await chrome.storage.local.get("monitorHistory");
    await chrome.storage.local.set({ monitorHistory: [event, ...monitorHistory].slice(0, MAX_HISTORY) });
  });
}

async function updateBadge(total) {
  const text = typeof total === "number" ? (total > 999 ? "999+" : String(total)) : "";
  await chrome.action.setBadgeText({ text });
}

async function showNotification({ title, message }) {
  await chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL("icon128.png"), title, message, priority: 2 });
}

async function testLocalAlert() {
  try {
    await showNotification({ title: "Web Monitor — teste local", message: "Notificação local funcionando corretamente." });
    await setChannelSuccess("local");
  } catch (error) { await setChannelError("local", safeError(error)); throw error; }
  const { monitorConfig } = await chrome.storage.local.get("monitorConfig");
  if (monitorConfig?.soundEnabled !== false) {
    try { await playSound(); await setChannelSuccess("sound"); }
    catch (error) { await setChannelError("sound", safeError(error)); throw new Error("Notificação Desktop enviada, mas o áudio falhou."); }
  }
  return { ok: true };
}

async function ensureOffscreenDocument() {
  if (offscreenCreation) return offscreenCreation;
  offscreenCreation = (async () => {
    const url = chrome.runtime.getURL(OFFSCREEN_URL);
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
    if (!contexts.length) await chrome.offscreen.createDocument({ url: OFFSCREEN_URL, reasons: ["AUDIO_PLAYBACK"], justification: "Reproduzir som quando houver alteração." });
  })();
  try { await offscreenCreation; } finally { offscreenCreation = null; }
}

async function playSound() {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ type: "PLAY_SOUND" });
  if (!response?.ok) throw new Error("Não foi possível reproduzir o alerta sonoro.");
}

async function markHealthSuccess(config, code = "OK", notify = true) {
  const wasError = await withStateUpdate(async () => {
    if (!(await checkStillCurrent(config, "manual"))) return false;
    const { monitorHealth } = await chrome.storage.local.get("monitorHealth");
    await chrome.storage.local.set({ monitorHealth: {
      status: "healthy", code, consecutiveFailures: 0, lastSuccessAt: Date.now(),
      lastErrorAt: monitorHealth?.lastErrorAt || null, lastError: null
    } });
    return monitorHealth?.status === "error";
  });
  if (!wasError || !notify) return;
  const delivery = await dispatchHealthChannels(config, "recovery");
  await appendHistory({ at: Date.now(), type: "health-recovery", severity: "info",
    summary: `Monitor recuperado • ${deliverySummary(delivery)}`, delivery });
}

async function markHealthFailure(config, errorMessage, code = "READ_ERROR", notify = true) {
  const transition = await withStateUpdate(async () => {
    if (!(await checkStillCurrent(config, "manual"))) return { becameError: false };
    const { monitorHealth } = await chrome.storage.local.get("monitorHealth");
    const failures = (monitorHealth?.consecutiveFailures || 0) + 1;
    const status = failures >= HEALTH_FAILURE_THRESHOLD ? "error" : "warning";
    const next = { status, code, consecutiveFailures: failures,
      lastSuccessAt: monitorHealth?.lastSuccessAt || null, lastErrorAt: Date.now(), lastError: safeError(errorMessage) };
    await chrome.storage.local.set({ monitorHealth: next });
    return { ...next, becameError: status === "error" && monitorHealth?.status !== "error" };
  });
  if (!transition.becameError || !notify) return;
  const delivery = await dispatchHealthChannels(config, "health_error", transition.consecutiveFailures, transition.lastSuccessAt);
  await appendHistory({ at: Date.now(), type: "health-error", severity: "critical",
    summary: `Monitor com problema após ${transition.consecutiveFailures} falhas • ${deliverySummary(delivery)}`, delivery });
}

async function dispatchHealthChannels(config, kind, failures = 0, lastSuccessAt = null) {
  return dispatchChannels(config, {
    title: kind === "recovery" ? `${config.name || "Monitor"} — recuperado` : `${config.name || "Monitor"} — monitor com problema`,
    message: kind === "recovery" ? "A leitura voltou a funcionar normalmente."
      : `Falha em ${failures} verificações consecutivas. Última leitura válida: ${lastSuccessAt ? formatDateTime(lastSuccessAt) : "não disponível"}.`,
    kind, event: kind === "recovery" ? "monitor_recovered" : "monitor_error",
    timestamp: Date.now(), sound: kind === "health_error"
  });
}

async function updateChannel(channel, patch) {
  await withStateUpdate(async () => {
    const { channelStatus } = await chrome.storage.local.get("channelStatus");
    const value = normalizeChannelStatus(channelStatus);
    value[channel] = { ...value[channel], ...patch };
    await chrome.storage.local.set({ channelStatus: value });
  });
}

async function setChannelSuccess(channel) {
  await updateChannel(channel, { status: channel === "local" ? "ready" : "connected", lastSuccessAt: Date.now(), lastError: null });
}

async function setChannelError(channel, message) {
  await updateChannel(channel, { status: "error", lastErrorAt: Date.now(), lastError: safeError(message) });
}

async function fetchRemote(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: "error", credentials: "omit" });
    // Keep the timeout active while consuming the response body as well.
    const text = await response.text();
    return { ok: response.ok, status: response.status, json: () => {
      try { return JSON.parse(text); }
      catch { throw new Error("O serviço remoto respondeu em um formato inválido."); }
    } };
  } catch (error) {
    throw new Error(error.name === "AbortError" ? "O serviço remoto excedeu o prazo de resposta." : "Não foi possível acessar o serviço remoto.");
  } finally { clearTimeout(timer); }
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

  const response = await fetchRemote(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw new Error(`Telegram recusou a solicitação (HTTP ${response.status}). Verifique token, Chat ID e acesso do bot.`);
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
    const response = await fetchRemote(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates`);
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw new Error(`Telegram recusou a solicitação (HTTP ${response.status}). Verifique token, Chat ID e acesso do bot.`);
    const updates = Array.isArray(data.result) ? [...data.result].reverse() : [];
    let chat = null;
    for (const update of updates) {
      chat = update.message?.chat || update.edited_message?.chat || update.channel_post?.chat || update.edited_channel_post?.chat;
      if (chat?.id !== undefined) break;
      chat = null;
    }
    if (!chat) throw new Error("Nenhuma conversa encontrada. Envie uma mensagem para o bot e tente novamente.");
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

  const response = await fetchRemote(url, {
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
  const session = await withStateUpdate(async () => {
    const { monitorConfig: latest } = await chrome.storage.local.get("monitorConfig");
    if (latest?.revision !== monitorConfig.revision) throw new Error("A configuração mudou. Abra o seletor novamente.");
    const current = tab.id === latest.tabId ? latest : await updateMonitorConfig({ tabId: tab.id });
    const value = { id: crypto.randomUUID(), selectionType, tabId: tab.id, revision: current.revision, at: Date.now() };
    await chrome.storage.local.set({ pickerSession: value });
    return value;
  });
  const injections = await executeInFramesBestEffort(tab.id, installPicker, [selectionType, session.id]);
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
  await withStateUpdate(async () => {
    const { monitorConfig, pickerSession } = await chrome.storage.local.get(["monitorConfig", "pickerSession"]);
    if (!monitorConfig || !pickerSession || sender.tab?.id !== pickerSession.tabId ||
        message.sessionId !== pickerSession.id || message.selectionType !== pickerSession.selectionType ||
        pickerSession.revision !== monitorConfig.revision || Date.now() - pickerSession.at > 120000 ||
        !Number.isInteger(sender.frameId) || !isInjectableFrameUrl(sender.url)) throw new Error("Seleção expirada ou de outra aba. Abra o seletor novamente.");
    const locator = message.locator;
    if (!locator || !Array.isArray(locator.shadowChain) || locator.shadowChain.length > 20 ||
        !locator.shadowChain.every((value) => typeof value === "string" && value.length <= 2000) ||
        typeof locator.targetSelector !== "string" || !locator.targetSelector || locator.targetSelector.length > 2000) {
      throw new Error("Seletor inválido.");
    }
    const field = message.selectionType === "counter" ? "counter" : "item";
    await updateMonitorConfig({ [`${field}Selector`]: locator.targetSelector,
      [`${field}Locator`]: { ...locator, frameUrl: sender.url } });
    await chrome.storage.local.set({ lastSelection: {
      type: message.selectionType, selector: locator.targetSelector,
      matchedCount: Number.isSafeInteger(message.matchedCount) ? message.matchedCount : null, at: Date.now()
    } });
  });
  await executeInFramesBestEffort(sender.tab.id, cleanupPicker, []);
  return { ok: true };
}

function installPicker(selectionType, sessionId) {
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
      sessionId,
      selectionType,
      selector: chosen.selector,
      locator,
      matchedCount: chosen.count || 1,
      sampleText: String(sampleText).slice(0, 160)
    }).catch(() => {});
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
