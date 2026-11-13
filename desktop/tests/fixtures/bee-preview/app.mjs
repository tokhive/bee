import {getScene} from './scenarios.mjs';
import {installPreviewFixture} from './fixture.mjs';
import {installPreviewSession} from './session.mjs';
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
 installPreviewSession(scene.id);
 step='加载正式 NativeApp';await import('/src/main.tsx');
 window.__beePreviewActivate();
 const {t}=await import('/src/i18n/index.ts');
 step=`导航 ${scene.page}`;if(scene.page!=='overview')(await until(()=>button(t({accounts:'AI 账号',diagnostics:'诊断',settings:'设置'}[scene.page])))).click();
 await until(()=>document.querySelector('main h1'));
 if(scene.page==='settings'){const tab=scene.id==='settings-network'?'网络与代理':scene.id==='settings-system'?'通知与启动':scene.id==='settings-general'?'通用':'关于';const trigger=await until(()=>button(t(tab)));trigger.focus();trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}
 if(scene.page==='diagnostics'){(await until(()=>button(t('运行诊断')))).click();if(scene.id==='diagnostics-export-unknown'){(await until(()=>button(t('导出脱敏报告')))).click();(await until(()=>button(t('确认导出')))).click();}}
 if(scene.action){
  if(scene.page==='accounts'){
   step='等待正式账号来源初始化';
   await until(()=>window.__beePreviewActivity.accountReadsStarted>0&&window.__beePreviewActivity.accountReads===0);
   await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  if(['detail','clear'].includes(scene.action)){
   step='打开 OpenAI 详情';(await until(()=>document.querySelector('button[aria-label='+JSON.stringify(t('OpenAI 详情'))+']'))).click();
   await until(()=>document.querySelector('.detail-sheet'));
  }
  if(scene.action==='change'){step='核对账号变更';(await until(()=>button(t('核对账号变更')))).click();}
  const names={'prepare-unknown':'重试准备',login:'登录 OpenAI',select:'接入账号',change:'确认换号',clear:'取消接入'};
  if(names[scene.action]){step=`打开正式操作 ${names[scene.action]}`;(await until(()=>button(t(names[scene.action])))).click();}
  if(scene.action!=='detail'&&scene.action!=='prepare-unknown')await until(()=>document.querySelector('.dialog-content'));
  if(scene.action==='prepare-unknown')await until(()=>document.querySelector('[data-nav-section=runtime]')?.textContent.includes(t('状态待确认')));
 }
 window.__beePreviewReady=true;
 window.__beePreviewAnnounceReady();
}catch(cause){
 window.__beePreviewError=`Bee 预览失败：scene=${scene.id}; step=${step}; ${cause instanceof Error?cause.stack:String(cause)}`;
 const error=document.createElement('pre');error.id='preview-error';error.dataset.previewError='true';error.textContent=window.__beePreviewError;document.body.append(error);
 console.error(window.__beePreviewError);
}
