/* Pure functions shared by the MV3 worker and Node regression tests. */
(function (root) {
  function compareSnapshots(previous, current) {
    if (!previous) return { delta: null, added: [], removed: [], idsComparable: false };
    // Paginated/virtualized lists cannot establish which tickets entered or left.
    const idsComparable = previous.coverage === "full" && current.coverage === "full";
    const oldSet = new Set(previous.items || []);
    const newSet = new Set(current.items || []);
    return {
      delta: Number.isSafeInteger(previous.total) && Number.isSafeInteger(current.total)
        ? current.total - previous.total : null,
      added: idsComparable ? [...newSet].filter((item) => !oldSet.has(item)) : [],
      removed: idsComparable ? [...oldSet].filter((item) => !newSet.has(item)) : [],
      idsComparable
    };
  }

  function shouldAlert(config, comparison) {
    return (config.alertOnNewItem !== false && comparison.added.length > 0) ||
      (config.alertOnCountIncrease !== false && comparison.delta > 0) ||
      (config.alertOnCountDecrease === true && comparison.delta < 0) ||
      (config.alertOnRemovedItem === true && comparison.removed.length > 0);
  }

  function buildHistoryEvent(previous, current, comparison) {
    if (!previous) return {
      at: current.checkedAt, type: "baseline", severity: "info",
      summary: `Baseline criado: total ${current.total ?? "—"}, ${current.items.length} item(ns).`
    };
    if (!comparison.added.length && !comparison.removed.length && !comparison.delta) return null;
    const parts = [];
    if (comparison.delta) parts.push(`total ${previous.total}→${current.total} (${comparison.delta > 0 ? "+" : ""}${comparison.delta})`);
    if (comparison.added.length) parts.push(`+ ${comparison.added.join(", ")}`);
    if (comparison.removed.length) parts.push(`- ${comparison.removed.join(", ")}`);
    return {
      at: current.checkedAt, type: "change",
      severity: comparison.added.length || comparison.delta > 0 ? "attention" : "info",
      summary: parts.join(" • "), added: comparison.added, removed: comparison.removed,
      delta: comparison.delta, idsComparable: comparison.idsComparable
    };
  }

  function readingKey(config) {
    return JSON.stringify([config.boundUrl || "", config.counterSelector || "", config.itemSelector || "",
      config.counterLocator || null, config.itemLocator || null]);
  }

  function snapshotKey(snapshot) {
    return JSON.stringify([snapshot.total, [...snapshot.items].sort(), snapshot.frameUrl,
      snapshot.counterFrameUrl, snapshot.itemFrameUrl, snapshot.coverage]);
  }

  function validateSnapshot(config, snapshot) {
    if (snapshot.readyState === "loading") return "PAGE_LOADING";
    const counterRequired = Boolean(config.counterSelector || config.counterLocator);
    const itemsRequired = Boolean(config.itemSelector || config.itemLocator);
    if (!counterRequired && !itemsRequired) return "SELECTOR_FAILED";
    if (counterRequired && (!snapshot.counterFound || !Number.isSafeInteger(snapshot.total) || snapshot.total < 0)) return "SELECTOR_FAILED";
    if (itemsRequired && snapshot.invalidItems > 0) return "SELECTOR_FAILED";
    if (itemsRequired && !snapshot.items.length && snapshot.total !== 0) return "PAGE_LOADING";
    if (Number.isSafeInteger(snapshot.total) && snapshot.items.length > snapshot.total) return "READ_ERROR";
    return null;
  }

  const api = { compareSnapshots, shouldAlert, buildHistoryEvent, readingKey, snapshotKey, validateSnapshot };
  root.WebMonitorCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
