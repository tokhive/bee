import {getScene} from './scenarios.mjs';
import {installPreviewFixture} from './fixture.mjs';
const params=new URLSearchParams(location.search),scene=getScene(params.get('scene'));
let step='安装模拟 IPC';
async function until(find){
 const start=Date.now();
 while(Date.now()-start<15000){const result=find();if(result)return result;await new Promise(resolve=>setTimeout(resolve,30));}
 throw new Error(`preview target timeout; scene=${scene.id}; step=${step}; waited_ms=${Date.now()-start}; required=enabled formal UI target`);
}
const button=(name,scope=document)=>[...scope.querySelectorAll('button')].find(element=>element.textContent.trim()===name&&!element.disabled);
try{
 await installPreviewFixture(scene.id);
 step='加载正式 NativeApp';await import('/src/main.tsx');
 window.__beePreviewActivate();
 step=`导航 ${scene.page}`;(await until(()=>button(scene.page==='accounts'?'AI 账号':'概览'))).click();
 await until(()=>document.querySelector('.native-account-row'));
 if(scene.action){
  if(['detail','change','clear'].includes(scene.action)){
   step='打开 OpenAI 详情';(await until(()=>document.querySelector('button[aria-label="OpenAI 详情"]'))).click();
   await until(()=>document.querySelector('.account-source'));
  }
  const names={'start-unknown':'开始贡献',login:'登录 OpenAI',select:'接入',stop:'停止贡献',change:'换号',clear:'取消接入'};
  if(names[scene.action]){step=`打开正式操作 ${names[scene.action]}`;(await until(()=>button(names[scene.action]))).click();}
  if(scene.action!=='detail'&&scene.action!=='start-unknown')await until(()=>document.querySelector('.dialog-content'));
  if(scene.action==='start-unknown')await until(()=>document.body.textContent.includes('贡献状态待确认'));
 }
 window.__beePreviewReady=true;
}catch(cause){
 window.__beePreviewError=`Bee 预览失败：scene=${scene.id}; step=${step}; ${cause instanceof Error?cause.stack:String(cause)}`;
 const error=document.createElement('pre');error.id='preview-error';error.dataset.previewError='true';error.textContent=window.__beePreviewError;document.body.append(error);
 console.error(window.__beePreviewError);
}
