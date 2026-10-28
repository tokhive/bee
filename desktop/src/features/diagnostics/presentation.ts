import type {DiagnosticCheck} from '../../system/diagnostics';

export interface CheckSections {
 issues:{device:DiagnosticCheck[];openai:DiagnosticCheck[];claude:DiagnosticCheck[]};
 unfinished:DiagnosticCheck[];
 passed:DiagnosticCheck[];
}

export function partitionChecks(checks:readonly DiagnosticCheck[]):CheckSections {
 const sections:CheckSections={issues:{device:[],openai:[],claude:[]},unfinished:[],passed:[]};
 for(const check of checks){
  if(check.status==='pass')sections.passed.push(check);
  else if(check.status==='skipped')sections.unfinished.push(check);
  else sections.issues[check.platform??'device'].push(check);
 }
 return sections;
}
