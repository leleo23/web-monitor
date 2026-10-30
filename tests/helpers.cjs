const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const core = require('../src/core/detection.js');
const root = path.resolve(__dirname, '..');

function harness() {
  const store = {}, events = {}, alarms = new Map(), deliveries = [];
  let clock = 100000;
  const RealDate = Date;
  class ClockDate extends RealDate { static now() { return clock; } }
  const listen = name => ({ addListener(fn) { events[name] = fn; } });
  const chrome = {
    runtime: { id: 'fixture-extension', getURL: p => `chrome-extension://fixture-extension/${p}`,
      onInstalled: listen('installed'), onStartup: listen('startup'), onMessage: listen('message'),
      getContexts: async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }],
      sendMessage: async () => ({ ok: true }) },
    storage: { local: {
      setAccessLevel: async opts => { store.accessLevel = opts.accessLevel; },
      get: async keys => Object.fromEntries((keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys])
        .map(k => [k, structuredClone(store[k])])),
      set: async values => { Object.assign(store, structuredClone(values)); },
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; }
    } },
    alarms: { onAlarm: listen('alarm'), get: async n => alarms.get(n),
      clear: async n => alarms.delete(n), create: async (n, opts) => { alarms.set(n, opts); } },
    action: { setBadgeText: async () => {} },
    notifications: { create: async value => { deliveries.push(value); } },
    permissions: { contains: async () => true },
    tabs: { onUpdated:listen('tabUpdated'),get: async id => ({ id, status: 'complete', url: 'https://fixture.invalid/queue' }),
      query: async () => [], create: async () => ({ id: 1 }), update: async () => {}, reload: async () => {} },
    webNavigation: { onCompleted:listen('navCompleted'),getAllFrames: async () => [{ frameId: 0, url: 'https://fixture.invalid/queue', errorOccurred: false }] },
    windows: { update: async () => {} },
    offscreen: { createDocument: async () => {} }
  };
  const context = vm.createContext({ console, URL, setTimeout, clearTimeout, AbortController, crypto, Date: ClockDate, chrome });
  context.importScripts = (...filenames) => filenames.forEach(filename => vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context));
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  context.tick = ms => { clock += ms; };
  run('sleep = async (ms) => tick(ms)');
  const config = { revision: 1, enabled: true, intervalMinutes: 5, tabId: 1,
    boundUrl: 'https://fixture.invalid/queue', counterSelector: '#counter', itemSelector: '.id',
    soundEnabled: false, notificationsEnabled: false };
  store.monitorConfig = config;
  function snapshot(total, items) {
    return { total, items, coverage: total === items.length ? 'full' : 'visible',
      frameUrl: config.boundUrl, readingKey: core.readingKey(store.monitorConfig) };
  }
  function capture(value) {
    context.nextSnapshot = value;
    run('ensureDedicatedTabReady = async () => ({id:1}); captureWithRetry = async () => nextSnapshot');
  }
  return { store, context, chrome, events, alarms, deliveries, run, snapshot, capture,
    tick: ms => { clock += ms; }, json: value => JSON.parse(JSON.stringify(value)) };
}

module.exports = { harness, root, core };
