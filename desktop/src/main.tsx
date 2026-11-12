import {createHiveSwitchClient} from './system/hiveSwitch';
import {listen} from '@tauri-apps/api/event';
import {createUpdateClient} from './system/updater';
import {createRuntimeClient} from './system/runtime';
import {createAuthorizeClient} from './system/authorize';
import {createAccountClient} from './system/accounts';
import {createPreferencesClient} from './system/preferences';
import {createNotificationsClient} from './system/notifications';
import {createNetworkClient} from './system/network';
import {createDiagnosticsClient} from './system/diagnostics';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { NativeApp } from './app/NativeApp';
import { createSupplyClient, type SupplyBinding } from './system/supply';
import { createDeviceClient } from './system/device';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createBusinessClient } from './client/client';
import { debugToolsEnabled } from './client/scenes';
import { createSystemBridge } from './system/bridge';
import './styles/tokens.css';
import './styles/app.css';

const runtimeFactory=(instance:string)=>createRuntimeClient(invoke,instance);
const authorizeFactory=(instance:string,capabilities?:readonly string[])=>createAuthorizeClient(invoke,instance,capabilities);
const accountFactory=(instance:string)=>createAccountClient(invoke,instance);
const supply = (binding:SupplyBinding) => createSupplyClient(invoke,binding);
const diagnosticsFactory=(instance:string|undefined,revision:number,runId?:string|null,bindingRevision=0)=>createDiagnosticsClient(invoke,instance,revision,runId,bindingRevision);
const hiveSwitchClient=createHiveSwitchClient(invoke,async listener=>listen<{operation_id:string}>('bee://hive-switch-exit-request',event=>{if(typeof event.payload?.operation_id==='string')listener(event.payload.operation_id);}));
async function mount() {
  const root = createRoot(document.getElementById('root')!);
  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV && params.get('prototype') === 'accounts') {
    const {AccountsPrototype} = await import('./prototype/accounts-ui/AccountsPrototype');
    root.render(<React.StrictMode><AccountsPrototype /></React.StrictMode>);
    return;
  }
  if (debugToolsEnabled && params.get('p0') === '1') {
    const [{ P0Page }] = await Promise.all([import('./P0Page'), import('./p0.css')]);
    root.render(
      <React.StrictMode>
        <P0Page />
      </React.StrictMode>,
    );
    return;
  }
  if (isTauri() && import.meta.env.VITE_BEE_DATA_MODE !== 'demo') {
    root.render(<React.StrictMode><NativeApp hiveSwitchClient={hiveSwitchClient} autoService updateClient={createUpdateClient(invoke)} preferencesClient={createPreferencesClient(invoke)} notificationsClient={createNotificationsClient(invoke)} networkClient={createNetworkClient(invoke)} diagnosticsFactory={diagnosticsFactory} openHive={()=>invoke('hive_open',{})} runtimeFactory={runtimeFactory} authorizeFactory={authorizeFactory} accountFactory={accountFactory} supply={supply} client={createDeviceClient(invoke)} systemBridge={createSystemBridge()} /></React.StrictMode>);
    return;
  }
  let initialError: string | undefined;
  let client;
  try {
    client = createBusinessClient(
      import.meta.env.VITE_BEE_DATA_MODE,
      debugToolsEnabled ? (params.get('scene') ?? 'ready') : 'ready',
    );
  } catch (cause) {
    initialError = String(cause);
    client = createBusinessClient('unavailable');
  }
  const systemBridge = createSystemBridge();
  root.render(
    <React.StrictMode>
      <App
        client={client}
        systemBridge={systemBridge}
        initialError={initialError}
        demoMode={import.meta.env.VITE_BEE_DATA_MODE === 'demo'}
      />
    </React.StrictMode>,
  );
}
void mount();
