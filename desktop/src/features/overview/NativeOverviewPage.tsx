import type {ComponentProps} from 'react';
import {DevicePairingPage} from '../device/DevicePairingPage';
import {NativeRuntimeControls} from '../lifecycle/NativeRuntimeControls';
import type {RuntimeModel} from '../lifecycle/useRuntime';
import type {AccountsModel} from '../accounts/useAccounts';
import {NativeAccountList} from '../accounts/NativeAccountList';
import type {SharedSupply} from '../supply/useSupply';
export function NativeOverviewPage({accounts,runtime,supply,...device}:ComponentProps<typeof DevicePairingPage>&{accounts:AccountsModel;runtime:RuntimeModel;supply?:SharedSupply}){
 return <><NativeRuntimeControls runtime={runtime} deviceReady={device.view?.state==='bound'&&!device.error&&!device.busy}/><DevicePairingPage {...device}/><NativeAccountList context="overview" accounts={accounts} runtime={runtime} supply={supply}/></>;
}
