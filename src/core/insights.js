(function (root) {
  function dailyInsights(snapshot, history = [], samples = [], now = Date.now()) {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const from = start.getTime();
    const changes = history.filter(event => event.type === "change" && event.at >= from && event.at <= now);
    let added = 0, removed = 0, estimated = false;
    for (const event of changes) {
      if (event.idsComparable) { added += event.added?.length || 0; removed += event.removed?.length || 0; }
      else if (Number.isFinite(event.delta)) {
        added += Math.max(0, event.delta); removed += Math.max(0, -event.delta); estimated = true;
      }
    }
    const points = samples.filter(sample => sample.at >= from && sample.at <= now && Number.isSafeInteger(sample.total))
      .sort((a, b) => a.at - b.at);
    let peak = null;
    for (const point of points) if (!peak || point.total > peak.total) peak = point;
    const latest = history.filter(event => event.type === "change" && event.at <= now).sort((a, b) => b.at - a.at)[0];
    return { current: snapshot?.total ?? null, added, removed, estimated, changes: changes.length,
      peak: peak?.total ?? null, peakAt: peak?.at ?? null, lastChangeAt: latest?.at ?? null,
      timeline: points, observedSince: samples[0]?.at || null,
      legacyEvents: changes.some(event => !Object.hasOwn(event, "delta") && !Object.hasOwn(event, "valueChanged")) };
  }
  function monitorStatus(config, health, pending, reading) {
    if (!config?.enabled) return { key: "paused", label: "⚪ Pausado" };
    if (reading || pending) return { key: "loading", label: "🟡 Carregando" };
    if (health?.status === "error") return { key: "error", label: "🔴 Erro" };
    if (health?.status === "warning") return { key: "warning", label: "🟠 Atenção" };
    return { key: "active", label: "🟢 Ativo" };
  }
  root.WebMonitorInsights = { dailyInsights, monitorStatus };
  if (typeof module !== "undefined" && module.exports) module.exports = root.WebMonitorInsights;
})(globalThis);
