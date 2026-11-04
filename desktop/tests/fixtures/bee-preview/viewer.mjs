import {scenes,getScene} from './scenarios.mjs';
const params=new URLSearchParams(location.search);
const scene=document.querySelector('#scene'),theme=document.querySelector('#theme'),size=document.querySelector('#size'),frame=document.querySelector('iframe');
const feedback=document.querySelector('#control-status');
for(const group of new Set(scenes.map(item=>item.group))){const options=document.createElement('optgroup');options.label=group;for(const item of scenes.filter(item=>item.group===group)){const option=document.createElement('option');option.value=item.id;option.textContent=item.label;options.append(option);}scene.append(options);}
scene.value=getScene(params.get('scene')).id;
theme.value=['light','dark','system'].includes(params.get('theme'))?params.get('theme'):'light';
size.value=params.get('size')==='narrow'?'narrow':'normal';
let session='',sequence=0,pending=null,savedTheme=theme.value;
const media=window.matchMedia('(prefers-color-scheme: dark)');
function appearance(){document.body.classList.toggle('dark',theme.value==='dark'||theme.value==='system'&&media.matches);}
function layout(){document.querySelector('.canvas').classList.toggle('narrow',size.value==='narrow');}
function remember(){history.replaceState(null,'','?'+new URLSearchParams({scene:scene.value,theme:theme.value,size:size.value}));}
function reset(){
 const current=getScene(scene.value);scene.value=current.id;
 session=crypto.randomUUID();pending=null;theme.disabled=true;
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
 pending=++sequence;theme.disabled=true;feedback.textContent='正在切换外观…';
 frame.contentWindow.postMessage({type:'bee-preview-control',session,id:pending,action:'theme',value:theme.value},location.origin);
});
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
 const data=event.data;
 if(data?.session!==session||data.scene!==scene.value)return;
 if(data.type==='bee-preview-ready'){theme.disabled=false;feedback.textContent='场景已就绪。';}
 if(data.type==='bee-preview-preferences'&&['light','dark','system'].includes(data.theme)){
  savedTheme=data.theme;theme.value=data.theme;appearance();remember();
 }
 if(data.type==='bee-preview-control-result'&&data.id===pending){
  pending=null;theme.disabled=false;
  if(data.ok===true)feedback.textContent='外观已切换，当前进度已保留。';
  else{theme.value=savedTheme;appearance();feedback.textContent='外观切换失败：'+data.error;}
 }
 if(data.type==='bee-preview-phase'&&typeof data.phase==='string')document.querySelector('#phase').textContent=({current:'报告有效',expired:'核对中…',waiting:'等待自动重试…',retrying:'重试中…',recovered:'核对已恢复',background:'后台核对'})[data.phase]??'';
});
reset();
