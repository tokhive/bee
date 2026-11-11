import {invoke} from '@tauri-apps/api/core';
import {createPreferencesClient} from '../../../src/system/preferences.ts';
import {normalizeFailure} from '../../../src/system/failures.ts';
import {applyPreviewEvent} from './control.mjs';

export function installPreviewSession(scene){
 const session=window.__beePreviewSession??new URLSearchParams(location.search).get('session')??crypto.randomUUID();
 const preferences=createPreferencesClient(invoke);
 window.__beePreviewSession=session;
 const send=(type,payload={})=>window.parent.postMessage({type,scene,session,...payload},location.origin);
 const current=()=>window.__beePreviewSession===session;
 window.__beePreviewPreferences=value=>{if(current())send('bee-preview-preferences',{theme:value.theme});};
 const announce=()=>{if(current())send('bee-preview-controls',{actions:Object.keys(window.__beeMockControls??{}),accounts:window.__beeMockAccountContext?.()??{},loginOperations:Object.fromEntries(['openai','claude'].map(platform=>[platform,window.accounts?.[platform]?.operation?.kind==='authorize'?window.accounts[platform].operation.id:null])),diagnosticReport:window.__beeMockDiagnosticContext?.()??null,deviceOperation:window.__beeMockDeviceContext?.()??null});};
 window.__beePreviewAnnounceReady=()=>{if(current()){send('bee-preview-ready');announce();}};
 const original=window.__TAURI_INTERNALS__.invoke;
 const activity={accountReads:0,accountReadsStarted:0};window.__beePreviewActivity=activity;
 window.__TAURI_INTERNALS__.invoke=async(...args)=>{
  const accountRead=args[0]==='account_detect';if(accountRead){activity.accountReads++;activity.accountReadsStarted++;}
  try{return await original(...args);}finally{if(accountRead)activity.accountReads--;announce();}
 };
 let busy=null;
 const control=async request=>{
  if(!current()||request.session!==session)throw new Error(`PREVIEW_SESSION_STALE: received_session=${request.session}; required_session=${session}`);
  if(request.action==='theme'&&!['light','dark','system'].includes(request.value))throw new Error(`PREVIEW_THEME_INVALID: theme=${request.value}; required=light, dark or system`);
  if(busy)throw new Error(`PREVIEW_CONTROL_BUSY: action=${request.action}; current_action=${busy}; required=previous action completed`);
  busy=request.action;
  try{
   if(request.action!=='theme'){const result=await applyPreviewEvent(request);announce();return result;}
   const snapshot=await preferences.read();
   if(snapshot.error)throw snapshot.error;
   if(!current())throw new Error(`PREVIEW_SESSION_STALE: session=${session}; required=current preview session before saving`);
   const saved=await preferences.save(snapshot.preferences.revision,{...snapshot.preferences,theme:request.value});
   if(saved.error)throw saved.error;
   if(current())window.dispatchEvent(new Event('focus'));
  }finally{busy=null;}
 };
 window.__beePreviewControl=control;
 window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.parent)return;
  const request=event.data;
  if(request?.type!=='bee-preview-control'||request.session!==session||!Number.isSafeInteger(request.id)||request.id<1)return;
  void control(request).then(result=>{if(current())send('bee-preview-control-result',{id:request.id,ok:true,message:result?.message});},cause=>{
   const failure=normalizeFailure(cause,request.action==='theme'?'preview_theme':'preview_event');
   const error=[`${failure.code}: ${failure.message}`,`check=${failure.check}`,...(failure.observedAt?[`observed_at=${failure.observedAt}`]:[]),...Object.entries(failure.evidence).map(([key,value])=>`${key}=${value}`)].join('; ');
   if(current())send('bee-preview-control-result',{id:request.id,ok:false,error});
  });
 });
}
