const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, core } = require('./helpers.cjs');
const { createMonitorStorage } = require('../src/core/storage.js');
const { dailyInsights } = require('../src/core/insights.js');

test('migration is idempotent and preserves snapshots, history and preferences', async () => {
  const raw={monitorConfig:{name:'Existing',soundEnabled:false,telegramBotToken:'fixture-only'},
    monitorSnapshot:{total:8,items:['1']},monitorHistory:[{at:1,type:'change',summary:'Old event'}]};
  const local={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(raw[k])])),
    set:async values=>Object.assign(raw,structuredClone(values))};
  const storage=createMonitorStorage(local);
  const before=structuredClone(raw);
  await storage.migrate();const first=structuredClone(raw);await storage.migrate();
  assert.deepEqual(raw,first);assert.deepEqual(raw.monitorSnapshot,before.monitorSnapshot);
  assert.deepEqual(raw.monitorHistory,before.monitorHistory);
  assert.equal(raw.monitorConfig.telegramBotToken,'fixture-only');assert.equal(raw.monitorConfig.soundEnabled,false);
  assert.equal(raw.monitorConfig.id,'legacy');assert.equal(raw.monitorCatalog.length,1);
});
test('queue reading identity stays compatible with the v0.5.1 snapshot', () => {
  const config={type:'queue',boundUrl:'https://fixture.invalid',counterSelector:'#count',itemSelector:'.id'};
  assert.equal(core.readingKey(config),JSON.stringify([config.boundUrl,'#count','.id',null,null]));
  assert.notEqual(core.readingKey({...config,type:'visual'}),core.readingKey(config));
});

test('two monitors keep alarms, baselines and history independent', async () => {
  const h=harness();await h.run('storageReady');h.store.monitorSnapshot=h.snapshot(1,['1']);
  const created=await h.run('handleMessage({type:"CREATE_MONITOR",monitorType:"queue"})');
  h.context.newId=created.config.id;
  await h.run('saveMonitorConfig({boundUrl:"https://fixture.invalid/other",counterSelector:"#c",enabled:true},newId)');
  await h.run('scheduleAlarm(5,"legacy")');assert.equal(h.alarms.size,2);
  await h.run('appendHistory({at:1,type:"change",summary:"New monitor"},newId)');
  assert.equal(h.store.monitorHistory,undefined);
  assert.equal(h.store[`monitor:${created.config.id}`].monitorHistory.length,1);
  await h.run('handleMessage({type:"STOP_MONITORING",monitorId:newId})');
  assert.equal(h.alarms.size,1);assert.equal(h.store.monitorConfig.enabled,true);
  assert.equal(h.store.monitorSnapshot.total,1);
});

test('an in-flight check stays with its monitor when the user switches details', async () => {
  const h=harness();await h.run('storageReady');h.store.monitorSnapshot=h.snapshot(1,['1']);
  const created=await h.run('handleMessage({type:"CREATE_MONITOR"})');
  await h.run('monitorStorage.select("legacy")');
  let release, signal;const started=new Promise(r=>{signal=r});h.context.started=signal;
  h.context.gate=new Promise(r=>{release=r});h.context.next=h.snapshot(2,['1','2']);
  h.run('ensureDedicatedTabReady=async()=>({id:1});captureWithRetry=async()=>{started();await gate;return next}');
  const operation=h.run('runCheck({source:"alarm",monitorId:"legacy"})');await started;
  h.context.other=created.config.id;await h.run('handleMessage({type:"SELECT_MONITOR",monitorId:other})');release();
  await operation;assert.equal(h.store.monitorSnapshot.total,2);
  assert.equal(h.store[`monitor:${created.config.id}`].monitorSnapshot,undefined);
});

test('persisted monitors, insights and sound survive another worker instance', async () => {
  const h=harness();await h.run('storageReady');
  const created=await h.run('handleMessage({type:"CREATE_MONITOR"})');h.context.id=created.config.id;
  await h.run('saveMonitorConfig({soundId:"bell",soundEnabled:false},id)');
  h.context.snapshot={total:3,items:[],value:'3',checkedAt:Date.now()};
  await h.run('monitorStorage.set({monitorSnapshot:snapshot,monitorSamples:[{at:Date.now(),total:3}]},id)');
  const restored=harness();Object.assign(restored.store,structuredClone(h.store));await restored.run('storageReady');
  const status=await restored.run('getStatus()');assert.equal(status.config.id,created.config.id);
  assert.equal(status.config.soundId,'bell');assert.equal(status.config.soundEnabled,false);
  assert.equal(status.snapshot.value,'3');assert.equal(status.monitors.length,2);
});

test('insights count changes once, ignore delivery events and honor local today', () => {
  const now=new Date(2026,9,14,12).getTime(), morning=new Date(2026,9,14,8).getTime();
  const history=[
    {at:morning-86400000,type:'change',delta:10,idsComparable:false},
    {at:morning,type:'change',delta:1,idsComparable:true,added:['3','4'],removed:['1']},
    {at:morning+1,type:'notification',delta:100},
    {at:morning+2,type:'change',delta:-2,idsComparable:false},
    {at:morning+3,type:'change',valueChanged:true,delta:null},
    {at:morning+4,type:'change',summary:'Legacy event'}];
  const result=dailyInsights({total:8},history,[{at:morning,total:12},{at:morning+5,total:8}],now);
  assert.equal(result.added,2);assert.equal(result.removed,3);assert.equal(result.changes,4);
  assert.equal(result.peak,12);assert.equal(result.estimated,true);assert.equal(result.legacyEvents,true);
  assert.equal(result.lastChangeAt,morning+4);
});

