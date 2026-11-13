import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountFixture} from './fixtures/native-accounts.mjs';
import type {DesktopSnapshot} from '../src/system/desktopState.ts';
const module=await import('../src/presentation/desktopStatus.ts').catch(()=>({deriveDesktopStatus:undefined}));
const now=Date.parse('2026-11-02T04:00:00Z');
const refresh={state:'scheduled',nextRetryAt:new Date(now+10000).toISOString(),lastConfirmedAt:new Date(now).toISOString()};
const failure={code:'device_replaced',check:'device_identity',observedAt:new Date(now).toISOString(),evidence:{http_status:'401'},message:'HTTP 401 device_replaced'};
function fixture():any {
 const accounts=Object.fromEntries(['openai','claude'].map(p=>{const a=accountFixture(p) as any;a.selection.state='selected';return [p,a];}));
 const supplies=Object.fromEntries(['openai','claude'].map(p=>[p,{platform:p,hive:'https://hive.example',device_id:'device',paused:false,ready:true,reasons:[],checked_at:new Date(now).toISOString()}]));
 return {native:{state:'ready',metadata:{instance:'a'.repeat(32)}},bindingRevision:1,device:{state:'bound',hive:'https://hive.example',identity:{id:'device'}},deviceError:null,accounts,accountErrors:{},supplies,supplyErrors:{},error:null,busy:false,refresh,accountRefresh:{openai:refresh,claude:refresh},supplyRefresh:{openai:refresh,claude:refresh},runtime:{revision:1,network_revision:0,run_id:'b'.repeat(32),local:'running',connection:'connected',connection_detail:null,platforms:Object.fromEntries(['openai','claude'].map(p=>[p,{account:accounts[p],supply:supplies[p]}]))}};
}
function derive(s:DesktopSnapshot,time=now){assert.equal(typeof module.deriveDesktopStatus,'function','shared desktop status derivation must exist');return module.deriveDesktopStatus!(s,time);}
const cases:[string,(s:any)=>void,string][]=[
 ['fresh ready',()=>{},'ready'],
 ['shared failed read suppresses old success',s=>s.error={...failure,code:'timeout'},'unconfirmed'],
 ['recovery read failure suppresses confirmed old success',s=>s.recoveryError={...failure,code:'DEVICE_RECOVERY_FAILED',check:'device_recovery_status',evidence:{},message:'recovery admission rejected: account_workers=1'},'unconfirmed'],
 ['confirmed revocation precedes stopped and unknown accounts',s=>{s.deviceError=failure;s.runtime.local='stopped';s.accounts={};s.accountErrors={openai:{...failure,code:'source_missing'}};},'rejected'],
 ['startup rejection does not depend on accounts',s=>{s.startup={state:'blocked',failure,instance:s.native.metadata.instance,binding_revision:1,network_revision:0,revision:1};s.accounts={};},'rejected'],
 ['starting precedes empty accounts',s=>{s.runtime.local='starting';for(const a of Object.values(s.accounts) as any[])a.selection.state='not_selected';},'starting'],
 ['known empty accounts',s=>{for(const a of Object.values(s.accounts) as any[])a.selection.state='not_selected';},'no_accounts'],
 ['selected stopped',s=>s.runtime.local='stopped','stopped'],
 ['unknown accounts are not zero',s=>{s.accounts={};s.accountRefresh={};s.runtime.platforms={};},'unconfirmed'],
 ['first read',s=>{s.device=undefined;s.runtime=undefined;s.accounts={};s.refresh={state:'reading',nextRetryAt:null,lastConfirmedAt:null};},'loading'],
 ['all paused',s=>{for(const v of Object.values(s.supplies) as any[]){v.paused=true;v.ready=false;v.reasons=['manually_paused','quota_unknown'];}},'paused'],
 ['expired success cannot be ready',()=>{},'blocked'],
];
for(const [name,change,kind]of cases)test(name,()=>{const s=fixture();change(s);assert.equal(derive(s,name.startsWith('expired')?now+30001:now).kind,kind);});
test('one platform failure preserves the other confirmed ready platform',()=>{const s=fixture();s.accountErrors.openai={...failure,code:'source_missing'};const p=derive(s);assert.equal(p.kind,'ready');assert.deepEqual(p.readyPlatforms,['claude']);assert.deepEqual(p.blockedPlatforms,['openai']);});
test('recovery read failure retains its evidence and blocks every ready platform',()=>{const s=fixture();s.recoveryError={...failure,code:'DEVICE_RECOVERY_FAILED',check:'device_recovery_status',message:'recovery admission rejected: account_workers=1'};const p=derive(s);assert.equal(p.problem,s.recoveryError);assert.deepEqual(p.readyPlatforms,[]);});
test('paused keeps independent blockers in the original snapshot',()=>{const s=fixture();for(const v of Object.values(s.supplies) as any[]){v.paused=true;v.ready=false;v.reasons=['manually_paused','quota_unknown'];}const p=derive(s);assert.equal(p.kind,'paused');assert.deepEqual(p.blockedPlatforms,['openai','claude']);assert.deepEqual(s.supplies.openai.reasons,['manually_paused','quota_unknown']);});
test('preparation closes after a selected account, including ordinary stop',()=>{const s=fixture();s.runtime.local='stopped';assert.equal(derive(s).preparationStep,null);for(const a of Object.values(s.accounts) as any[])a.selection.state='not_selected';assert.equal(derive(s).preparationStep,'connect_account');});
for(const phase of ['awaiting_confirmation','creation_unknown','redemption_unknown','saving','awaiting_owner_confirmation'])test('initial transaction '+phase+' stays pairing',()=>{const s=fixture();s.device={state:'pairing',recovery:{phase,old_identity:null}};const p=derive(s);assert.equal(p.kind,'pairing');assert.equal(p.preparationStep,'confirm_device');});
