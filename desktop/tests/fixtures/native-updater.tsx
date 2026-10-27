import React from 'react';
import {createRoot} from 'react-dom/client';
import {NativeUpdateControls} from '../../src/features/settings/NativeUpdateControls';
import {createUpdateClient} from '../../src/system/updater';
import {useLanguage} from '../../src/i18n';
import '../../src/styles/tokens.css';
import '../../src/styles/app.css';
function Fixture() {
  useLanguage(new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh');
  const client = React.useMemo(() => createUpdateClient((command,args) => (window as any).updaterInvoke(command,args)),[]);
  return <main className="settings-page"><p role="status" aria-label="现有贡献">贡献中</p><NativeUpdateControls client={client} pollIntervalMs={80}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
