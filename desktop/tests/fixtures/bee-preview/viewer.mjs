import {scenes,getScene} from './scenarios.mjs';
const params=new URLSearchParams(location.search);
const accountFocus=params.get('scene')?.startsWith('accounts-auto-')??false;
const simpleAcceptance=accountFocus&&params.get('debug')!=='1';
const scene=document.querySelector('#scene'),theme=document.querySelector('#theme'),size=document.querySelector('#size'),frame=document.querySelector('iframe');
const feedback=document.querySelector('#control-status');
const eventKind=document.querySelector('#event-kind'),eventValue=document.querySelector('#event-value'),eventApply=document.querySelector('#event-apply');
const simulationDetails=document.querySelector('#simulation-details'),eventHelp=document.querySelector('#event-help');
const guide=document.querySelector('#account-guide'),guidePlatform=document.querySelector('#guide-platform'),guideText=document.querySelector('#guide-text'),guideAction=document.querySelector('#guide-action');
const accountEvents=new Set(['account-source','login-result','runtime-connection','account-refresh','account-service','supply-write-result','account-operation-result']);
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
let loginOperations={},accountContext={},deviceOperation=null,diagnosticReport=null,pendingAction='',ready=false;
function sourceOptions(){
 const platform=document.querySelector('#event-platform').value,store=document.querySelector('#event-store'),previous=store.value;
 const allowed=platform==='claude'?[['keychain','钥匙串'],['file','文件']]:[['auto','自动'],['file','文件'],['keyring','密钥环']];
 store.replaceChildren(...allowed.map(([value,label])=>new Option(label,value)));
 if(allowed.some(([value])=>value===previous))store.value=previous;
}
document.querySelector('#event-platform').addEventListener('change',()=>{sourceOptions();selectionChanged();});
function eventFields(){
 const definition=events[eventKind.value];eventValue.replaceChildren();
 if(definition)for(const [value,label]of definition[1]){const option=new Option(label,value);eventValue.append(option);}
 for(const node of document.querySelectorAll('[data-event-platform]'))node.hidden=!['account-source','login-result','account-refresh'].includes(eventKind.value);
 for(const node of document.querySelectorAll('[data-event-source]'))node.hidden=eventKind.value!=='account-source';
 sourceOptions();
}
eventKind.addEventListener('change',()=>{eventFields();selectionChanged();});
for(const field of [eventValue,document.querySelector('#event-store'),document.querySelector('#event-directory')])field.addEventListener('input',selectionChanged);
guidePlatform.addEventListener('change',()=>{feedback.textContent='';renderGuide();});
const visibleScenes=accountFocus?scenes.filter(item=>item.id.startsWith('accounts-auto-')):scenes;
for(const group of new Set(visibleScenes.map(item=>item.group))){const options=document.createElement('optgroup');options.label=group;for(const item of visibleScenes.filter(item=>item.group===group)){const option=document.createElement('option');option.value=item.id;option.textContent=item.label;options.append(option);}scene.append(options);}
scene.value=getScene(params.get('scene')).id;
if(accountFocus){document.querySelector('header strong').textContent='Bee · AI 账号验收';document.querySelector('label[for="scene"]').textContent='验收流程';simulationDetails.open=false;guide.hidden=false;document.body.classList.add('account-preview');}
if(simpleAcceptance){
 document.body.classList.add('simple-preview');
 document.querySelector('#acceptance-flows').hidden=false;
 for(const node of document.querySelectorAll('[data-debug-controls]'))node.hidden=true;
 simulationDetails.hidden=true;
 document.querySelector('#reset').textContent='重新开始这一项';
 document.querySelector('#preview-note').textContent='这是演示账号，可放心操作。每项都可以重新开始。';
}
theme.value=['light','dark','system'].includes(params.get('theme'))?params.get('theme'):'light';
size.value=params.get('size')==='narrow'?'narrow':'normal';
let session='',sequence=0,pending=null,savedTheme=theme.value;
function eventBlock(){
 if(!ready)return '正在加载场景…';
 if(!accountFocus)return '';
 const platform=document.querySelector('#event-platform').value,account=accountContext[platform],name=platform==='openai'?'OpenAI':'Claude';
 if(['login-result','account-refresh'].includes(eventKind.value)&&!account)return '正在读取账号状态…';
 if(eventKind.value==='login-result'){
  if(!account.loginOperation)return `${name} 当前没有进行中的登录。请先在下方点击登录并确认“开始官方登录”，再模拟结果。`;
  if(eventValue.value==='succeeded-same'&&!account.selected)return `${name} 尚未接入账号，请选择“登录成功（新身份）”。`;
 }
 if(eventKind.value==='account-refresh'){
  if(!account.selected)return `${name} 尚未接入，暂不能刷新凭据。请先在下方完成登录并确认接入。`;
  if(account.active)return `${name} 正在处理账号操作，请完成或取消后再模拟后台刷新。`;
  if(account.changed)return `${name} 已发现不同账号，请先在下方确认换号。`;
  if(!account.refreshAllowed)return `${name} 尚未读到登录来源。请在账号详情中重新读取后再模拟刷新。`;
 }
 if(eventKind.value==='account-source'){
  const directory=document.querySelector('#event-directory').value.trim();
  if(directory&&(!directory.startsWith('/')||/[\u0000-\u001f\u007f]/.test(directory)))return '来源目录需填写绝对路径（例如 /tmp/codex），或留空使用默认目录。';
 }
 return '';
}
function updateControls(){
 const blocked=eventBlock();
 eventApply.disabled=pending!==null||!!blocked;
 for(const field of document.querySelectorAll('#simulation select,#simulation input'))field.disabled=pending!==null;
 eventHelp.textContent=blocked||({
  'login-result':'先在下方开始官方登录，再选择此次登录的结果。',
  'account-source':'只修改所选来源的模拟条件；随后在下方账号详情点击“重新读取”。',
  'account-refresh':'模拟已接入账号的后台凭据刷新，保留当前暂停选择。',
  'account-service':'模拟服务准备或报告变化，平台暂停选择保持不变。',
  'runtime-connection':'模拟网络变化，下方页面将在下一次核对时更新。',
  'supply-write-result':'先设置下一次回执丢失，再在下方点击暂停或恢复接单。',
  'account-operation-result':'先设置下一次回执丢失，再在下方确认接入或换号。',
 }[eventKind.value]??'');
 renderGuide();
}
function selectionChanged(){if(pending===null)feedback.textContent='';updateControls();}
function renderGuide(){
 if(!accountFocus)return;
 const platform=guidePlatform.value,a=accountContext[platform],name=platform==='openai'?'OpenAI':'Claude';
 let text='正在读取账号状态…',action=null,label='';
 if(a?.loginOperation){
  text=`${name} 正在等待登录结果。点击“模拟登录成功”，再回到下方继续；此预览不需要打开真实官方客户端。`;
  action={action:'login-result',value:a.selected?'succeeded-same':'succeeded',platform,operationId:a.loginOperation};label='模拟登录成功';
 }else if(a?.active||a?.preparing)text=`${name} 正在处理，请等待下方状态更新。`;
 else if(a?.sourceCondition==='denied'){
  text=platform==='openai'?`${name} 的来源读取被拒绝。点击“模拟权限恢复”，再打开“修改凭证读取设置”，点击“保存”以重新读取；修复保留接单选择。`:`${name} 的来源读取被拒绝。点击“模拟权限恢复”，然后在下方账号详情点击“重新读取”；修复不会自动恢复接单。`;
  action={action:'account-source',value:'available',platform,...a.source};label='模拟权限恢复';
 }else if(a?.changed)text=`${name} 发现不同账号。请在下方打开账号详情，核对身份并确认换号；完成后仍保持暂停。`;
 else if(a&&!a.selected)text=a.candidate==='available'?`在下方点击${name}“${platform==='openai'?'接入账号':'接入'}”并确认。准备完成后保留接单选择；如显示完成提示，先点击“完成”。`:`先在下方点击“登录 ${name}”并确认开始登录。这里会随后出现“模拟登录成功”按钮。`;
 else if(a&&a.candidate!=='available')text=`请在下方打开 ${name} 账号详情，点击“重新读取”核对当前登录。`;
 else if(a)text=simpleAcceptance?(a.paused?`如有完成提示，先点击“完成”。点击下方 ${name} 的“恢复接单”，应看到“可接单”。`:`如有完成提示，先点击“完成”。点击下方 ${name} 的“暂停接单”，应看到“${platform==='openai'?'已暂停':'已暂停接单'}”；再恢复，应回到“可接单”。`):`在下方 ${name} 账号行验证暂停与恢复；重新登录从账号详情进入。断线、回执丢失等检查可展开“更多模拟条件”。`;
 const wasFocused=document.activeElement===guideAction;
 guideText.textContent=text;guideAction.hidden=!action;guideAction.textContent=label;guideAction.disabled=pending!==null||!ready;
 guideAction.onclick=action?()=>submit(action):null;
 if(wasFocused&&!action){guideText.tabIndex=-1;guideText.focus();}
}
function submit(fields){
 if(pending!==null||!ready)return;
 const request={type:'bee-preview-control',session,id:++sequence,...fields};
 pending=request.id;pendingAction=request.action;theme.disabled=true;feedback.textContent='正在更新模拟条件…';updateControls();
 frame.contentWindow.postMessage(request,location.origin);
}
const media=window.matchMedia('(prefers-color-scheme: dark)');
function appearance(){const dark=theme.value==='dark'||theme.value==='system'&&media.matches;document.body.classList.toggle('dark',dark);document.documentElement.style.colorScheme=dark?'dark':'light';}
function layout(){document.querySelector('.canvas').classList.toggle('narrow',size.value==='narrow');document.body.style.setProperty('--preview-width',size.value==='narrow'?'862px':'1120px');}
function remember(){history.replaceState(null,'','?'+new URLSearchParams({scene:scene.value,theme:theme.value,size:size.value,...(params.get('debug')==='1'?{debug:'1'}:{})}));}
function reset(){
 const current=getScene(scene.value);scene.value=current.id;
 for(const button of document.querySelectorAll('[data-scene]'))button.setAttribute('aria-pressed',String(button.dataset.scene===current.id));
 guidePlatform.value='openai';
 session=crypto.randomUUID();pending=null;pendingAction='';ready=false;accountContext={};loginOperations={};theme.disabled=true;eventApply.disabled=true;document.querySelector('#simulation').hidden=true;
 document.querySelector('#description').textContent=current.description;
 document.querySelector('#phase').textContent='';feedback.textContent='正在加载场景…';
 appearance();layout();remember();updateControls();
 frame.src='/tests/fixtures/bee-preview/app.html?'+new URLSearchParams({scene:current.id,theme:theme.value,size:size.value,session});
}
for(const button of document.querySelectorAll('[data-scene]'))button.addEventListener('click',()=>{scene.value=button.dataset.scene;reset();});
scene.addEventListener('change',reset);
document.querySelector('#reset').addEventListener('click',reset);
size.addEventListener('change',()=>{layout();remember();feedback.textContent='窗口尺寸已调整，当前进度已保留。';});
media.addEventListener('change',appearance);
theme.addEventListener('change',()=>{
 pending=++sequence;pendingAction='theme';theme.disabled=true;feedback.textContent='正在切换外观…';updateControls();
 frame.contentWindow.postMessage({type:'bee-preview-control',session,id:pending,action:'theme',value:theme.value},location.origin);
});
eventApply.addEventListener('click',()=>{
 if(eventBlock()){updateControls();return;}
 const platform=document.querySelector('#event-platform').value;
 submit({action:eventKind.value,value:eventValue.value,platform,operationId:accountFocus?accountContext[platform]?.loginOperation:loginOperations[platform],directory:document.querySelector('#event-directory').value.trim()||null,store:document.querySelector('#event-store').value,...(['device-approval','device-credential'].includes(eventKind.value)?deviceOperation??{}:{}),...(eventKind.value==='diagnostics-result'?diagnosticReport??{}:{})});
});
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
 const data=event.data;
 if(data?.session!==session||data.scene!==scene.value)return;
 if(data.type==='bee-preview-ready'){ready=true;theme.disabled=false;feedback.textContent='场景已就绪。';updateControls();}
 if(data.type==='bee-preview-controls'){
  const nextAccounts=data.accounts??{};
  const started=['openai','claude'].find(p=>nextAccounts[p]?.loginOperation&&nextAccounts[p].loginOperation!==accountContext[p]?.loginOperation);
  accountContext=nextAccounts;if(started)guidePlatform.value=started;
  loginOperations=data.loginOperations??{};deviceOperation=data.deviceOperation??null;diagnosticReport=data.diagnosticReport??null;
  const available=(data.actions??[]).filter(action=>Object.hasOwn(events,action)&&(!accountFocus||accountEvents.has(action)));
  if([...eventKind.options].map(option=>option.value).join(',')!==available.join(',')){
   const previous=eventKind.value;eventKind.replaceChildren(...available.map(action=>new Option(events[action][0],action)));
   if(available.includes(previous))eventKind.value=previous;eventFields();
  }
  document.querySelector('#simulation').hidden=available.length===0;updateControls();
 }
 if(data.type==='bee-preview-preferences'&&['light','dark','system'].includes(data.theme)){
  savedTheme=data.theme;theme.value=data.theme;appearance();remember();
 }
 if(data.type==='bee-preview-control-result'&&data.id===pending){
  pending=null;theme.disabled=false;
  if(data.ok===true){
   feedback.textContent=pendingAction==='theme'?'外观已切换，当前进度已保留。':simpleAcceptance?'已完成，请按上方提示继续。':data.message??'模拟条件已更新；请在正式页面继续操作或核对。';
   if(accountFocus&&pendingAction!=='theme'&&simulationDetails.open){const returnFocus=simulationDetails.contains(document.activeElement);simulationDetails.open=false;if(returnFocus)simulationDetails.querySelector('summary').focus();}
  }
  else{if(pendingAction==='theme'){theme.value=savedTheme;appearance();}feedback.textContent=(pendingAction==='theme'?'外观切换失败：':'模拟条件更新失败：')+data.error;}
  updateControls();
 }
 if(data.type==='bee-preview-phase'&&typeof data.phase==='string')document.querySelector('#phase').textContent=({current:'报告有效',expired:'核对中…',waiting:'等待自动重试…',retrying:'重试中…',recovered:'核对已恢复',background:'后台核对'})[data.phase]??'';
});
reset();
