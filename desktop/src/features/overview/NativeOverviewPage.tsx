import type {DesktopPresentation} from '../../presentation/desktopStatus';
import {normalizeFailure} from '../../system/failures';
import {deviceProblem} from '../device/devicePresentation';
import {t} from '../../i18n/index';
import {Button} from '../../components/ui';
import {FailureNotice} from '../../components/ProblemNotice';
import type {ComponentProps} from 'react';
import {DevicePairingPage} from '../device/DevicePairingPage';
import {NativeRuntimeControls} from '../lifecycle/NativeRuntimeControls';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import type {AccountsModel} from '../accounts/useAccounts';
import {NativeAccountList} from '../accounts/NativeAccountList';
import {platforms,supplyFresh,type SharedSupply} from '../supply/useSupply';
export function NativeOverviewPage({accounts,runtime,supply,presentation,showAccounts=true,...device}:ComponentProps<typeof DevicePairingPage>&{accounts:AccountsModel;runtime:RuntimeModel;supply?:SharedSupply;presentation:DesktopPresentation;showAccounts?:boolean}){
 const legacy=runtime.view?.legacy_stop;
 const connectionFailure=runtime.view?.connection_detail?.failure;
 const deviceFailure=device.error??device.reportedFailure??device.recoveryError;
 const connectionIssue=!runtime.stalled&&!deviceFailure&&!device.switching&&(!device.recovery||device.recovery.phase==='completed')&&connectionFailure?normalizeFailure(connectionFailure,'connection'):null;
 const sharedFailure=deviceFailure??connectionIssue;
 const recovery=device.recovery??device.view?.recovery;
 const deviceBlock=device.switching?'等待 Hive 切换':recovery&&recovery.phase!=='completed'?recovery.old_identity?'等待设备绑定修复':'等待设备状态核对':sharedFailure?deviceProblem(sharedFailure).action==='repair'?'等待设备绑定修复':deviceProblem(sharedFailure).action==='retry'?'等待 Hive 连接':'等待设备状态核对':undefined;

 const selected=platforms.filter(p=>accounts.views[p]?.selection.state==='selected');
 const countsKnown=!sharedFailure&&!device.switching&&!accounts.deviceFailure&&!runtime.error&&!runtime.uncertain&&!runtime.stalled&&device.view?.state==='bound'&&!device.error&&!device.recoveryError&&(!device.recovery||device.recovery.phase==='completed')&&platforms.every(p=>accounts.views[p]&&!accounts.errors[p]&&!accounts.readFailures[p]&&!accounts.dirty[p]&&!accounts.uncertain[p]&&(!accounts.accountRefresh||accounts.accountRefresh[p]?.lastConfirmedAt))&&selected.every(p=>supply&&!supply.blocked&&!supply.state.writeBusy&&supplyFresh(supply.state,p));
 const counts=countsKnown?{ready:presentation.readyPlatforms.length,attention:selected.filter(p=>supply!.state.views[p]!.reasons.some(reason=>reason!=='manually_paused')).length}:undefined;
 const legacyCopy={processing:'正在处理旧版接单状态；确认暂停后自动准备服务。',reconciling:'旧版接单状态的处理结果待确认；正在核对原过程。',blocked:'旧版接单状态转换受阻，请先处理具体问题。',completed:'旧版状态已按暂停接单完成转换；当前选择以各平台状态为准。'};
 return <>{legacy&&<section aria-label={t('升级兼容状态')}><p role="status">{t(legacyCopy[legacy.phase])}</p>{legacy.error&&<FailureNotice failure={legacy.error} check="legacy_stop" onNavigate={device.onNavigate}/>} {legacy.can_recheck&&<Button variant="outline" disabled={runtime.busy||runtime.uncertain||runtime.startBlocked} onClick={()=>void runtime.start([])}>{t('继续核对升级处理')}</Button>}</section>}<div data-nav-section="device" tabIndex={-1}><DevicePairingPage {...device} reportedFailure={device.reportedFailure??connectionIssue} retryConnection={connectionIssue?runtime.retryConnection:undefined} statusControl={<div data-nav-section="runtime" tabIndex={-1}><div data-nav-section="connection" tabIndex={-1}><NativeRuntimeControls compact sharedFailure={sharedFailure} suppressConnection={!!connectionIssue||!!deviceFailure||!!device.switching||!!device.checking||!!recovery&&recovery.phase!=='completed'} counts={counts} autoService={accounts.autoService} presentation={presentation} onNavigate={device.onNavigate} runtime={runtime} deviceReady={(!device.recovery||device.recovery.phase==='completed')&&!device.recoveryError&&device.view?.state==='bound'&&!device.error&&!device.busy}/></div></div>}/></div>{showAccounts&&<NativeAccountList deviceBlock={deviceBlock} onNavigate={device.onNavigate} context="overview" accounts={accounts} runtime={runtime} supply={supply}/>}</>;
}
