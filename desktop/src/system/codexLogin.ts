import {decodeAuthorizeValue,decodeAccountError} from './accounts.ts';
import {decodeBridgeError,throwBridgeError} from './failures.ts';
import type {CodexLoginProgress,CodexLoginOpenReceipt} from './codexLogin.contract';

const invalid=(message:string):never=>{throw new Error(`AUTHORIZE_REPLY_INVALID: ${message}`);};
function object(value:unknown,fields:string[],at:string):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid(`${at} requires object`);
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==fields.length||fields.some(k=>!Object.hasOwn(v,k)))return invalid(`${at} requires exact public fields`);
 return v;
}
function result(reply:unknown,instance:string,key:string):unknown{
 if(!reply||typeof reply!=='object'||(reply as {instance?:unknown}).instance!==instance)return invalid('reply.instance differs from current management instance');
 const raw=(reply as {result?:unknown}).result;
 if(raw&&typeof raw==='object'&&'error'in raw){const e=decodeBridgeError(object(raw,['error'],'result').error,'AUTHORIZE_REPLY_INVALID');if(e.code!=='AUTHORIZE_OPERATION_FAILED')invalid('login extension error code rejected');throwBridgeError(e,'AUTHORIZE_REPLY_INVALID');}
 return object(raw,[key],'result')[key];
}
function progress(value:unknown,id:string):CodexLoginProgress{
 const p=object(value,['operation','sequence','phase','stop_reason','recheck_in_flight','actions','blocker'],'progress');
 const op=decodeAuthorizeValue(p.operation);
 if(op.platform!=='openai'||op.id!==id)return invalid('progress requires requested OpenAI operation ID');
 if(typeof p.sequence!=='number'||!Number.isSafeInteger(p.sequence)||p.sequence<0)return invalid('progress.sequence requires nonnegative safe integer');
 if(!['starting','waiting_authorization','verifying','cleaning_up','finished'].includes(String(p.phase))||![null,'cancelled','timed_out','failed'].includes(p.stop_reason as null))return invalid('progress phase or stop reason rejected');
 if(typeof p.recheck_in_flight!=='boolean')return invalid('progress worker requires boolean');
 const a=object(p.actions,['open','cancel','retry','recheck','restart'],'progress.actions');
 if(Object.values(a).some(v=>typeof v!=='boolean'))return invalid('progress actions require booleans');
 const blocker=decodeAccountError(p.blocker,'openai');
 const live=['pending','running'].includes(op.state);
 if(a.cancel&&(!live||['cleaning_up','finished'].includes(String(p.phase))||p.stop_reason!==null)||a.recheck&&p.phase!=='finished'||a.open&&(p.phase!=='waiting_authorization'||!live||p.stop_reason!==null)||p.phase==='finished'&&live||a.retry&&(p.phase!=='finished'||!['failed','cancelled','unknown'].includes(op.state)||blocker!==null)||p.recheck_in_flight&&Object.values(a).some(Boolean))return invalid('progress action permission contradicts phase, stop, blocker or worker evidence');
 return structuredClone(value) as CodexLoginProgress;
}
export function decodeCodexLoginProgress(reply:unknown,instance:string,id:string):CodexLoginProgress{return progress(result(reply,instance,'progress'),id);}
export function decodeCodexLoginOpen(reply:unknown,instance:string,id:string):CodexLoginOpenReceipt{
 const r=object(result(reply,instance,'open'),['opened','error','progress'],'open');
 if(typeof r.opened!=='boolean'||r.opened!==(r.error===null))return invalid('open success and error disagree');
 decodeAccountError(r.error,'openai');progress(r.progress,id);
 return structuredClone(r) as unknown as CodexLoginOpenReceipt;
}
