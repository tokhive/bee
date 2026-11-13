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
  {accounts.defaultsError&&<FailureNotice failure={accounts.defaultsError} check="account_defaults" onNavigate={onNavigate}/>}
  {deviceError&&<div className="accounts-device-problem"><FailureNotice failure={deviceError} check="device_status" onNavigate={onNavigate}/></div>}
  <NativeAccountList navigationRequest={navigationRequest} onNavigate={onNavigate} context="accounts" accounts={accounts} runtime={runtime} supply={supply}/>
 </>;
}
