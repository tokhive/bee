import {FailureNotice} from '../../components/ProblemNotice';
import type {UiFailure} from '../../system/failures';
import type {NavigationRequest,NavigationTarget} from '../../app/navigation';
import type {AccountsModel} from './useAccounts';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import type {SharedSupply} from '../supply/useSupply';
import {NativeAccountList} from './NativeAccountList';
import {t} from '../../i18n/index';
export function NativeAccountsPage({accounts,supply,deviceError,runtime,onNavigate,navigationRequest}:{navigationRequest?:NavigationRequest;accounts:AccountsModel;supply:SharedSupply|undefined;deviceError:UiFailure|null;onNavigate?:(target:NavigationTarget)=>void;runtime:RuntimeModel}){
 return <>
  <p className="accounts-intro">{t('自动读取本机已有登录；接入和换号仍需确认。')}</p>
  {accounts.defaultsError&&<p role="status" className="accounts-intro">{t('凭证读取方式暂不可用，正在自动核对。')}</p>}
  {deviceError&&<FailureNotice failure={deviceError} check="device_status" onNavigate={onNavigate}/>}
  <NativeAccountList navigationRequest={navigationRequest} onNavigate={onNavigate} context="accounts" accounts={accounts} runtime={runtime} supply={supply}/>
 </>;
}
