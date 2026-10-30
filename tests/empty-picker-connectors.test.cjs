const test=require('node:test'),assert=require('node:assert/strict');
const {harness,core}=require('./helpers.cjs');
const {EmailConnector,createAlertConnectors,dispatchConnectors}=require('../src/core/connectors.js');
test('capture states reject missing structure and accept a confirmed empty structure',()=>{
 const config={counterSelector:'#pager',itemSelector:'.id',queueLocator:{targetSelector:'#queue'}};
 assert.equal(core.classifySnapshot(config,{counterFound:true,total:0,items:[],structureFound:true,invalidItems:0}),'VALID_EMPTY');
 assert.equal(core.classifySnapshot(config,{counterFound:true,total:0,items:[],structureFound:false}),'INVALID_CAPTURE');
 assert.equal(core.classifySnapshot(config,{counterFound:true,total:1,items:['402123'],structureFound:true}),'VALID_WITH_ITEMS');
});
test('structure validation allows changing tickets but not invalid/loading captures',async()=>{
 const h=harness();h.context.samples=[{foundSomething:true,snapshot:{frameUrl:'same',total:1,items:['402123']}},{foundSomething:true,snapshot:{frameUrl:'same',total:3,items:['4','5','6']}}];
 h.run('captureAllFrames=async()=>samples.shift()');assert.equal((await h.run('validateQueueStructure(1,{})')).total,3);
});
test('picker focuses first and requires injected READY on the first request',async()=>{
 const h=harness();await h.run('storageReady');const order=[];
 h.chrome.windows.update=async()=>{order.push('focus')};
 h.context.injected=(_tab,func,args)=>{if(func.name==='installPicker'){order.push('inject');return [{ok:true,result:{type:'PICKER_READY',sessionId:args[1]}}]}return []};
 h.run('executeInFramesBestEffort=async(...args)=>injected(...args)');
 const result=await h.run('beginElementPicker("counter","legacy")');
 assert.equal(result.type,'PICKER_READY');assert.deepEqual(order,['focus','inject']);assert.equal(h.store.pickerSession.state,'READY');
 const id=h.store.pickerSession.id;h.context.msg={monitorId:'legacy',sessionId:id};h.context.sender={tab:{id:1}};
 await h.run('cancelPicker(msg,sender)');assert.equal(h.store.pickerSession,null);assert.equal(h.store.monitorPickerStatus.state,'CANCELLED');
});
test('picker error never reports READY and cleans the intent',async()=>{
 const h=harness();await h.run('storageReady');h.run('executeInFramesBestEffort=async()=>[{ok:true,result:null}]');
 await assert.rejects(h.run('beginElementPicker("items","legacy")'));assert.equal(h.store.pickerSession,null);assert.equal(h.store.monitorPickerStatus.state,'ERROR');
});
test('a ready picker is recovered after frame navigation without another popup click',async()=>{
 const h=harness();await h.run('storageReady');let injected=0;
 h.context.inject=(_tab,func,args)=>{if(func.name!=='installPicker')return [];injected++;return [{ok:true,result:{type:'PICKER_READY',sessionId:args[1]}}]};
 h.run('executeInFramesBestEffort=async(...args)=>inject(...args)');
 await h.run('beginElementPicker("items","legacy")');assert.equal(injected,1);
 h.events.navCompleted({tabId:1,frameId:2});h.events.navCompleted({tabId:1,frameId:2});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(injected,2);assert.equal(h.store.pickerSession.state,'READY');
});
test('email rejects invalid/unverified addresses and remains disabled without a backend',async()=>{
 const email=new EmailConnector();assert.equal(email.status,'DISABLED');
 await assert.rejects(email.requestVerification('invalid'),/EMAIL_INVALID/);
 await assert.rejects(email.requestVerification('user@example.invalid'),/EMAIL_BACKEND_UNAVAILABLE/);
 await assert.rejects(email.test(),/EMAIL_UNVERIFIED/);
});
test('verified email sends only minimal events and respects backend limits/errors/timeouts',async()=>{
 const payloads=[];const transport={requestVerification:async()=>({challengeId:'opaque'}),confirm:async()=>({verified:true}),send:async payload=>{payloads.push(payload)}};
 const email=new EmailConnector(transport,{timeoutMs:5});
 await email.requestVerification('user@example.invalid');await email.confirm('123456');assert.equal(email.isConfigured(),true);
 await email.test();for(const type of ['QUEUE_CHANGED','MONITOR_ERROR','MONITOR_RECOVERED'])await email.send({type,at:1,ticket:'not-sent'});
 assert.equal(payloads.length,4);for(const payload of payloads)assert.deepEqual(Object.keys(payload).sort(),['event','occurredAt']);
 transport.send=async()=>{throw {status:429,retryAfter:60}};await assert.rejects(email.test(),/EMAIL_RATE_LIMITED/);
 transport.send=async()=>{throw Error('private backend detail')};await assert.rejects(email.test(),/EMAIL_BACKEND_ERROR/);
 transport.send=()=>new Promise(()=>{});await assert.rejects(email.test(),/EMAIL_TIMEOUT/);
});
test('email failure cannot block existing channels and health never plays audio',async()=>{
 const called=[];const services=Object.fromEntries(['desktop','sound','telegram','webhook'].map(name=>[name,async()=>{called.push(name)}]));
 services.email={id:'email',isConfigured:()=>true,send:async()=>{throw Error('email down')}};
 const connectors=createAlertConnectors({telegramEnabled:true,automationEnabled:true},services);
 const delivery=await dispatchConnectors(connectors,{type:'QUEUE_CHANGED',at:1});assert.equal(delivery.email,'error');assert.deepEqual(called.sort(),['desktop','sound','telegram','webhook']);
 called.length=0;await dispatchConnectors(connectors,{type:'MONITOR_ERROR',at:1});assert.equal(called.includes('sound'),false);
});
