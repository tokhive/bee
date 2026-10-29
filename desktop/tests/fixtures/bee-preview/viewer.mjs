import {scenes,getScene} from './scenarios.mjs';
const params=new URLSearchParams(location.search);
const scene=document.querySelector('#scene'),theme=document.querySelector('#theme'),size=document.querySelector('#size'),frame=document.querySelector('iframe');
for(const group of new Set(scenes.map(item=>item.group))){const options=document.createElement('optgroup');options.label=group;for(const item of scenes.filter(item=>item.group===group)){const option=document.createElement('option');option.value=item.id;option.textContent=item.label;options.append(option);}scene.append(options);}
scene.value=getScene(params.get('scene')).id;theme.value=params.get('theme')==='dark'?'dark':'light';size.value=params.get('size')==='narrow'?'narrow':'normal';
function update(){
 const current=getScene(scene.value);scene.value=current.id;
 document.body.classList.toggle('dark',theme.value==='dark');document.querySelector('.canvas').classList.toggle('narrow',size.value==='narrow');
 document.querySelector('#description').textContent=current.description;document.querySelector('#phase').textContent='';
 const next=new URLSearchParams({scene:current.id,theme:theme.value,size:size.value});history.replaceState(null,'',`?${next}`);
 frame.src=`/tests/fixtures/bee-preview/app.html?${next}&reset=${Date.now()}`;
}
for(const element of [scene,theme,size])element.addEventListener('change',update);
 document.querySelector('#reset').addEventListener('click',update);
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame.contentWindow)return;const data=event.data;if(data?.type!=='bee-preview-phase'||data.scene!==scene.value||typeof data.phase!=='string')return;document.querySelector('#phase').textContent=({current:'报告有效',expired:'核对中…',waiting:'等待自动重试…',retrying:'重试中…',recovered:'核对已恢复',background:'后台核对'})[data.phase]??'';});
update();
