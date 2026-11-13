import {useEffect,useId,useState} from 'react';
import {Popover} from 'radix-ui';
import {CircleAlert} from 'lucide-react';
import {Button} from '../../components/ui';
import {presentFailure} from '../../presentation/problems';
import type {UiFailure} from '../../system/failures';
import {currentLocale,t} from '../../i18n/index';

/** Read-only evidence; no account action or retry is initiated here. */
export function AccountErrorPopover({errors}:{errors:UiFailure[]}){
 const [open,setOpen]=useState(false),titleId=useId();
 const content=errors.map(error=>presentFailure(error,currentLocale()).details).join('\n\n');
 useEffect(()=>setOpen(false),[content]);
 return <Popover.Root open={open} onOpenChange={setOpen}>
  <Popover.Trigger asChild><Button type="button" variant="ghost" className="account-error-trigger" aria-label={t('查看错误详情')} title={t('查看错误详情')}><CircleAlert aria-hidden="true"/></Button></Popover.Trigger>
  <Popover.Portal><Popover.Content className="account-error-popover" side="bottom" align="start" sideOffset={8} collisionPadding={12} aria-labelledby={titleId}>
   <header><h3 id={titleId}>{t('错误详情')}</h3><Popover.Close asChild><Button type="button" variant="ghost" aria-label={t('关闭错误详情')}>{t('关闭')}</Button></Popover.Close></header>
   <pre>{content}</pre>
  </Popover.Content></Popover.Portal>
 </Popover.Root>;
}
