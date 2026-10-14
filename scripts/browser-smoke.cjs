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
    if (!['popup.html','popup.js','popup.css','icon48.png'].includes(name)) {
      response.writeHead(404); response.end(); return;
    }
    const mime = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : 'text/html';
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

    result = await capture({counterSelector:'now-badge',itemSelector:'.id'});
    assert.equal(result.total,1); assert.deepEqual(result.items,['INC0012345']);
    passed('legacy deep selector fallback');

    result = await capture({counterSelector:'[',itemSelector:'.id'});
    assert.equal(result.counterFound,false); assert.ok(result.invalidItems>0);
    passed('invalid CSS selector rejects the capture');

    const ui = await browser.newPage();
    const errors=[]; ui.on('pageerror',error=>errors.push(error.message));
    await ui.exposeFunction('mockExtensionMessage', async message => h.json(await h.run(`handleMessage(${JSON.stringify(message)})`)));
    await ui.addInitScript(() => {
      window.chrome = {
        runtime:{sendMessage: message=>window.mockExtensionMessage(message)},
        storage:{onChanged:{addListener:fn=>{window.storageChanged=fn}}},
        permissions:{contains:async()=>true,request:async()=>true}
      };
    });
    await ui.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
    await ui.waitForFunction(()=>document.querySelector('#monitorStatus').textContent==='Monitorando');
    assert.equal(await ui.locator('.channel').count(),4);
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
    assert.deepEqual(errors,[]);
    console.log(`${checks}/${checks} browser fixture/UI checks passed; extension APIs were simulated.`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode=1; });