test('text-only visual changes do not fabricate arrivals or removals', () => {
  const now=Date.now();const result=dailyInsights({total:null},[{at:now,type:'change',valueChanged:true,delta:null}],[],now);
  assert.equal(result.current,null);assert.equal(result.added,0);assert.equal(result.removed,0);assert.equal(result.changes,1);
  assert.equal(result.peak,null);
});

test('visual content changes alert while identical readings remain silent', () => {
  const previous={total:null,items:[],value:'OK',coverage:'element'};
  const current={...previous,value:'Critical'};
  const diff=core.compareSnapshots(previous,current);
  assert.equal(core.shouldAlert({type:'visual'},diff),true);
  assert.equal(core.shouldAlert({type:'visual'},core.compareSnapshots(current,current)),false);
});

test('preview must be freshly validated before a visual selection can be committed', async () => {
  const h=harness();await h.run('storageReady');
  h.store.monitorConfig.type='visual';h.store.monitorSelectionDraft={id:'draft',revision:1,
    locator:{targetSelector:'#target',shadowChain:[],frameUrl:'https://fixture.invalid/queue',stability:'stable'}};
  h.capture({total:null,items:[],value:'Expected',coverage:'element',frameUrl:h.store.monitorConfig.boundUrl});
  const preview=await h.run('previewVisualSelection("legacy")');assert.equal(preview.preview,'Expected');
  h.context.token=preview.previewToken;h.context.nextSnapshot.value='Changed';
  await assert.rejects(h.run('confirmVisualSelection("legacy",token)'));
  assert.equal(h.store.monitorConfig.visualLocator,undefined);
  const fresh=await h.run('previewVisualSelection("legacy")');h.context.token=fresh.previewToken;
  await h.run('confirmVisualSelection("legacy",token)');
  assert.equal(h.store.monitorConfig.visualLocator.targetSelector,'#target');assert.equal(h.store.monitorSelectionDraft,null);
  assert.equal(h.store.monitorConfig.enabled,false);
});

test('configured sound is passed to automatic alerts and mute prevents playback', async () => {
  const h=harness();await h.run('storageReady');
  Object.assign(h.store.monitorConfig,{soundId:'digital',soundEnabled:true,volume:0.4});
  const sent=[];h.chrome.runtime.sendMessage=async m=>{sent.push(m);return{ok:true}};
  h.context.config=h.store.monitorConfig;
  await h.run('dispatchChannels(config,{sound:true,timestamp:1,kind:"change",event:"queue_changed"})');
  assert.equal(sent[0].soundId,'digital');assert.equal(sent[0].volume,0.4);
  h.context.config.soundEnabled=false;
  await h.run('dispatchChannels(config,{sound:true,timestamp:1,kind:"change",event:"queue_changed"})');
  assert.equal(sent.length,1);
});

test('sound preview is explicit and does not save or unmute preferences', async () => {
  const h=harness();await h.run('storageReady');h.store.monitorConfig.soundEnabled=false;
  const sent=[];h.chrome.runtime.sendMessage=async m=>{sent.push(m);return{ok:true}};
  await h.run('handleMessage({type:"PREVIEW_SOUND",soundId:"critical",volume:0.5})');
  assert.equal(sent[0].soundId,'critical');assert.equal(h.store.monitorConfig.soundEnabled,false);
  await assert.rejects(h.run('handleMessage({type:"PREVIEW_SOUND",soundId:"toString"})'));
});
test('deleting one monitor clears its alarm and data but preserves the other monitor', async () => {
  const h=harness();await h.run('storageReady');h.store.monitorSnapshot=h.snapshot(8,['1']);
  const created=await h.run('handleMessage({type:"CREATE_MONITOR"})');h.context.id=created.config.id;
  await h.run('saveMonitorConfig({enabled:true},id)');
  await h.run('handleMessage({type:"DELETE_MONITOR",monitorId:id})');
  assert.equal(h.store[`monitor:${created.config.id}`],undefined);
  assert.equal(h.store.monitorSnapshot.total,8);assert.equal(h.store.activeMonitorId,'legacy');
  assert.equal(h.alarms.has('web-monitor-check:'+created.config.id),false);
});
test('alarms for every enabled monitor are reconstructed after restart', async () => {
  const h=harness();await h.run('storageReady');
  const created=await h.run('handleMessage({type:"CREATE_MONITOR"})');h.context.id=created.config.id;
  await h.run('saveMonitorConfig({enabled:true},id)');h.alarms.clear();
  await h.run('restoreAlarm()');assert.equal(h.alarms.size,2);
  assert.ok(h.alarms.has('web-monitor-check:legacy'));assert.ok(h.alarms.has('web-monitor-check:'+created.config.id));
});
