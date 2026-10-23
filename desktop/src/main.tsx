import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createBusinessClient } from './client/client';
import { debugToolsEnabled } from './client/scenes';
import { createSystemBridge } from './system/bridge';
import './styles/tokens.css';
import './styles/app.css';

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
