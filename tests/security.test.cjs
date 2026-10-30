const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers.cjs');

function message(h, payload, sender) {
  return new Promise(resolve => h.events.message(payload,sender,resolve));
}
test('only the popup can read status or change configuration', async () => {
  const h=harness();
  const denied=await message(h,{type:'GET_STATUS'},{id:'fixture-extension',tab:{id:1},url:h.store.monitorConfig.boundUrl});
  assert.equal(denied.ok,false);
  const allowed=await message(h,{type:'GET_STATUS'},{id:'fixture-extension',url:h.chrome.runtime.getURL('popup.html')});
  assert.equal(allowed.ok,true);
});
test('picker messages from another tab/session are rejected', async () => {
  const h=harness();h.store.pickerSession={state:'READY',id:'session',tabId:1,revision:1,selectionType:'items',at:100000};
  h.context.payload={sessionId:'wrong',selectionType:'items',locator:{shadowChain:[],targetSelector:'.id'}};
  h.context.sender={tab:{id:2},url:h.store.monitorConfig.boundUrl,frameId:0};
  await assert.rejects(h.run('handleElementSelected(payload,sender)'));
  assert.equal(h.store.monitorConfig.itemSelector,'.id');
});
test('valid picker session records frame provenance and invalidates previous baseline', async () => {
  const h=harness();h.store.monitorSnapshot=h.snapshot(1,['1']);
  h.store.pickerSession={state:'READY',id:'session',tabId:1,revision:1,selectionType:'items',at:100000};
  h.context.payload={sessionId:'session',selectionType:'items',locator:{shadowChain:[],targetSelector:'.new-id'}};
  h.context.sender={tab:{id:1},url:'https://fixture.invalid/frame',frameId:2};
  h.run('executeInFramesBestEffort=async()=>[]');
  await h.run('handleElementSelected(payload,sender)');
  assert.equal(h.store.monitorConfig.itemLocator.frameUrl,'https://fixture.invalid/frame');
  assert.equal(h.store.monitorSnapshot,null);assert.equal(h.store.pickerSession,null);
});
test('expired picker session does not modify configuration', async () => {
  const h=harness();h.store.pickerSession={state:'READY',id:'session',tabId:1,revision:1,selectionType:'items',at:100000};h.tick(121000);
  h.context.payload={sessionId:'session',selectionType:'items',locator:{shadowChain:[],targetSelector:'.new'}};
  h.context.sender={tab:{id:1},url:h.store.monitorConfig.boundUrl,frameId:0};
  await assert.rejects(h.run('handleElementSelected(payload,sender)'));assert.equal(h.store.monitorConfig.itemSelector,'.id');
});
test('remote fetch enforces timeout without exposing URL in errors', async () => {
  const h=harness();
  h.context.setTimeout=fn=>setTimeout(fn,1);
  h.context.fetch=(_url,opts)=>new Promise((_resolve,reject)=>{
    opts.signal.addEventListener('abort',()=>reject(Object.assign(new Error('private URL'),{name:'AbortError'})));
  });
  await assert.rejects(h.run('fetchRemote("https://fixture.invalid/private")'),e=>e.message==='O serviço remoto excedeu o prazo de resposta.');
});
test('remote fetch rejects redirects and omits browser credentials', async () => {
  const h=harness();let seen;
  h.context.fetch=async (_url,options)=>{seen=options;return {ok:true,status:200,text:async()=>'{}'}};
  await h.run('fetchRemote("https://fixture.invalid/webhook")');
  assert.equal(seen.redirect,'error');assert.equal(seen.credentials,'omit');
});
test('discovering a Telegram conversation does not silently save the recipient', async () => {
  const h=harness();h.store.monitorConfig.telegramBotToken='fixture';h.store.monitorConfig.telegramChatId='old-recipient';
  h.context.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({ok:true,result:[{message:{chat:{id:123,title:'Fixture'}}}]})});
  const result=await h.run('discoverTelegramChat()');
  assert.equal(result.chatId,'123');assert.equal(h.store.monitorConfig.telegramChatId,'old-recipient');
});
test('webhooks refuse non-HTTPS destinations and send only minimized event data', async () => {
  const h=harness();
  await assert.rejects(h.run('sendAutomationWebhook({automationWebhookUrl:"http://fixture.invalid"},"test",1)'));
  let body;h.context.fetch=async(_url,opts)=>{body=JSON.parse(opts.body);return {ok:true,status:204,text:async()=>''}};
  await h.run('sendAutomationWebhook({automationWebhookUrl:"https://fixture.invalid"},"queue_changed",1)');
  assert.deepEqual(Object.keys(body).sort(),['event','occurredAt','schemaVersion','source']);
});
test('audio failure is visible while a successful Desktop delivery stays successful', async () => {
  const h=harness();h.store.monitorConfig.soundEnabled=true;
  h.chrome.runtime.sendMessage=async()=>({ok:false});
  await assert.rejects(h.run('testLocalAlert()'));
  assert.equal(h.store.channelStatus.local.status,'ready');assert.equal(h.store.channelStatus.sound.status,'error');
});
test('backend rejects invalid intervals and insecure webhook configuration', async () => {
  const h=harness();
  for(const patch of [{intervalMinutes:Infinity},{automationWebhookUrl:'http://fixture.invalid'}]) {
    h.context.patch=patch;await assert.rejects(h.run('saveMonitorConfig(patch)'));
  }
});
