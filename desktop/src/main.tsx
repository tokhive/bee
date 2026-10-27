import {createRuntimeClient} from './system/runtime';
import {createAuthorizeClient} from './system/authorize';
import {createAccountClient} from './system/accounts';
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
const authorizeFactory=(instance:string)=>createAuthorizeClient(invoke,instance);
const accountFactory=(instance:string)=>createAccountClient(invoke,instance);
const supply = (binding:SupplyBinding) => createSupplyClient(invoke,binding);
async function mount() {
  const root = createRoot(document.getElementById('root')!);
  const params = new URLSearchParams(location.search);
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
    root.render(<React.StrictMode><NativeApp runtimeFactory={runtimeFactory} authorizeFactory={authorizeFactory} accountFactory={accountFactory} supply={supply} client={createDeviceClient(invoke)} systemBridge={createSystemBridge()} /></React.StrictMode>);
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
