import type {AccountSnapshot,AccountWindow,AccountCapabilities} from '../../system/accounts';
export interface AccountPresentation {identity:string|null;plan:string|null;expiresAt:string|null;windows:AccountWindow[];quotaState:'unknown'|'current'|'stale'}
export function accountPresentation(snapshot:AccountSnapshot|undefined,dirty:boolean,now:number):AccountPresentation {
 const fingerprint=snapshot?.selection.state==='selected'?snapshot.selection.fingerprint:null;
 const result:AccountPresentation={identity:fingerprint?.slice(0,16)??null,plan:null,expiresAt:null,windows:[],quotaState:'unknown'};
 if(!snapshot||!fingerprint)return result;
 const candidate=!dirty&&snapshot.candidate.fingerprint===fingerprint;
 if(candidate){result.plan=snapshot.candidate.plan;result.expiresAt=snapshot.candidate.expires_at;}
 const available=snapshot.capabilities.filter(c=>c.origin==='official'?candidate:snapshot.hive.fingerprint===fingerprint);
 const fresh=(c:AccountCapabilities)=>c.status==='ready'&&!!c.observed_at&&!!c.valid_until&&Date.parse(c.valid_until)>now&&!c.windows.some(w=>w.reset_at&&Date.parse(w.reset_at)<=now)&&!(result.expiresAt&&Date.parse(result.expiresAt)<=now);
 const observation=available.find(c=>c.origin==='official'&&fresh(c))??available.find(fresh)??available.find(c=>c.observed_at);
 if(observation){result.plan=observation.plan??result.plan;result.windows=observation.windows.map(w=>({...w}));result.quotaState=observation.windows.length?(fresh(observation)?'current':'stale'):'unknown';}
 return result;
}
