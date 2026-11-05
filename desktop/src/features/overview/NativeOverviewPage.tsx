import type {DesktopPresentation} from '../../presentation/desktopStatus';
import {t} from '../../i18n/index';
import {Button} from '../../components/ui';
import type {ComponentProps} from 'react';
import {DevicePairingPage} from '../device/DevicePairingPage';
import {NativeRuntimeControls} from '../lifecycle/NativeRuntimeControls';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import type {AccountsModel} from '../accounts/useAccounts';
import {NativeAccountList} from '../accounts/NativeAccountList';
import type {SharedSupply} from '../supply/useSupply';
export function NativeOverviewPage({accounts,runtime,supply,presentation,...device}:ComponentProps<typeof DevicePairingPage>&{accounts:AccountsModel;runtime:RuntimeModel;supply?:SharedSupply;presentation:DesktopPresentation}){
 return <><div data-nav-section="runtime" tabIndex={-1}><div data-nav-section="connection" tabIndex={-1}>{accounts.autoService?<p className="auto-service-summary" role="status">{t(presentation.kind==='no_accounts'?'接入账号后，Bee 将自动准备服务。':presentation.kind==='starting'?'正在准备服务…':'Bee 自动维护已接入账号；按平台暂停或恢复接单。')}</p>:<NativeRuntimeControls presentation={presentation} onNavigate={device.onNavigate} runtime={runtime} deviceReady={(!device.recovery||device.recovery.phase==='completed')&&!device.recoveryError&&device.view?.state==='bound'&&!device.error&&!device.busy}/>}</div></div>{presentation.preparationStep&&<section className="preparation-steps" aria-label={t('准备贡献')}><h2>{t('准备贡献')}</h2><ol>{['绑定本机设备','在 Hive 网页确认','接入 AI 账号',accounts.autoService||runtime.view?.local==='waiting'?'按平台恢复接单':'开始贡献并按平台恢复接单'].map((step,index)=><li key={step} aria-current={index===({bind:0,confirm_device:1,connect_account:2}[presentation.preparationStep!])?'step':undefined}>{t(step)}</li>)}</ol>{presentation.primaryTarget?.page==='accounts'&&<Button variant="outline" onClick={()=>device.onNavigate?.(presentation.primaryTarget!)}>{t('前往准备账号')}</Button>}</section>}<div data-nav-section="device" tabIndex={-1}><DevicePairingPage {...device}/></div><NativeAccountList onNavigate={device.onNavigate} context="overview" accounts={accounts} runtime={runtime} supply={supply}/></>;
}
