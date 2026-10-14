/* Monitor-scoped persistence. Mutating calls are serialized by the worker. */
(function (root) {
  function createMonitorStorage(local) {
    const legacyId = "legacy";
    async function migrate() {
      const data = await local.get(["monitorSchemaVersion", "monitorCatalog", "activeMonitorId", "monitorConfig"]);
      if (data.monitorSchemaVersion === 2 && Array.isArray(data.monitorCatalog)) return;
      const catalog = data.monitorConfig ? [{ id: legacyId }] : [];
      const update = { monitorSchemaVersion: 2, monitorCatalog: catalog, activeMonitorId: catalog[0]?.id || null };
      if (data.monitorConfig) update.monitorConfig = {
        ...data.monitorConfig, id: legacyId, type: data.monitorConfig.type || "queue",
        createdAt: data.monitorConfig.createdAt || Date.now(), soundId: data.monitorConfig.soundId || "pulse"
      };
      // Keep existing snapshot/history/credentials in their original keys.
      await local.set(update);
    }
    async function catalog() { return (await local.get("monitorCatalog")).monitorCatalog || []; }
    async function active() { return (await local.get("activeMonitorId")).activeMonitorId || legacyId; }
    async function get(keys, id) {
      id = id || await active();
      if (id === legacyId) return local.get(keys);
      const data = (await local.get(`monitor:${id}`))[`monitor:${id}`] || {};
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]));
    }
    async function set(values, id) {
      id = id || await active();
      if (id === legacyId) {
        const entries = await catalog();
        if (values.monitorConfig && !entries.some(entry => entry.id === legacyId)) {
          return local.set({ ...values, monitorCatalog: [...entries, { id: legacyId }], activeMonitorId: legacyId });
        }
        return local.set(values);
      }
      const key = `monitor:${id}`;
      const data = (await local.get(key))[key] || {};
      await local.set({ [key]: { ...data, ...values } });
    }
    async function create(config) {
      const entries = await catalog();
      if (entries.length >= 20) throw new Error("Limite de 20 monitores nesta instalação.");
      await local.set({ [`monitor:${config.id}`]: { monitorConfig: config, monitorHistory: [], monitorSamples: [] },
        monitorCatalog: [...entries, { id: config.id }], activeMonitorId: config.id });
    }
    async function select(id) {
      if (!(await catalog()).some(entry => entry.id === id)) throw new Error("Monitor não encontrado.");
      await local.set({ activeMonitorId: id });
    }
    async function remove(id) {
      const entries = await catalog();
      if (!entries.some(entry => entry.id === id)) throw new Error("Monitor não encontrado.");
      const remaining = entries.filter(entry => entry.id !== id);
      if (id === legacyId) await local.remove([
        "monitorConfig", "monitorSnapshot", "monitorHistory", "monitorHealth", "monitorLastError", "channelStatus",
        "lastSelection", "monitorPendingSnapshot", "monitorEffectError", "monitorSamples", "monitorSelectionDraft", "pickerSession", "monitorReading"
      ]);
      else await local.remove(`monitor:${id}`);
      const current = await active();
      await local.set({ monitorCatalog: remaining, activeMonitorId: current === id ? remaining[0]?.id || null : current });
    }
    return { migrate, get, set, catalog, active, create, select, remove };
  }
  root.createMonitorStorage = createMonitorStorage;
  if (typeof module !== "undefined" && module.exports) module.exports = { createMonitorStorage };
})(globalThis);
