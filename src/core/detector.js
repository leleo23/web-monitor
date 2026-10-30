// Self-contained: injected as packaged code, never executes user-provided JS.
function detectQueueFrame(){
  const suggestions=[];const roots=[{root:document,chain:[]}];let visited=0;
  function selector(element,root){
    if(element.id){const s='#'+CSS.escape(element.id);if(root.querySelectorAll(s).length===1)return s;}
    for(const attr of ['data-cy','data-testid','data-test','aria-label','name']){
      const value=element.getAttribute(attr);if(value && value.length<120){const s=element.tagName.toLowerCase()+'['+attr+'='+JSON.stringify(value)+']';try{if(root.querySelectorAll(s).length===1)return s;}catch{}}
    }
    const tag=element.tagName.toLowerCase();return root.querySelectorAll(tag).length===1?tag:null;
  }
  for(let i=0;i<roots.length && i<50;i++){
    const {root,chain}=roots[i];
    const nodes=[...root.querySelectorAll('*')].slice(0,5000-visited);visited+=nodes.length;
    for(const el of nodes){if(el.shadowRoot){const host=selector(el,root);if(host)roots.push({root:el.shadowRoot,chain:[...chain,host]});}}
    const lists=[];
    for(const query of ['td[data-cy="id"]','[data-testid="ticket-id"]','[data-number]','td','[role="cell"]','li','a']){
      const elements=[...root.querySelectorAll(query)];if(!elements.length || elements.length>500)continue;
      const ids=elements.map(el=>el.textContent.trim());
      if(!ids.every(id=>/^(?:[A-Za-z][A-Za-z_-]*)?\d+[A-Za-z0-9._/-]*$/.test(id)))continue;
      const preset=query==='td[data-cy="id"]'?'SysAid':ids.every(id=>/^(INC|RITM|CHG|REQ)\d+$/i.test(id))?'ServiceNow':'Genérico';
      lists.push({query,ids:[...new Set(ids)],preset,score:query.includes('data-')?90:preset==='ServiceNow'?80:50});
    }
    for(const list of lists){
      for(const el of nodes){
        if(el.querySelector(list.query))continue; // A counter cannot contain the ticket collection itself.
        const text=String(el.getAttribute('value')??el.getAttribute('aria-valuenow')??el.textContent??'').trim();
        if(text.length>100)continue;
        const pagination=/^(?:Mostrando|Showing)\s+[\d.,]+\s*[-–]\s*[\d.,]+\s+(?:de|of)\s+([\d.,]+)$/i.exec(text);
        const number= /^\d+(?:[.,]\d{3})*$/.test(text)?text:pagination?.[1];if(!number)continue;
        const total=Number(number.replace(/[.,]/g,''));if(!Number.isSafeInteger(total)||total<list.ids.length)continue;
        const primary=selector(el,root);if(!primary || list.ids.includes(text))continue;
        const semantic=el.tagName.toLowerCase().includes('badge')||el.hasAttribute('aria-valuenow')||pagination;
        if(!semantic && total!==list.ids.length)continue;
        suggestions.push({preset:list.preset,confidence:Math.min(99,list.score+(semantic?9:0)),total,items:list.ids.length,examples:list.ids.slice(0,3),
          counterSelector:primary,itemSelector:list.query,
          counterLocator:{targetSelector:primary,shadowChain:chain,frameUrl:location.href},
          itemLocator:{targetSelector:list.query,shadowChain:chain,frameUrl:location.href}});
      }
    }
    if(visited>=5000)break;
  }
  return suggestions.sort((a,b)=>b.confidence-a.confidence).slice(0,3);
}
if(typeof module!=='undefined')module.exports={detectQueueFrame};
