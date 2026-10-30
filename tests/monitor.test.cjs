const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers.cjs');

test('8 → 0 → 8 preserves baseline and sends no false alert', async () => {
  const h=harness(), ids=['1','2','3','4','5','6','7','8'];
  h.store.monitorSnapshot=h.snapshot(8,ids);
  h.capture(h.snapshot(0,[]));
  assert.equal((await h.run('runCheck({source:"alarm"})')).pending,true);
  assert.equal(h.store.monitorSnapshot.total,8);
  h.tick(6000);h.capture(h.snapshot(8,ids));
  const result=await h.run('runCheck({source:"alarm"})');
  assert.deepEqual(h.json(result.comparison.added),[]);
  assert.equal(h.store.monitorPendingSnapshot,null);
  assert.equal(h.store.monitorHistory,undefined);
});
test('a genuinely empty queue is committed only after another sufficiently spaced check', async () => {
  const h=harness();h.store.monitorSnapshot=h.snapshot(1,['1']);h.capture(h.snapshot(0,[]));
  await h.run('runCheck({source:"alarm"})');h.tick(6000);
  await h.run('runCheck({source:"alarm"})');
  assert.equal(h.store.monitorSnapshot.total,0);
  assert.equal(h.store.monitorHealth.code,'NO_ITEMS');
});
test('queue replacement resets baseline and clears old alarm', async () => {
  const h=harness();h.store.monitorSnapshot=h.snapshot(1,['1']);
  await h.run('scheduleAlarm(5)');
  await h.run('saveMonitorConfig({boundUrl:"https://fixture.invalid/new",enabled:false})');
  assert.equal(h.store.monitorSnapshot,null);assert.equal(h.alarms.size,0);
});
test('explicit replacement of the same URL also resets baseline', async () => {
  const h=harness();h.store.monitorSnapshot=h.snapshot(1,['1']);
  await h.run('saveMonitorConfig({resetBaseline:true})');assert.equal(h.store.monitorSnapshot,null);
});
test('manual selector edit invalidates the old visual locator', async () => {
  const h=harness();h.store.monitorConfig.counterLocator={shadowChain:[],targetSelector:'#counter'};
  h.context.patch={...h.store.monitorConfig,counterSelector:'#new'};
  await h.run('saveMonitorConfig(patch)');assert.equal(h.store.monitorConfig.counterLocator,null);
});
test('paused alarm does not prepare a tab or capture', async () => {
  const h=harness();h.store.monitorConfig.enabled=false;
  h.run('ensureDedicatedTabReady=async()=>{throw new Error("must not execute")}');
  assert.equal((await h.run('runCheck({source:"alarm"})')).skipped,true);
});
test('pause during capture discards the in-flight result', async () => {
  const h=harness();h.store.monitorSnapshot=h.snapshot(1,['1']);
  let signal; const started=new Promise(r=>{signal=r});let release;
  h.context.started=signal;h.context.gate=new Promise(r=>{release=r});h.context.nextSnapshot=h.snapshot(2,['1','2']);
  h.run('ensureDedicatedTabReady=async()=>({id:1});captureWithRetry=async()=>{started();await gate;return nextSnapshot}');
  const operation=h.run('runCheck({source:"alarm"})');await started;
  await h.run('handleMessage({type:"STOP_MONITORING"})');release();
  assert.equal((await operation).skipped,true);assert.equal(h.store.monitorSnapshot.total,1);
});
test('capture error preserves snapshot and records a typed health failure', async () => {
  const h=harness();h.store.monitorSnapshot=h.snapshot(1,['1']);
  h.run('ensureDedicatedTabReady=async()=>({id:1});captureWithRetry=async()=>{throw readError("PAGE_LOADING","loading")}');
  await assert.rejects(h.run('runCheck({source:"alarm"})'));
  assert.equal(h.store.monitorSnapshot.total,1);assert.equal(h.store.monitorHealth.code,'PAGE_LOADING');
});
test('badge failure does not invalidate the read or suppress the change notification', async () => {
  const h=harness();h.store.monitorConfig.notificationsEnabled=true;
  h.store.monitorSnapshot=h.snapshot(1,['1']);h.capture(h.snapshot(2,['1','2']));
  h.run('updateBadge=async()=>{throw new Error("badge failed")}');
  await h.run('runCheck({source:"alarm"})');
  assert.equal(h.store.monitorHealth.status,'healthy');assert.equal(h.deliveries.length,1);
  assert.equal(h.store.monitorLastError,null);assert.ok(h.store.monitorEffectError);
});
test('Ler agora never sends change/recovery notifications, even while paused', async () => {
  const h=harness();Object.assign(h.store.monitorConfig,{enabled:false,notificationsEnabled:true});
  h.store.monitorSnapshot=h.snapshot(1,['1']);h.store.monitorHealth={status:'error'};
  h.capture(h.snapshot(2,['1','2']));await h.run('runCheck({source:"manual"})');
  assert.equal(h.deliveries.length,0);assert.equal(h.store.monitorSnapshot.total,2);
});
test('unmarked legacy snapshot becomes a safe new baseline on upgrade', async () => {
  const h=harness();h.store.monitorSnapshot={total:1,items:['old']};h.capture(h.snapshot(2,['1','2']));
  assert.equal((await h.run('runCheck({source:"alarm"})')).baselineCreated,true);
  assert.equal(h.store.monitorHistory[0].type,'baseline');
});
test('concurrent history updates lose no records and retain the most recent 80', async () => {
  const h=harness();h.context.entries=Array.from({length:85},(_,at)=>({at,type:'test',summary:'fixture'}));
  await h.run('Promise.all(entries.map(event => appendHistory(event)))');
  assert.equal(h.store.monitorHistory.length,80);assert.equal(h.store.monitorHistory[0].at,84);
});
test('concurrent channel updates retain independent outcomes', async () => {
  const h=harness();await h.run('Promise.all([setChannelSuccess("local"),setChannelError("telegram","offline")])');
  assert.equal(h.store.channelStatus.local.status,'ready');assert.equal(h.store.channelStatus.telegram.status,'error');
});
test('storage access is restricted to trusted extension contexts', async () => {
  const h=harness();await h.run('storageReady');assert.equal(h.store.accessLevel,'TRUSTED_CONTEXTS');
});
test('counter/list from unrelated frames are rejected instead of merged', async () => {
  const h=harness();h.context.frames=[
    {ok:true,frameId:0,result:{counterFound:true,total:8,items:[],invalidItems:0,href:'https://fixture.invalid/a'}},
    {ok:true,frameId:1,result:{counterFound:false,total:null,items:['1'],invalidItems:0,href:'https://fixture.invalid/b'}}];
  h.run('executeInFramesBestEffort=async()=>frames');
  assert.equal((await h.run('captureAllFrames(1,{counterSelector:"#c",itemSelector:".id"})')).foundSomething,false);
});
test('explicit selected frame pair works while duplicate frame matches are rejected', async () => {
  const h=harness();h.context.frames=[
    {ok:true,frameId:0,result:{counterFound:true,total:1,items:[],invalidItems:0,href:'https://fixture.invalid/a'}},
    {ok:true,frameId:1,result:{counterFound:false,total:null,items:['1'],invalidItems:0,href:'https://fixture.invalid/b'}}];
  h.context.config={counterSelector:'#c',itemSelector:'.id',counterLocator:{frameUrl:'https://fixture.invalid/a'},itemLocator:{frameUrl:'https://fixture.invalid/b'}};
  h.run('executeInFramesBestEffort=async()=>frames');
  assert.equal((await h.run('captureAllFrames(1,config)')).foundSomething,true);
  h.context.frames.push(h.context.frames[1]);
  assert.equal((await h.run('captureAllFrames(1,config)')).foundSomething,false);
});
test('capture retries require consecutive stable valid results', async () => {
  const h=harness();h.context.samples=[
    {foundSomething:true,snapshot:h.snapshot(1,['1'])},
    {foundSomething:false,code:'PAGE_LOADING'},
    {foundSomething:true,snapshot:h.snapshot(2,['1','2'])},
    {foundSomething:true,snapshot:h.snapshot(2,['1','2'])}];
  h.run('captureAllFrames=async()=>samples.shift()');
  assert.equal((await h.run('captureWithRetry(1,{})')).total,2);assert.equal(h.context.samples.length,0);
});
test('navigation timeout is explicit rather than silently proceeding', async () => {
  const h=harness();h.chrome.tabs.get=async()=>({status:'loading'});
  await assert.rejects(h.run('waitForStableTab(1,1000)'),e=>e.code==='PAGE_LOADING');
});
test('a redirect to another page is rejected before capture', async () => {
  const h=harness();h.chrome.tabs.get=async id=>({id,status:'complete',url:'https://fixture.invalid/login'});
  h.context.config=h.store.monitorConfig;
  await assert.rejects(h.run('ensureDedicatedTabReady(config)'),e=>e.code==='UNSUPPORTED_PAGE');
});
test('recreating a closed dedicated tab keeps picker session and stored tab consistent', async () => {
  const h=harness();h.run('ensureDedicatedTabReady=async()=>({id:77});executeInFramesBestEffort=async(_tab,func,args)=>func===installPicker?[{ok:true,result:{type:"PICKER_READY",sessionId:args[1]}}]:[]');
  const result=await h.run('beginElementPicker("items")');
  assert.equal(result.ok,true);assert.equal(h.store.monitorConfig.tabId,77);
  assert.equal(h.store.pickerSession.tabId,77);
  assert.equal(h.store.pickerSession.revision,h.store.monitorConfig.revision);
});
test('automatic monitoring cannot start with an unobservable empty-queue state', async () => {
  const h=harness();h.store.monitorConfig.enabled=false;delete h.store.monitorConfig.counterSelector;
  await assert.rejects(h.run('handleMessage({type:"START_MONITORING"})'));
  assert.equal(h.store.monitorConfig.enabled,false);assert.equal(h.alarms.size,0);
});
