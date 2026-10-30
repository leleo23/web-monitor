const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {harness}=require('./helpers.cjs');
test('storage hardening failure does not prevent migration and alarm restoration',async()=>{
 const h=harness();h.chrome.storage.local.setAccessLevel=async()=>{throw Error('unsupported')};
 await h.run('initializeStorage()');await h.run('restoreAlarm()');assert.equal(h.alarms.size,1);
});
test('closed dedicated tab never adopts another matching user tab, persists replacement before capture',async()=>{
 const h=harness();await h.run('storageReady');let queried=false;
 h.chrome.tabs.get=async id=>{if(id===1)throw Error('closed');return{id,status:'complete',url:h.store.monitorConfig.boundUrl}};
 h.chrome.tabs.query=async()=>{queried=true;return[{id:88,url:h.store.monitorConfig.boundUrl}]};
 h.chrome.tabs.create=async()=>({id:77,status:'complete',url:h.store.monitorConfig.boundUrl});
 h.context.config=h.store.monitorConfig;await h.run('ensureDedicatedTabReady(config)');
 assert.equal(queried,false);assert.equal(h.store.monitorConfig.tabId,77);
});
test('audio is prohibited for health, recovery and normal polls in both layers',async()=>{
 const h=harness();await h.run('storageReady');h.store.monitorConfig.soundEnabled=true;h.context.config=h.store.monitorConfig;
 for(const kind of ['health_error','recovery','poll']) {
  await assert.rejects(h.run(`playSound(config,${JSON.stringify(kind)})`));
  const result=await h.run(`dispatchChannels(config,{kind:${JSON.stringify(kind)},sound:true,timestamp:1})`);assert.equal(result.sound,'disabled');
 }
 let listener,plays=0;const audio={pause(){},play(){plays++;return Promise.resolve()}};
 const ctx=vm.createContext({WebMonitorSounds:{pulse:{file:'alert.wav'}},document:{getElementById:()=>audio},chrome:{runtime:{id:'test',getURL:s=>s,onMessage:{addListener:f=>listener=f}}}});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../offscreen.js'),'utf8'),ctx);
 for(const reason of ['health_error','monitor_error','recovery','poll',undefined])listener({type:'PLAY_SOUND',reason,soundId:'pulse',volume:0.5},{id:'test'},()=>{});
 assert.equal(plays,0);
 for(const reason of ['manual_test','queue_change'])await new Promise(resolve=>listener({type:'PLAY_SOUND',reason,soundId:'pulse',volume:0.5},{id:'test'},resolve));
 assert.equal(plays,2);
});
test('interval is clamped and incomplete integrations cannot be enabled',async()=>{
 const h=harness();await h.run('storageReady');await h.run('saveMonitorConfig({intervalMinutes:0})');assert.equal(h.store.monitorConfig.intervalMinutes,1);
 await h.run('saveMonitorConfig({intervalMinutes:9999})');assert.equal(h.store.monitorConfig.intervalMinutes,1440);
 await assert.rejects(h.run('saveMonitorConfig({telegramEnabled:true})'));
 await assert.rejects(h.run('saveMonitorConfig({automationEnabled:true})'));
});
