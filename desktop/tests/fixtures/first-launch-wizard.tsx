import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FirstLaunchWizard,type FirstLaunchWizardProps} from '../../src/features/device/FirstLaunchWizard';
import {useLanguage} from '../../src/i18n';
import '../../src/styles/tokens.css';
import '../../src/styles/app.css';
declare global {interface Window {setWizardProps:(props:Partial<FirstLaunchWizardProps>)=>void}}
function Fixture(){
 const query=new URLSearchParams(location.search);
 useLanguage(query.get('lang')==='en'?'en':'zh');
 document.documentElement.dataset.theme=query.get('theme')??'light';
 const [props,setProps]=useState<Partial<FirstLaunchWizardProps>>({view:{state:'unbound'},refreshStatus:{state:'scheduled',nextRetryAt:null,lastConfirmedAt:null}});
 const [events,setEvents]=useState<string[]>([]);
 window.setWizardProps=next=>setProps(current=>({...current,...next}));
 const record=(value:string)=>setEvents(current=>[...current,value]);
 return <><FirstLaunchWizard busy={false} error={null}
  begin={(hive,name)=>{record(`begin ${hive} ${name}`);return new Promise(()=>{});}}
  refresh={()=>record('refresh')} open={()=>record('open')}
  onNavigate={page=>record(`navigate ${page}`)} onDiagnostics={()=>record('diagnostics')}
  {...props}/><output aria-label="Fixture actions" style={{display:'none'}}>{events.join('\n')}</output></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
