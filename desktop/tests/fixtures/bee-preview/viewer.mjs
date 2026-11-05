import {scenes,getScene} from './scenarios.mjs';
const params=new URLSearchParams(location.search);
const scene=document.querySelector('#scene'),theme=document.querySelector('#theme'),size=document.querySelector('#size'),frame=document.querySelector('iframe');
const feedback=document.querySelector('#control-status');
const eventKind=document.querySelector('#event-kind'),eventValue=document.querySelector('#event-value'),eventApply=document.querySelector('#event-apply');
const events={
 'notification-permission':['通知系统权限',[['prompt','待询问'],['granted','已允许'],['denied','已拒绝']]],
 'autostart-registration':['自启注册条件',[['available','可正常注册'],['fail','注册失败']]],
 'account-source':['账号来源条件',[['available','来源可读取'],['missing','来源不存在'],['denied','读取被拒绝']]],
 'login-result':['当前登录结果',[['succeeded','登录成功（新身份）'],['succeeded-same','登录成功（原账号）'],['failed','登录失败']]],
 'runtime-connection':['设备网络连接',[['online','网络恢复'],['offline','网络断开'],['connecting','正在连接'],['rejected','凭据被拒绝'],['occupied','连接被占用']]],
 'account-refresh':['账号后台刷新',[['same-account','同账号凭据刷新']]],
 'account-service':['账户服务条件',[['ready','服务准备完成'],['failed','服务准备失败'],['restart','模拟服务重启'],['stale','报告过期'],['fresh','报告恢复']]],
 'supply-write-result':['接单操作回执',[['confirmed','正常返回'],['unknown-next','下次回执丢失']]],
 'account-operation-result':['账号操作回执',[['confirmed','正常返回'],['unknown-next','下次回执丢失']]],
 'runtime-write-result':['贡献操作回执',[['confirmed','正常返回结果'],['unknown-next','下一次提交后丢失回执']]],
 'network-fault':['代理操作条件',[['none','恢复正常'],['save','保存失败'],['apply','应用失败'],['unknown','应用后丢失回执']]],
 'diagnostics-result':['当前诊断结果',[['completed','诊断完成'],['read-failed','读取失败'],['available','恢复读取']]],
 'device-approval':['当前配对批准',[['approve','批准当前配对']]],
 'device-credential':['设备凭据条件',[['revoke','撤销当前设备凭据']]],
};
let loginOperations={},deviceOperation=null,diagnosticReport=null,pendingAction='';
function sourceOptions(){
 const platform=document.querySelector('#event-platform').value,store=document.querySelector('#event-store'),previous=store.value;
 const allowed=platform==='claude'?[['keychain','钥匙串'],['file','文件']]:[['auto','自动'],['file','文件'],['keyring','密钥环']];
 store.replaceChildren(...allowed.map(([value,label])=>new Option(label,value)));
 if(allowed.some(([value])=>value===previous))store.value=previous;
}
document.querySelector('#event-platform').addEventListener('change',sourceOptions);
function eventFields(){
 const definition=events[eventKind.value];eventValue.replaceChildren();
 if(definition)for(const [value,label]of definition[1]){const option=new Option(label,value);eventValue.append(option);}
 for(const node of document.querySelectorAll('[data-event-platform]'))node.hidden=!['account-source','login-result','account-refresh'].includes(eventKind.value);
 for(const node of document.querySelectorAll('[data-event-source]'))node.hidden=eventKind.value!=='account-source';
 sourceOptions();
}
eventKind.addEventListener('change',eventFields);
for(const group of new Set(scenes.map(item=>item.group))){const options=document.createElement('optgroup');options.label=group;for(const item of scenes.filter(item=>item.group===group)){const option=document.createElement('option');option.value=item.id;option.textContent=item.label;options.append(option);}scene.append(options);}
scene.value=getScene(params.get('scene')).id;
theme.value=['light','dark','system'].includes(params.get('theme'))?params.get('theme'):'light';
size.value=params.get('size')==='narrow'?'narrow':'normal';
let session='',sequence=0,pending=null,savedTheme=theme.value;
const media=window.matchMedia('(prefers-color-scheme: dark)');
function appearance(){const dark=theme.value==='dark'||theme.value==='system'&&media.matches;document.body.classList.toggle('dark',dark);document.documentElement.style.colorScheme=dark?'dark':'light';}
function layout(){document.querySelector('.canvas').classList.toggle('narrow',size.value==='narrow');}
function remember(){history.replaceState(null,'','?'+new URLSearchParams({scene:scene.value,theme:theme.value,size:size.value}));}
function reset(){
 const current=getScene(scene.value);scene.value=current.id;
 session=crypto.randomUUID();pending=null;pendingAction='';theme.disabled=true;eventApply.disabled=true;document.querySelector('#simulation').hidden=true;
 document.querySelector('#description').textContent=current.description;
 document.querySelector('#phase').textContent='';feedback.textContent='正在加载场景…';
 appearance();layout();remember();
 frame.src='/tests/fixtures/bee-preview/app.html?'+new URLSearchParams({scene:current.id,theme:theme.value,size:size.value,session});
}
scene.addEventListener('change',reset);
document.querySelector('#reset').addEventListener('click',reset);
size.addEventListener('change',()=>{layout();remember();feedback.textContent='窗口尺寸已调整，当前进度已保留。';});
media.addEventListener('change',appearance);
theme.addEventListener('change',()=>{
 pending=++sequence;pendingAction='theme';theme.disabled=true;eventApply.disabled=true;feedback.textContent='正在切换外观…';
 frame.contentWindow.postMessage({type:'bee-preview-control',session,id:pending,action:'theme',value:theme.value},location.origin);
});
eventApply.addEventListener('click',()=>{
 const platform=document.querySelector('#event-platform').value;
 const request={type:'bee-preview-control',session,id:++sequence,action:eventKind.value,value:eventValue.value,platform,operationId:loginOperations[platform],directory:document.querySelector('#event-directory').value.trim()||null,store:document.querySelector('#event-store').value,...(['device-approval','device-credential'].includes(eventKind.value)?deviceOperation??{}:{}),...(eventKind.value==='diagnostics-result'?diagnosticReport??{}:{})};
 pending=request.id;pendingAction=request.action;theme.disabled=true;eventApply.disabled=true;feedback.textContent='正在更新模拟条件…';
 frame.contentWindow.postMessage(request,location.origin);
});
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
 const data=event.data;
 if(data?.session!==session||data.scene!==scene.value)return;
 if(data.type==='bee-preview-ready'){theme.disabled=false;feedback.textContent='场景已就绪。';}
 if(data.type==='bee-preview-controls'){
  loginOperations=data.loginOperations??{};deviceOperation=data.deviceOperation??null;diagnosticReport=data.diagnosticReport??null;
  const available=(data.actions??[]).filter(action=>Object.hasOwn(events,action));
  if([...eventKind.options].map(option=>option.value).join(',')!==available.join(',')){
   const previous=eventKind.value;eventKind.replaceChildren(...available.map(action=>new Option(events[action][0],action)));
   if(available.includes(previous))eventKind.value=previous;eventFields();
  }
  document.querySelector('#simulation').hidden=available.length===0;eventApply.disabled=pending!==null;
 }
 if(data.type==='bee-preview-preferences'&&['light','dark','system'].includes(data.theme)){
  savedTheme=data.theme;theme.value=data.theme;appearance();remember();
 }
 if(data.type==='bee-preview-control-result'&&data.id===pending){
  pending=null;theme.disabled=false;eventApply.disabled=false;
  if(data.ok===true)feedback.textContent=pendingAction==='theme'?'外观已切换，当前进度已保留。':data.message??'模拟条件已更新；请在正式页面继续操作或核对。';
  else{if(pendingAction==='theme'){theme.value=savedTheme;appearance();}feedback.textContent=(pendingAction==='theme'?'外观切换失败：':'模拟条件更新失败：')+data.error;}
 }
 if(data.type==='bee-preview-phase'&&typeof data.phase==='string')document.querySelector('#phase').textContent=({current:'报告有效',expired:'核对中…',waiting:'等待自动重试…',retrying:'重试中…',recovered:'核对已恢复',background:'后台核对'})[data.phase]??'';
});
reset();
