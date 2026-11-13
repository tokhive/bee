import type {PresentedProblem} from '../presentation/problems';
import {presentFailure} from '../presentation/problems';
import {normalizeFailure} from '../system/failures';
import type {NavigationTarget} from '../app/navigation';
import {currentLocale,t} from '../i18n/index';
import {Button} from './ui';
export function ProblemNotice({problem,onNavigate}:{problem:PresentedProblem;onNavigate?:(target:NavigationTarget)=>void}) {
 return <div className="problem-notice device-error" role="alert" style={{fontSize:13,lineHeight:1.5,overflowWrap:'anywhere'}}>
  <p style={{fontWeight:600}}>{problem.summary}</p><p>{problem.impact}</p>
  {problem.action&&onNavigate&&<Button variant="outline" onClick={()=>onNavigate(problem.action!)}>{problem.actionLabel??t('查看详情')}</Button>}
  <details><summary style={{minHeight:32,cursor:'pointer'}}>{problem.detailsLabel??t('查看失败详情')}</summary><pre style={{whiteSpace:'pre-wrap',font: 'inherit',fontSize:12}}>{problem.details}</pre></details>
 </div>;
}
export function FailureNotice({failure,check,onNavigate}:{failure:unknown;check:string;onNavigate?:(target:NavigationTarget)=>void}){
 return <ProblemNotice problem={presentFailure(normalizeFailure(failure,check),currentLocale())} onNavigate={onNavigate}/>;
}
