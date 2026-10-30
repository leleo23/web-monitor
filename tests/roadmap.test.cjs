const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./helpers.cjs');
const {exportPreferences,importPreferences}=require('../src/core/portable.js');
test('portable configuration exports only validated nonsecret enums, numbers and flags',()=>{
 const data=exportPreferences({name:'secret',boundUrl:'secret',counterSelector:'secret',webhook:'secret',telegramBotToken:'secret',history:['secret'],type:'queue',soundId:'bell',volume:0.5,soundEnabled:false});
 assert.equal(JSON.stringify(data).includes('secret'),false);
 assert.equal(importPreferences(data).soundEnabled,false);
 assert.throws(()=>importPreferences({...data,preferences:{...data.preferences,telegramBotToken:'secret'}}));
 assert.throws(()=>exportPreferences({soundId:'secret'}));
});
test('diagnostic reads do not change the baseline, health or observations',async()=>{
 const h=harness();await h.run('storageReady');h.store.monitorSnapshot=h.snapshot(8,['1']);h.store.monitorHealth={status:'healthy'};h.store.monitorSamples=[{at:1,total:8}];
 const before=structuredClone(h.store);h.capture(h.snapshot(12,['1','2']));
 const result=await h.run('handleMessage({type:"TEST_MONITOR"})');assert.equal(result.snapshot.total,12);
 assert.deepEqual(h.store,before);
});
test('detection only applies a validated suggestion after explicit confirmation',async()=>{
 const h=harness();await h.run('storageReady');h.store.monitorSnapshot=h.snapshot(8,['1']);
 h.context.candidates=[{confidence:90,preset:'SysAid',total:8,items:1,examples:['1'],counterSelector:'#new',itemSelector:'.new',counterLocator:null,itemLocator:null}];
 h.run('ensureDedicatedTabReady=async()=>({id:1});executeInFramesBestEffort=async(_tab,func)=>func===detectQueueFrame?[{ok:true,result:candidates}]:[{ok:true,frameId:0,result:{counterFound:true,total:8,items:["1"],invalidItems:0,href:"https://fixture.invalid/queue"}}]');
 const result=await h.run('handleMessage({type:"DETECT_QUEUE"})');assert.equal(h.store.monitorSnapshot.total,8);
 h.context.id=result.candidates[0].id;
 h.run('captureWithRetry=async()=>({total:8,items:["1"]})');
 await h.run('handleMessage({type:"APPLY_DETECTION",candidateId:id})');assert.equal(h.store.monitorConfig.counterSelector,'#new');assert.equal(h.store.monitorConfig.enabled,false);
});
test('import creates a paused monitor and leaves existing credentials untouched',async()=>{
 const h=harness();await h.run('storageReady');h.store.monitorConfig.telegramBotToken='fixture';
 h.context.data=exportPreferences({type:'queue',soundId:'digital',intervalMinutes:4});
 const result=await h.run('handleMessage({type:"IMPORT_CONFIG",data})');assert.equal(result.config.enabled,false);
 assert.equal(result.config.telegramBotToken,undefined);assert.equal(h.store.monitorConfig.telegramBotToken,'fixture');
});
