// DOM and popup regression checks. Chrome extension APIs are simulated here;
// this does not replace manual testing of an installed MV3 extension.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { harness, root } = require('../tests/helpers.cjs');

(async () => {
  const options = { headless:true };
  if (process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(options);
  const server = http.createServer((request, response) => {
    const name = request.url.slice(1);
    if (!['popup.html','popup.js','popup.css','icon48.png','alert.wav','sounds/bell.wav','sounds/digital.wav','sounds/critical.wav'].includes(name)) {
      response.writeHead(404); response.end(); return;
    }
    const mime = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : name.endsWith('.wav') ? 'audio/wav' : 'text/html';
    response.setHeader('Content-Type', mime);
    response.end(fs.readFileSync(path.join(root,name)));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let checks=0;
  const passed = name => { checks++; console.log(`PASS: ${name}`); };
  try {
    const page = await browser.newPage();
    const h = harness();
    const capture = config => page.evaluate(h.context.captureFrameState, config);
    await page.setContent('<span id="count">Mostrando 1-2 de 2</span><table><tr><td data-cy="id">370415</td><td data-cy="id">370415</td><td data-cy="id">370416</td></tr></table>');
    let result = await capture({counterSelector:'#count',itemSelector:'td[data-cy="id"]'});
    assert.equal(result.total,2); assert.deepEqual(result.items,['370415','370416']);
    passed('SysAid pagination and duplicate IDs');

    await page.setContent('<span id="count">Fila 8, atualizada às 14:32</span><span class="id">Carregando...</span>');
    result = await capture({counterSelector:'#count',itemSelector:'.id'});
    assert.equal(result.total,null); assert.equal(result.invalidItems,1);
    passed('time labels and loading text are not queue data');

    await page.setContent('<span id="count" value="ignored" aria-label="Contador da fila">1.234</span>');
    result = await capture({counterSelector:'#count'}); assert.equal(result.total,1234);
    passed('invalid attributes do not hide a valid counter');

    await page.setContent('<outer-host></outer-host>');
    await page.evaluate(() => {
      const a=document.querySelector('outer-host').attachShadow({mode:'open'});
      a.innerHTML='<inner-host></inner-host>';
      const b=a.querySelector('inner-host').attachShadow({mode:'open'});
      b.innerHTML='<now-badge value="1"></now-badge><span class="id">INC0012345</span>';
    });
    result = await capture({counterSelector:'now-badge',itemSelector:'.id',
      counterLocator:{shadowChain:['outer-host','inner-host'],targetSelector:'now-badge'},
      itemLocator:{shadowChain:['outer-host','inner-host'],targetSelector:'.id'}});
    assert.equal(result.total,1); assert.deepEqual(result.items,['INC0012345']);
    passed('nested open Shadow DOM locators');
    await page.evaluate(()=>{
      window.starScans=0;window.nativeDocumentQuery=Document.prototype.querySelectorAll;window.nativeShadowQuery=ShadowRoot.prototype.querySelectorAll;
      Document.prototype.querySelectorAll=function(selector){if(selector==='*')window.starScans++;return window.nativeDocumentQuery.call(this,selector)};
      ShadowRoot.prototype.querySelectorAll=function(selector){if(selector==='*')window.starScans++;return window.nativeShadowQuery.call(this,selector)};
    });
    await capture({counterLocator:{shadowChain:['outer-host','inner-host'],targetSelector:'now-badge'},itemLocator:{shadowChain:['outer-host','inner-host'],targetSelector:'.id'}});
    assert.equal(await page.evaluate(()=>window.starScans),0);
    await capture({counterSelector:'now-badge',itemSelector:'.id'});
    assert.equal(await page.evaluate(()=>window.starScans),3);
    await page.evaluate(()=>{Document.prototype.querySelectorAll=window.nativeDocumentQuery;ShadowRoot.prototype.querySelectorAll=window.nativeShadowQuery});
    passed('valid locators skip deep scans and fallback shares a lazy root index');

    result = await capture({counterSelector:'now-badge',itemSelector:'.id'});
    assert.equal(result.total,1); assert.deepEqual(result.items,['INC0012345']);
    passed('legacy deep selector fallback');

    result = await capture({counterSelector:'[',itemSelector:'.id'});
    assert.equal(result.counterFound,false); assert.ok(result.invalidItems>0);
    passed('invalid CSS selector rejects the capture');
    await page.setContent('<span id="count">Mostrando 1-2 de 2</span><table><tr><td data-cy="id">370415</td><td data-cy="id">370416</td></tr></table>');
    let detected=await page.evaluate(h.context.detectQueueFrame);
    assert.equal(detected[0].preset,'SysAid');assert.equal(detected[0].total,2);assert.ok(detected[0].confidence>=90);
    passed('SysAid preset suggests a semantic counter and collection');
    await page.setContent('<span id="count">Showing 1-2 of 2</span><table><tr><td>INC001</td><td>INC002</td></tr></table>');
    detected=await page.evaluate(h.context.detectQueueFrame);assert.equal(detected[0].preset,'ServiceNow');
    passed('ServiceNow signals select a preset without hardcoded domains');
    await page.evaluate(()=>{document.body.innerHTML='<x-list></x-list>';document.querySelector('x-list').attachShadow({mode:'open'}).innerHTML='<span id="count">Mostrando 1-2 de 2</span><table><tr><td data-cy="id">370415</td><td data-cy="id">370416</td></tr></table>'});
    detected=await page.evaluate(h.context.detectQueueFrame);assert.deepEqual(detected[0].counterLocator.shadowChain,['x-list']);
    passed('detector preserves Shadow DOM source paths');
    await page.setContent('<span id="pagination_toggle">1 de 1</span><table id="queue"><thead><tr><th>ID</th></tr></thead><tbody><tr><td data-cy="id">402123</td></tr></tbody></table>');
    detected=await page.evaluate(h.context.detectQueueFrame);
    assert.ok(detected.length);const resilient={...detected[0],type:'queue'};
    assert.equal(resilient.itemSelector.includes('402123'),false);
    result=await capture(resilient);assert.equal(result.total,1);assert.deepEqual(result.items,['402123']);
    await page.evaluate(()=>{document.querySelector('tbody').replaceChildren();document.querySelector('#pagination_toggle').textContent='0 de 0'});
    result=await capture(resilient);assert.equal(result.total,0);assert.deepEqual(result.items,[]);assert.equal(h.context.WebMonitorCore.classifySnapshot(resilient,result),'VALID_EMPTY');
    passed('one-ticket automatic configuration survives an empty queue with compact pagination');
    detected=await page.evaluate(h.context.detectQueueFrame);assert.ok(detected.length);result=await capture({...detected[0],type:'queue'});assert.equal(result.total,0);
    passed('empty startup learns the persistent ID column when evidence is sufficient');
    await page.evaluate(()=>{document.querySelector('#pagination_toggle').remove();document.querySelector('tbody').innerHTML='<tr><td colspan="2">No records found</td></tr>'});
    result=await capture(resilient);assert.equal(result.total,0);assert.equal(result.structureFound,true);
    passed('a scoped empty marker remains valid when pagination is absent');
    for(const text of ['0 de 0','0 resultados','Nenhum chamado','No records found','No results']){
      await page.evaluate(text=>{document.querySelector('tbody').innerHTML='<tr><td colspan="2"></td></tr>';document.querySelector('td').textContent=text},text);
      result=await capture(resilient);assert.equal(h.context.WebMonitorCore.classifySnapshot(resilient,result),'VALID_EMPTY');
    }
    passed('all requested scoped empty-state phrases are valid operational states');
    await page.evaluate(()=>document.querySelector('#queue').remove());
    result=await capture(resilient);assert.equal(h.context.WebMonitorCore.classifySnapshot(resilient,result),'INVALID_CAPTURE');
    passed('missing queue structure is not converted into a healthy empty queue');
    await page.setContent('<div>No results</div>');assert.deepEqual(await page.evaluate(h.context.detectQueueFrame),[]);
    passed('empty text alone cannot fake a successful automatic configuration');
    await page.setContent('<div id="pager">1-3 de 3</div><table id="tickets"><tbody><tr><td data-cy="id">402123</td></tr><tr><td data-cy="id">402124</td></tr><tr><td data-cy="id">402125</td></tr></tbody></table>');
    detected=await page.evaluate(h.context.detectQueueFrame);assert.ok(detected.length);const reusable={...detected[0],type:'queue'};
    await page.evaluate(()=>{document.querySelector('tbody').innerHTML='<tr><td data-cy="id">INC001</td></tr><tr><td data-cy="id">INC002</td></tr><tr><td data-cy="id">INC003</td></tr>'});
    result=await capture(reusable);assert.deepEqual(result.items,['INC001','INC002','INC003']);
    passed('complete ticket replacement keeps structural locators reusable');

    await page.setContent('<div id="target" data-testid="queue-indicator">Critical incidents: 3</div>');
    await page.evaluate(() => { window.chrome={runtime:{getManifest:()=>({version:"0.6.0"}),sendMessage:async message=>{window.sentSelection=message;return {ok:true}}}}; });
    await page.evaluate(h.context.installPicker,'visual');
    await page.locator('#target').hover();
    assert.equal(await page.locator('#__web_monitor_picker_overlay').evaluate(el=>el.style.display),'block');
    await page.locator('#target').click();
    await page.waitForFunction(()=>Boolean(window.sentSelection));
    const selected=await page.evaluate(()=>window.sentSelection);
    assert.equal(selected.selectionType,'visual');
    assert.ok(selected.locator.fallbacks.includes('div[data-testid="queue-indicator"]'));
    assert.equal(await page.locator('#__web_monitor_picker_overlay').count(),0);
    passed('visual picker highlights, selects semantic fallbacks and cleans up listeners');

    await page.evaluate(()=>{document.querySelector('#target').id='changed-id'});
    result=await capture({type:'visual',visualLocator:selected.locator});
    assert.equal(result.visualFound,true);assert.equal(result.value,'Critical incidents: 3');
    passed('visual monitor survives a changed primary ID through its semantic fallback');

    await page.setContent('<input type="password" id="private" value="fixture-value">');
    result=await capture({type:'visual',visualLocator:{shadowChain:[],targetSelector:'#private'}});
    assert.equal(result.visualFound,false);assert.equal(result.value,'');
    passed('password inputs are not captured by a visual monitor');

    await page.setContent('<div id="target">3</div>');
    await page.evaluate(h.context.installPicker,'visual');await page.keyboard.press('Escape');
    assert.equal(await page.locator('#__web_monitor_picker_overlay').count(),0);
    assert.equal(await page.evaluate(()=>Boolean(window.__webMonitorPicker)),false);
    passed('Escape cancels selection without a retained picker');

    const ui = await browser.newPage();
    const errors=[]; ui.on('pageerror',error=>errors.push(error.message));
    await ui.exposeFunction('mockExtensionMessage', async message => h.json(await h.run(`handleMessage(${JSON.stringify(message)})`)));
    await ui.addInitScript(() => {
      window.chrome = {
        runtime:{getManifest:()=>({version:"0.6.0"}),sendMessage: message=>window.mockExtensionMessage(message)},
        storage:{onChanged:{addListener:fn=>{window.storageChanged=fn}}},
        permissions:{contains:async()=>true,request:async()=>true}
      };
    });
    await ui.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
    await ui.waitForFunction(()=>document.querySelector('#monitorStatus').textContent==='Monitorando');
    assert.equal(await ui.locator('.channel').count(),5);
    passed('real popup initializes with separate Desktop and audio status');

    await ui.locator('[data-tab="setup"]').click();
    await ui.locator('#monitorName').fill('Nome em edição');
    h.store.monitorSnapshot=h.snapshot(1,['370415']);
    await ui.evaluate(()=>window.storageChanged({},'local'));
    await ui.waitForFunction(()=>document.querySelector('#totalValue').textContent==='1');
    assert.equal(await ui.locator('#monitorName').inputValue(),'Nome em edição');
    h.store.monitorConfig.enabled=false;
    await ui.evaluate(()=>window.storageChanged({},'local'));
    await ui.waitForFunction(()=>document.querySelector('#monitorStatus').textContent==='Pausado');
    assert.equal(await ui.locator('#monitorName').inputValue(),'Nome em edição');
    passed('live updates preserve unsaved form edits');

    await ui.locator('#alertOnRemovedItem').check();
    await ui.locator('#saveBtn').click();
    await ui.waitForFunction(()=>document.querySelector('#toast').textContent==='Configuração salva.');
    assert.equal(h.store.monitorConfig.alertOnRemovedItem,true);
    assert.equal(h.store.monitorConfig.name,'Nome em edição');
    passed('removal preference and form changes persist through real UI commands');

    h.store.monitorHistory=Array.from({length:80},(_,i)=>({at:i+1,summary:'Fixture '+i}));
    h.store.monitorPendingSnapshot=h.snapshot(0,[]);
    await ui.evaluate(()=>window.storageChanged({},'local'));
    await ui.waitForFunction(()=>document.querySelectorAll('.history-row').length===80);
    assert.equal(await ui.locator('#healthStatus').textContent(),'🟡 Aguardando confirmação');
    passed('all retained history entries and pending empty-state indicator');

    await ui.locator('[data-tab="dashboard"]').click();
    assert.equal(await ui.locator('.monitor-card').count(),1);
    assert.ok((await ui.locator('#globalCurrent').textContent()).includes('1'));
    await ui.locator('.monitor-card .monitor-name').click();
    await ui.waitForFunction(()=>document.querySelector('#tab-details').classList.contains('active'));
    passed('Home shows persisted monitors and opens their details');

    await ui.locator('[data-tab="integrations"]').click();
    await ui.locator('#soundId').selectOption('bell');await ui.locator('#soundEnabled').uncheck();
    await ui.locator('#saveSoundBtn').click();
    await ui.waitForFunction(()=>document.querySelector('#toast').textContent==='Configuração salva.');
    assert.equal(h.store.monitorConfig.soundId,'bell');assert.equal(h.store.monitorConfig.soundEnabled,false);
    assert.equal(await ui.locator('#soundId option').count(),4);
    passed('four local sounds, selected preference and mute persist through the UI');

    h.store.monitorPendingSnapshot=null;
    h.store.monitorConfig.type='visual';
    h.store.monitorSelectionDraft={id:'ui-draft',revision:h.store.monitorConfig.revision,
      locator:{targetSelector:'#target',shadowChain:[],frameUrl:'about:blank',stability:'fragile'},preview:'3'};
    h.capture({total:3,items:[],value:'3',coverage:'element',frameUrl:'about:blank'});
    await ui.evaluate(()=>window.storageChanged({},'local'));
    await ui.waitForFunction(()=>!document.querySelector('#confirmSelectionBtn').disabled);
    assert.equal(await ui.locator('#visualPreviewText').textContent(),'3');
    assert.ok((await ui.locator('#selectorWarning').textContent()).includes('pode mudar'));
    await ui.locator('#confirmSelectionBtn').click();
    await ui.waitForFunction(()=>document.querySelector('#tab-details').classList.contains('active'));
    assert.equal(h.store.monitorConfig.visualLocator.targetSelector,'#target');
    assert.equal(h.store.monitorSelectionDraft,null);
    passed('validated visual preview, instability warning and confirmation are connected in the real popup');
    const durations=await ui.evaluate(async()=>{
      const context=new OfflineAudioContext(1,22050,22050);
      const durations=[];
      for(const file of ['alert.wav','sounds/bell.wav','sounds/digital.wav','sounds/critical.wav']) {
        const data=await(await fetch(file)).arrayBuffer();
        durations.push((await context.decodeAudioData(data)).duration);
      }
      return durations;
    });
    assert.equal(durations.length,4);assert.ok(durations.every(duration=>duration>0 && duration<2));
    passed('all four bundled audio files decode successfully in Chromium');
    if (process.env.WEB_MONITOR_SCREENSHOT) {
      h.tick(Date.now()-100000);
      Object.assign(h.store.monitorConfig,{name:'SysAid — SOC N2',type:'queue',enabled:true});
      h.store.monitorSnapshot={total:8,items:['370415','370416'],coverage:'visible',checkedAt:Date.now()};
      h.store.monitorSamples=[{at:Date.now()-3600000,total:5},{at:Date.now(),total:8}];
      h.store.monitorHistory=[{type:'change',at:Date.now()-300000,summary:'+3 itens no total',delta:3,idsComparable:false}];
      await ui.setViewportSize({width:500,height:760});
      await ui.evaluate(()=>window.storageChanged({},'local'));
      await ui.locator('[data-tab="dashboard"]').click();
      await ui.waitForFunction(()=>document.querySelector('#globalCurrent').textContent==='8');
      await ui.screenshot({path:process.env.WEB_MONITOR_SCREENSHOT,fullPage:true});
    }
    assert.deepEqual(errors,[]);
    console.log(`${checks}/${checks} browser fixture/UI checks passed; extension APIs were simulated.`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode=1; });
