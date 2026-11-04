import {invoke} from '@tauri-apps/api/core';
import {createPreferencesClient} from '../../../src/system/preferences.ts';
import {normalizeFailure} from '../../../src/system/failures.ts';

export function installPreviewSession(scene){
 const session=new URLSearchParams(location.search).get('session')??crypto.randomUUID();
 const preferences=createPreferencesClient(invoke);
 window.__beePreviewSession=session;
 const send=(type,payload={})=>window.parent.postMessage({type,scene,session,...payload},location.origin);
 const current=()=>window.__beePreviewSession===session;
 window.__beePreviewPreferences=value=>{if(current())send('bee-preview-preferences',{theme:value.theme});};
 window.__beePreviewAnnounceReady=()=>{if(current())send('bee-preview-ready');};
 let busy=false;
 const control=async request=>{
  if(!current()||request.session!==session)throw new Error(`PREVIEW_SESSION_STALE: received_session=${request.session}; required_session=${session}`);
  if(request.action!=='theme')throw new Error(`PREVIEW_ACTION_UNKNOWN: action=${request.action}; required=theme`);
  if(!['light','dark','system'].includes(request.value))throw new Error(`PREVIEW_THEME_INVALID: theme=${request.value}; required=light, dark or system`);
  if(busy)throw new Error('PREVIEW_CONTROL_BUSY: action=theme; current_action=theme; required=previous action completed');
  busy=true;
  try{
   const snapshot=await preferences.read();
   if(snapshot.error)throw snapshot.error;
   if(!current())throw new Error(`PREVIEW_SESSION_STALE: session=${session}; required=current preview session before saving`);
   const saved=await preferences.save(snapshot.preferences.revision,{...snapshot.preferences,theme:request.value});
   if(saved.error)throw saved.error;
   if(current())window.dispatchEvent(new Event('focus'));
  }finally{busy=false;}
 };
 window.__beePreviewControl=control;
 window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.parent)return;
  const request=event.data;
  if(request?.type!=='bee-preview-control'||request.session!==session||!Number.isSafeInteger(request.id)||request.id<1)return;
  void control(request).then(()=>{if(current())send('bee-preview-control-result',{id:request.id,ok:true});},cause=>{
   const failure=normalizeFailure(cause,'preview_theme');
   const error=[`${failure.code}: ${failure.message}`,`check=${failure.check}`,...(failure.observedAt?[`observed_at=${failure.observedAt}`]:[]),...Object.entries(failure.evidence).map(([key,value])=>`${key}=${value}`)].join('; ');
   if(current())send('bee-preview-control-result',{id:request.id,ok:false,error});
  });
 });
}
