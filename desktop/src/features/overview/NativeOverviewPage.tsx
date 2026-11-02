import type {ComponentProps} from 'react';
import {DevicePairingPage} from '../device/DevicePairingPage';
import {NativeRuntimeControls} from '../lifecycle/NativeRuntimeControls';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import type {AccountsModel} from '../accounts/useAccounts';
import {NativeAccountList} from '../accounts/NativeAccountList';
import type {SharedSupply} from '../supply/useSupply';
export function NativeOverviewPage({accounts,runtime,supply,...device}:ComponentProps<typeof DevicePairingPage>&{accounts:AccountsModel;runtime:RuntimeModel;supply?:SharedSupply}){
 return <><div data-nav-section="runtime" tabIndex={-1}><div data-nav-section="connection" tabIndex={-1}><NativeRuntimeControls runtime={runtime} deviceReady={device.view?.state==='bound'&&!device.error&&!device.busy}/></div></div><div data-nav-section="device" tabIndex={-1}><DevicePairingPage {...device}/></div><NativeAccountList onNavigate={device.onNavigate} context="overview" accounts={accounts} runtime={runtime} supply={supply}/></>;
}
