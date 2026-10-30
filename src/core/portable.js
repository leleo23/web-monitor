(function(root){
  const fields={type:'string',intervalMinutes:'number',soundId:'string',volume:'number',soundEnabled:'boolean',notificationsEnabled:'boolean',alertOnNewItem:'boolean',alertOnRemovedItem:'boolean',alertOnCountIncrease:'boolean',alertOnCountDecrease:'boolean'};
  function exportPreferences(config){
    const data={format:'web-monitor-preferences',version:1,preferences:Object.fromEntries(Object.entries(fields).filter(([key,type])=>typeof config[key]===type).map(([key])=>[key,config[key]]))};
    importPreferences(data);return data;
  }
  function importPreferences(data){
    if(!data || data.format!=='web-monitor-preferences' || data.version!==1 || !data.preferences || typeof data.preferences!=='object' || Array.isArray(data.preferences))throw Error('Arquivo de preferências inválido.');
    const result={};
    for(const [key,value] of Object.entries(data.preferences)){
      if(!Object.hasOwn(fields,key) || typeof value!==fields[key])throw Error('Campo não permitido no arquivo.');
      result[key]=value;
    }
    if(result.type && !['queue','visual'].includes(result.type))throw Error('Tipo inválido.');
    if(result.soundId && !['pulse','bell','digital','critical'].includes(result.soundId))throw Error('Som inválido.');
    if(result.intervalMinutes!==undefined && (!Number.isFinite(result.intervalMinutes)||result.intervalMinutes<1||result.intervalMinutes>1440))throw Error('Intervalo inválido.');
    if(result.volume!==undefined && (!Number.isFinite(result.volume)||result.volume<0||result.volume>1))throw Error('Volume inválido.');
    return result;
  }
  root.WebMonitorPortable={exportPreferences,importPreferences};
  if(typeof module!=='undefined')module.exports=root.WebMonitorPortable;
})(globalThis);
