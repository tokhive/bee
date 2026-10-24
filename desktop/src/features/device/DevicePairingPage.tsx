import type { DeviceView } from '../../system/device';
import { t } from '../../i18n/index';
import { useEffect, useState } from 'react';
export function DevicePairingPage({view,busy,error,begin,refresh,open}:{
 view?:DeviceView;busy:boolean;error:string;
 begin:(hive:string,name:string)=>void;refresh:()=>void;open:()=>void;
}) {
 const [hive,setHive]=useState('');const [name,setName]=useState('Bee Desktop');
 useEffect(()=>{if(view?.hive)setHive(view.hive);if(view?.name)setName(view.name);},[view?.hive,view?.name]);
 const waiting=view?.state==='pending'||view?.state==='draining';
 return <section className="onboarding device-pairing" aria-label={t('设备配对')}>
  <div className="section-heading"><h2>{t('连接本机设备')}</h2><span className="muted">{t('尚未开始贡献')}</span></div>
  <p>{t('在 Hive 网页确认这台设备的归属；绑定不会开始贡献。')}</p>
  {error&&<p role="alert" className="device-error">{t('设备核对失败，未确认本次结果。')}<br/>{error}</p>}
  {busy&&<p role="status">{t('正在核对设备…')}</p>}
  {!error&&!busy&&view?.state==='bound'&&view.identity?<>
   <p role="status">{t('设备已绑定，尚未开始贡献。')}</p>
   <dl><dt>{t('设备名称')}</dt><dd>{view.identity.name}</dd><dt>{t('设备归属')}</dt><dd>{view.identity.owner_email}</dd><dt>{t('设备 ID')}</dt><dd>{view.identity.id}</dd><dt>Hive</dt><dd>{view.hive}</dd></dl>
   <p className="feature-note">{t('这是设备归属核验，独立账号登录尚未接入。')}</p>
  </>:<>
   <form className="settings-form" onSubmit={event=>{event.preventDefault();begin(hive.trim(),name.trim());}}>
    <label>{t('Hive 地址')}<input type="url" required placeholder="https://hive.example" value={hive} disabled={busy||Boolean(view?.hive)} onChange={event=>setHive(event.target.value)}/></label>
    <label>{t('设备名称')}<input required maxLength={80} value={name} disabled={busy||Boolean(view?.hive)} onChange={event=>setName(event.target.value)}/></label>
    {!waiting&&view?.state!=='bound'&&<button className="primary" disabled={busy||!hive||!name} type="submit">{t(view?.state==='expired'?'重新生成配对码':'生成配对码')}</button>}
   </form>
   {!error&&waiting&&<div className="device-pairing-code">
    <h3>{t(view.state==='draining'?'等待旧设备完成任务和结算':'等待网页确认')}</h3>
    <p><strong>{view.user_code}</strong></p>
    <p>{t('完成网页确认后，请回到 Bee。')}</p>
    <p className="feature-note">{t('配对码有效期至')} {new Date(view.expires_at!).toLocaleTimeString()}</p>
    <button className="primary" disabled={busy} onClick={open}>{t('打开 Hive 确认网页')}</button>
    <p className="device-url">{view.verification_url}</p>
   </div>}
   {view?.state==='expired'&&<p>{t('配对码已过期或尚未生成，请重新生成。')}</p>}
  </>}
  <div className="inline-actions"><button disabled={busy} onClick={refresh}>{t('重新核对设备')}</button></div>
  <p className="feature-note">{t('设备配置独立保存，不覆盖 CLI；已有设备的替换请在 Hive 网页核对后确认。')}</p>
 </section>;
}
