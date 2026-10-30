(function(root){
  const events=Object.freeze({QUEUE_CHANGED:'queue_changed',MONITOR_ERROR:'monitor_error',MONITOR_RECOVERED:'monitor_recovered',MANUAL_TEST:'test'});
  class EmailConnector {
    constructor(transport=null,{timeoutMs=12000}={}){this.id='email';this.transport=transport;this.status=transport?'UNVERIFIED':'DISABLED';this.challenge=null;this.timeoutMs=timeoutMs;}
    isConfigured(){return this.status==='VERIFIED';}
    async call(method,...args){
      if(!this.transport)throw Error('EMAIL_BACKEND_UNAVAILABLE');
      const controller=new AbortController();let timer;
      try{return await Promise.race([
        Promise.resolve().then(()=>this.transport[method](...args,{signal:controller.signal})),
        new Promise((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('EMAIL_TIMEOUT'));},this.timeoutMs);})
      ]);}catch(error){
        if(error.status===429)throw Object.assign(Error('EMAIL_RATE_LIMITED'),{retryAfter:error.retryAfter});
        if(error.message==='EMAIL_TIMEOUT')throw error;
        throw Error('EMAIL_BACKEND_ERROR');
      }finally{clearTimeout(timer);}
    }
    async requestVerification(email){
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('EMAIL_INVALID');
      if(!this.transport)throw Error('EMAIL_BACKEND_UNAVAILABLE');
      const result=await this.call('requestVerification',email);
      if(typeof result.challengeId!=='string'||!result.challengeId)throw Error('EMAIL_BACKEND_ERROR');
      this.challenge=result.challengeId;this.status='UNVERIFIED';return result;
    }
    async confirm(code){
      if(!this.transport||!this.challenge)throw Error('EMAIL_UNVERIFIED');
      const result=await this.call('confirm',this.challenge,code);
      if(result.verified!==true)throw Error('EMAIL_UNVERIFIED');
      this.status='VERIFIED';return result;
    }
    async send(event){
      if(!this.isConfigured())throw Error('EMAIL_UNVERIFIED');
      if(!Object.hasOwn(events,event.type))throw Error('EMAIL_EVENT_INVALID');
      return this.call('send',{event:events[event.type],occurredAt:new Date(event.at).toISOString()});
    }
    test(){return this.send({type:'MANUAL_TEST',at:Date.now()});}
  }
  function createAlertConnectors(config,services){
    function connector(id,enabled,send){return {id,status:enabled?'CONFIGURED':'DISABLED',isConfigured:()=>enabled,
      send:async event=>{if(!Object.hasOwn(events,event.type))throw Error('Evento inválido.');return send(event);},
      test:()=>send({type:'MANUAL_TEST',at:Date.now()})};}
    return [connector('local',config.notificationsEnabled!==false,services.desktop),
      connector('sound',config.soundEnabled!==false,event=>['QUEUE_CHANGED','MANUAL_TEST'].includes(event.type)?services.sound(event):undefined),
      connector('telegram',config.telegramEnabled===true,services.telegram),services.email||new EmailConnector(),
      connector('automation',config.automationEnabled===true,services.webhook)];
  }
  async function dispatchConnectors(connectors,event,canSend=async()=>true){
    const delivery={};
    await Promise.all(connectors.map(async connector=>{
      if(!connector.isConfigured() || (connector.id==='sound'&&!['QUEUE_CHANGED','MANUAL_TEST'].includes(event.type))){delivery[connector.id]='disabled';return;}
      if(!await canSend()){delivery[connector.id]='cancelled';return;}
      try{await connector.send(event);delivery[connector.id]='sent';}catch{delivery[connector.id]='error';}
    }));
    return delivery;
  }
  root.WebMonitorConnectors={EmailConnector,createAlertConnectors,dispatchConnectors};
  if(typeof module!=='undefined')module.exports=root.WebMonitorConnectors;
})(globalThis);
