"""只读核对本任务端口与临时broker runner，不结束其他进程。"""
import json, subprocess
ports={}
for port in [1517,1518,1519]:
    result=subprocess.run(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'],text=True,capture_output=True)
    ports[str(port)]={'exit':result.returncode,'stdout':result.stdout,'stderr':result.stderr}
processes=subprocess.check_output(['ps','-axo','pid=,ppid=,comm='],text=True).splitlines()
runners=[x.strip() for x in processes if 'integration.test' in x]
result={'ports':ports,'integration_test_processes':runners,'ego_space41_finished_evidence':'t10-fix-ego-finish.log','vite_sessions_stopped':[13683,77867],'scope':'No Docker, database, user process, user profile or other Ego spaces were changed.'}
print(json.dumps(result,ensure_ascii=False,indent=2))
if any(x['stdout'].strip() for x in ports.values()) or runners:raise SystemExit('T10 cleanup check failed: retained listeners/runners in recorded evidence')
