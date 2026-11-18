import {useState} from 'react';
import {X} from 'lucide-react';
import {Button} from '../../components/ui';
import {wizardText as w} from './first-launch-copy';

const dismissedFeedback=new Set<string>();

export function DeviceFeedback({id,message,label='关闭绑定结果提示'}:{id:string;message:string;label?:string}){
 const [dismissed,setDismissed]=useState<string>();
 if(dismissed===id||dismissedFeedback.has(id))return null;
 return <div className="device-feedback-item" role="status" tabIndex={-1}><span>{w(message)}</span><Button variant="ghost" size="icon" aria-label={w(label)} onClick={()=>{dismissedFeedback.add(id);setDismissed(id);document.querySelector<HTMLElement>('[data-device-menu]')?.focus();}}><X aria-hidden="true"/></Button></div>;
}
