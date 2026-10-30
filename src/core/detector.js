// Packaged, self-contained DOM detector. Values are evidence, never selector literals.
function detectQueueFrame(){
  const suggestions=[],roots=[{root:document,chain:[]}];let visited=0;
  const idValue=/^(?:[A-Za-z][A-Za-z_-]*)?\d+[A-Za-z0-9._/-]*$/;
  const empty=/^(?:nenhum(?:a)? (?:chamado|registro|resultado|item)s?|no (?:records?(?: found)?|results?)|0 (?:resultados?|results?|registros?|records?))$/i;
  function selector(el,root){
    const tag=el.tagName.toLowerCase();
    for(const attr of ['data-testid','data-cy','data-test','data-qa','name','aria-label','role']){
      const value=el.getAttribute(attr);
      if(!value||value.length>120||/\d/.test(value))continue;
      const s=tag+'['+attr+'='+JSON.stringify(value)+']';try{if(root.querySelectorAll(s).length===1)return s;}catch{}
    }
    if(el.id&&!/\d{4,}|[a-f0-9]{12,}/i.test(el.id)){const s='#'+CSS.escape(el.id);if(root.querySelectorAll(s).length===1)return s;}
    const classes=[...el.classList].filter(v=>!/(?:css-|sc-|\d{3,}|[a-f0-9]{8,})/.test(v)).slice(0,2);
    if(classes.length){const s=tag+classes.map(v=>'.'+CSS.escape(v)).join('');if(root.querySelectorAll(s).length===1)return s;}
    return root.querySelectorAll(tag).length===1?tag:null;
  }
  function count(text){
    text=String(text).trim();if(empty.test(text))return 0;
    const number='(?:\\d{1,3}(?:[.,]\\d{3})+|\\d+)';
    const plain=new RegExp('^('+number+')$').exec(text);
    const page=new RegExp('^(?:(?:Mostrando|Showing)\\s+)?(?:'+number+'\\s*[-–]\\s*)?'+number+'\\s+(?:de|of)\\s+('+number+')$','i').exec(text);
    const digits=plain?.[1]||page?.[1];return digits?Number(digits.replace(/[.,]/g,'')):null;
  }
  for(let i=0;i<roots.length&&i<50;i++){
    const {root,chain}=roots[i],nodes=[...root.querySelectorAll('*')].slice(0,Math.max(0,5000-visited));visited+=nodes.length;
    for(const el of nodes)if(el.shadowRoot){const host=selector(el,root);if(host)roots.push({root:el.shadowRoot,chain:[...chain,host]});}
    const lists=[];
    for(const query of ['td[data-cy="id"]','[data-testid="ticket-id"]','[data-number]','td','[role="cell"]','li','a']){
      const els=[...root.querySelectorAll(query)];if(!els.length||els.length>500)continue;
      const ids=els.map(el=>el.textContent.trim());if(!ids.every(id=>idValue.test(id)))continue;
      const container=els[0].closest('table,[role="grid"],[role="list"],ul,ol');
      if(!container||!els.every(el=>container.contains(el)))continue;
      const containerSelector=selector(container,root);if(!containerSelector)continue;
      const preset=query==='td[data-cy="id"]'?'SysAid':ids.every(id=>/^(INC|RITM|CHG|REQ)\d+$/i.test(id))?'ServiceNow':'Genérico';
      lists.push({query:containerSelector+' '+query,ids:[...new Set(ids)],container,containerSelector,preset,score:query.includes('data-')?90:preset==='ServiceNow'?80:65});
    }
    // Empty startup is possible only with a persistent ID column, not a guessed ticket value.
    for(const container of root.querySelectorAll('table,[role="grid"]')){
      const primary=selector(container,root);if(!primary)continue;
      const headers=[...container.querySelectorAll('th,[role="columnheader"]')];
      const index=headers.findIndex(el=>/^(?:id|ticket(?: id)?|chamado|número|number)$/i.test(el.textContent.trim()));
      const semantic=container.querySelector('[data-cy="id"],[data-testid="ticket-id"]');
      if(index<0&&!semantic)continue;
      const query=semantic? (semantic.matches('td[data-cy="id"]')?'td[data-cy="id"]':'[data-testid="ticket-id"]') : 'tbody tr > td:nth-child('+(index+1)+'):not([colspan])';
      const values=[...container.querySelectorAll(query)].map(el=>el.textContent.trim());
      if(values.some(v=>!idValue.test(v)))continue;
      lists.push({query:primary+' '+query,ids:[...new Set(values)],container,containerSelector:primary,preset:semantic?.matches('[data-cy="id"]')?'SysAid':'Genérico',score:semantic?90:75});
    }
    for(const list of lists)for(const el of nodes){
      if(el.querySelector(list.query))continue;
      const text=String(el.getAttribute('value')??el.getAttribute('aria-valuenow')??el.textContent??'').trim();
      if(text.length>100)continue;
      if(el.closest("tbody"))continue;
      if(empty.test(text) && !/count|total|pagin/i.test(el.id))continue;
      const total=count(text);if(!Number.isSafeInteger(total)||total<list.ids.length)continue;
      const primary=selector(el,root);if(!primary||list.ids.includes(text))continue;
      const pagination=/\s(?:de|of)\s/i.test(text),semantic=el.tagName.toLowerCase().includes('badge')||el.hasAttribute('aria-valuenow')||pagination||empty.test(text);
      if(!semantic&&total!==list.ids.length)continue;
      if(total===0&&list.ids.length)continue;
      suggestions.push({preset:list.preset,confidence:Math.min(99,list.score+(semantic?9:0)),total,items:list.ids.length,examples:list.ids.slice(0,3),
        counterSelector:primary,itemSelector:list.query,
        counterLocator:{targetSelector:primary,shadowChain:chain,frameUrl:location.href},
        itemLocator:{targetSelector:list.query,shadowChain:chain,frameUrl:location.href},
        queueLocator:{targetSelector:list.containerSelector,shadowChain:chain,frameUrl:location.href}});
    }
    if(visited>=5000)break;
  }
  const unique=new Map();for(const c of suggestions.sort((a,b)=>b.confidence-a.confidence)){const key=JSON.stringify([c.counterLocator,c.itemLocator]);if(!unique.has(key))unique.set(key,c);}
  return [...unique.values()].slice(0,3);
}
if(typeof module!=='undefined')module.exports={detectQueueFrame};
