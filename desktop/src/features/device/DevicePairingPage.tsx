import {formatDate,currentLocale} from '../../i18n/index';
import {FailureNotice} from '../../components/ProblemNotice';
import type {UiFailure} from '../../system/failures';
import type {NavigationTarget} from '../../app/navigation';
import type {DeviceView} from '../../system/device';
import {t} from '../../i18n/index';
import {useEffect,useState} from 'react';
import {ExternalLink,RefreshCw} from 'lucide-react';
import {Button} from '../../components/ui';
export function DevicePairingPage({view,busy,error,begin,refresh,open,onNavigate}:{
 view?:DeviceView;busy:boolean;error:UiFailure|null;onNavigate?:(target:NavigationTarget)=>void;
 begin:(hive:string,name:string)=>void;refresh:()=>void;open:()=>void;
}) {
 const [hive,setHive]=useState(''),[name,setName]=useState('Bee Desktop');
 useEffect(()=>{if(view?.hive)setHive(view.hive);if(view?.name)setName(view.name);},[view?.hive,view?.name]);
 const waiting=view?.state==='pending'||view?.state==='draining';
 const bound=!error&&!busy&&view?.state==='bound'&&view.identity;
 const summary=bound||!error&&waiting;
 return <section className={summary?'native-device-summary':'onboarding device-pairing'} aria-label={t('设备配对')}>
  {bound?<div className="device-facts">
   <div><p>{t('本机设备')}</p><strong>{view.identity!.name}</strong><small role="status">{t('设备已绑定。')}</small></div>
   <div><p>{t('归属账号')}</p><strong>{view.identity!.owner_email}</strong><small>{t('设备所属账号')}</small></div>
   <div><p className="device-fact-heading">Hive<Button variant="ghost" size="icon" disabled={busy} aria-label={t('重新核对设备')} title={t('重新核对设备')} onClick={refresh}><RefreshCw aria-hidden="true"/></Button></p><strong>{view.hive}</strong><small>{t('配对不会自动开始贡献')}</small></div>
  </div>:!error&&waiting?<>
   <div className="device-facts">
    <div><p>{t('配对码')}</p><strong className="pair-code">{view.user_code}</strong><small>{t(view.state==='draining'?'等待旧设备完成任务和结算':'等待网页确认')}</small></div>
    <div><p>{t('有效期至')}</p><strong>{formatDate(view.expires_at!,currentLocale(),{dateStyle:undefined,timeStyle:'medium'})}</strong><small>{t('完成网页确认后，请回到 Bee。')}</small></div>
    <div><p>{t('确认网址')}</p><strong className="device-url">{view.verification_url}</strong><Button variant="ghost" disabled={busy} onClick={open}>{t('打开 Hive 确认网页')}<ExternalLink aria-hidden="true"/></Button></div>
   </div>
  </>:<>
   <div className="section-heading"><h2>{t('连接本机设备')}</h2><span className="muted">{t('设备归属')}</span></div>
   <p>{t('在 Hive 网页确认这台设备的归属；绑定不会开始贡献。')}</p>
   {error&&<FailureNotice failure={error} check="device_status" onNavigate={onNavigate}/>}
   {busy&&<p role="status">{t('正在核对设备…')}</p>}
   {view?.state!=='bound'&&<form className="settings-form" onSubmit={event=>{event.preventDefault();begin(hive.trim(),name.trim());}}>
    <label>{t('Hive 地址')}<input type="url" required placeholder="https://hive.example" value={hive} disabled={busy||Boolean(view?.hive)} onChange={event=>setHive(event.target.value)}/></label>
    <label>{t('设备名称')}<input required maxLength={80} value={name} disabled={busy||Boolean(view?.hive)} onChange={event=>setName(event.target.value)}/></label>
    {!waiting&&<Button disabled={busy||!hive||!name} type="submit">{t(view?.state==='expired'?'重新生成配对码':'生成配对码')}</Button>}
   </form>}
   {view?.state==='expired'&&<p>{t('配对码已过期或尚未生成，请重新生成。')}</p>}
   <div className="inline-actions"><Button variant="outline" disabled={busy} onClick={refresh}>{t('重新核对设备')}</Button></div>
   <p className="feature-note">{t('设备配置独立保存，不覆盖 CLI；已有设备的替换请在 Hive 网页核对后确认。')}</p>
  </>}
 </section>;
}
