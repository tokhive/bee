import {useState} from 'react';
import {X} from 'lucide-react';
import {Button} from '../../components/ui';
import {wizardText as w} from './first-launch-copy';

const feedbackStorageKey='bee.dismissed-device-feedback.v1';
function readDismissedFeedback():Set<string>{
 try{const saved:unknown=JSON.parse(localStorage.getItem(feedbackStorageKey)??'[]');return new Set(Array.isArray(saved)?saved.filter((id):id is string=>typeof id==='string'):[]);}catch{return new Set();}
}
const dismissedFeedback=readDismissedFeedback();
function dismissFeedback(id:string){
 dismissedFeedback.add(id);
 // This is presentation state only. A storage failure must not block dismissal.
 try{localStorage.setItem(feedbackStorageKey,JSON.stringify([...dismissedFeedback]));}catch{/* Keep the current-session dismissal. */}
}

export function DeviceFeedback({id,message,label='关闭绑定结果提示'}:{id:string;message:string;label?:string}){
 const [dismissed,setDismissed]=useState<string>();
 if(dismissed===id||dismissedFeedback.has(id))return null;
 return <div className="device-feedback-item" role="status" tabIndex={-1}><span>{w(message)}</span><Button variant="ghost" size="icon" aria-label={w(label)} onClick={()=>{dismissFeedback(id);setDismissed(id);document.querySelector<HTMLElement>('[data-device-menu]')?.focus();}}><X aria-hidden="true"/></Button></div>;
}
