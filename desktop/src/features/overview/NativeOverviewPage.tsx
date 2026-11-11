import type {DesktopPresentation} from '../../presentation/desktopStatus';
import {t} from '../../i18n/index';
import {Button} from '../../components/ui';
import {FailureNotice} from '../../components/ProblemNotice';
import type {ComponentProps} from 'react';
import {DevicePairingPage} from '../device/DevicePairingPage';
import {NativeRuntimeControls} from '../lifecycle/NativeRuntimeControls';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import type {AccountsModel} from '../accounts/useAccounts';
import {NativeAccountList} from '../accounts/NativeAccountList';
import type {SharedSupply} from '../supply/useSupply';
export function NativeOverviewPage({accounts,runtime,supply,presentation,showAccounts=true,...device}:ComponentProps<typeof DevicePairingPage>&{accounts:AccountsModel;runtime:RuntimeModel;supply?:SharedSupply;presentation:DesktopPresentation;showAccounts?:boolean}){
 const legacy=runtime.view?.legacy_stop;
 const legacyCopy={processing:'正在处理旧版接单状态；确认暂停后自动准备服务。',reconciling:'旧版接单状态的处理结果待确认；正在核对原过程。',blocked:'旧版接单状态转换受阻，请先处理具体问题。',completed:'旧版状态已按暂停接单完成转换；当前选择以各平台状态为准。'};
 return <>{legacy&&<section aria-label={t('升级兼容状态')}><p role="status">{t(legacyCopy[legacy.phase])}</p>{legacy.error&&<FailureNotice failure={legacy.error} check="legacy_stop" onNavigate={device.onNavigate}/>} {legacy.can_recheck&&<Button variant="outline" disabled={runtime.busy||runtime.uncertain||runtime.startBlocked} onClick={()=>void runtime.start([])}>{t('继续核对升级处理')}</Button>}</section>}<div data-nav-section="runtime" tabIndex={-1}><div data-nav-section="connection" tabIndex={-1}><NativeRuntimeControls autoService={accounts.autoService} presentation={presentation} onNavigate={device.onNavigate} runtime={runtime} deviceReady={(!device.recovery||device.recovery.phase==='completed')&&!device.recoveryError&&device.view?.state==='bound'&&!device.error&&!device.busy}/></div></div>{presentation.preparationStep&&<section className="preparation-steps" aria-label={t('准备贡献')}><h2>{t('准备贡献')}</h2><ol>{['绑定本机设备','在 Hive 网页确认','接入 AI 账号',accounts.autoService||runtime.view?.local==='waiting'?'按平台恢复接单':'开始贡献并按平台恢复接单'].map((step,index)=><li key={step} aria-current={index===({bind:0,confirm_device:1,connect_account:2}[presentation.preparationStep!])?'step':undefined}>{t(step)}</li>)}</ol>{presentation.primaryTarget?.page==='accounts'&&<Button variant="outline" onClick={()=>device.onNavigate?.(presentation.primaryTarget!)}>{t('前往准备账号')}</Button>}</section>}<div data-nav-section="device" tabIndex={-1}><DevicePairingPage {...device}/></div>{showAccounts&&<NativeAccountList onNavigate={device.onNavigate} context="overview" accounts={accounts} runtime={runtime} supply={supply}/>}</>;
}
