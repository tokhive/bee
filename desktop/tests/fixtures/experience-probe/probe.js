'use strict';
const output=document.getElementById('receipts');
const status=document.getElementById('status');
const buttons=[...document.querySelectorAll('button')];
const receipts=[];
const downloads=new Map();
function show(receipt){receipts.unshift(receipt);output.textContent=JSON.stringify(receipts,null,2);}
async function act(action){
  buttons.forEach(button=>button.disabled=true);status.textContent=`执行 ${action}…`;
  try{const result=await window.__TAURI__.core.invoke('probe_action',{action});status.textContent=`${action} 完成`;return result;}
  catch(error){show({action,invocation_error:error});status.textContent=`${action} 失败，请查看 JSON`;}
  finally{buttons.forEach(button=>button.disabled=false);}
}
async function download(action){
  const result=await act(action);
  if(!result)throw new Error(`prepare download failed: action=${action}`);
  const url=URL.createObjectURL(new Blob([result.report_json],{type:'application/json'}));
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{downloads.delete(url);URL.revokeObjectURL(url);reject(new Error(`actual WebView Finished timed out: mode=${result.mode}`));},15_000);
    downloads.set(url,payload=>{clearTimeout(timer);URL.revokeObjectURL(url);resolve(payload);});
    const anchor=document.createElement('a');anchor.href=url;anchor.download='bee-s2-probe-diagnostics.json';document.body.append(anchor);anchor.click();anchor.remove();
    status.textContent=`已发起真实 WebView 下载 (${result.mode})，等待原生回执`;
  });
}
async function smoke(){
  let stage='start';
  const run=async action=>{stage=action;const result=await act(action);if(!result)throw new Error(`native action failed: ${action}`);return result;};
  const assertRegistration=(result,expected)=>{if(result.autostart.error||result.autostart.registered!==expected)throw new Error(`autostart observed mismatch: expected=${expected} actual=${JSON.stringify(result)}`);};
  try{
    await run('verify_preferences');await run('verify_safe_logs');await run('query_permission');
    const before=await run('query_autostart');if(before.autostart.error)throw new Error(JSON.stringify(before));
    assertRegistration(await run('enable_autostart'),true);assertRegistration(await run('query_autostart'),true);
    assertRegistration(await run('disable_autostart'),false);assertRegistration(await run('query_autostart'),false);
    const restored=await run('restore_autostart');if(!restored.restored)throw new Error(JSON.stringify(restored));
    assertRegistration(await run('query_autostart'),before.autostart.registered);
    for(const [action,expected] of [['prepare_report_save',true],['prepare_report_cancel',false],['prepare_report_write_failure',false]]){
      stage=action;const result=await download(action);if(result.success!==expected)throw new Error(`actual download outcome mismatch: action=${action} expected=${expected} actual=${JSON.stringify(result)}`);
    }
    await run('smoke_complete');status.textContent='隔离原生 smoke 通过；通知权限申请和可见横幅仍待明确操作';
  }catch(error){
    await act('restore_autostart');
    const detail=`stage=${stage}; ${error instanceof Error?error.message:JSON.stringify(error)}`;
    await window.__TAURI__.core.invoke('probe_smoke_failed',{detail});status.textContent=`Smoke 失败：${detail}`;show({smoke_failed:detail});
  }
}
async function connect(){
  if(!window.__TAURI__){status.textContent='未运行于原生 Tauri WebView';return;}
  await window.__TAURI__.event.listen('probe://receipt',event=>show(event.payload));
  await window.__TAURI__.event.listen('probe://download-finished',event=>{status.textContent=event.payload.success?'真实 WebView 下载成功；查看文件核对回执':'真实 WebView 下载未保存；查看失败/取消回执';const resolve=downloads.get(event.payload.url);if(resolve){downloads.delete(event.payload.url);resolve(event.payload);}});
  await window.__TAURI__.event.listen('probe://download-cancelled',event=>{status.textContent='真实 WebView Requested 已拒绝下载；macOS 无 Finished 回调';const resolve=downloads.get(event.payload.url);if(resolve){downloads.delete(event.payload.url);resolve(event.payload);}});
  document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>void act(button.dataset.action)));
  document.querySelectorAll('[data-download]').forEach(button=>button.addEventListener('click',()=>void download(button.dataset.download).catch(error=>{status.textContent=error.message;show({download_error:error.message});})));
  document.getElementById('quit').addEventListener('click',()=>void window.__TAURI__.core.invoke('probe_quit'));
  const info=await act('info');
  if(info?.notification_smoke_requested){
    try{
      const permission=await act('query_permission');
      if(permission?.permission!=='granted')throw new Error(`notification smoke stopped: actual_permission=${permission?.permission}; no permission requested or notification submitted`);
      const enabled=await act('enable_notifications');
      if(!enabled?.preferences?.preferences?.notifications_enabled)throw new Error('notification smoke stopped: test preference was not enabled');
      const submitted=await act('submit_notice');
      if(!submitted?.submission_outcomes?.some(outcome=>outcome.state==='accepted'))throw new Error(`notification smoke has no new OS acceptance: ${JSON.stringify(submitted)}`);
      status.textContent='OS 已接受一次固定通知提交；横幅可见与点击仍需观察，未再次申请权限';
    }catch(error){
      const detail=`notification_smoke: ${error instanceof Error?error.message:JSON.stringify(error)}`;
      await window.__TAURI__.core.invoke('probe_smoke_failed',{detail});status.textContent=detail;
    }
  }else if(info?.smoke_requested)await smoke();
}
connect().catch(error=>{status.textContent='本地连接失败';show({connection_error:String(error)});});
