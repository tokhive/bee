import os, sys, json, subprocess, datetime
from pathlib import Path
root=Path('/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0')
out=root/'docs/desktop/evidence/2026-10-30-interaction-clarity'
env=os.environ.copy();env['PATH']='/Users/dayong/.nvm/versions/node/v24.22.1/bin:'+env['PATH']
name=sys.argv[1];args=sys.argv[2:];cwd=root/'desktop'
with (out/name).open('w') as f:
 f.write(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cwd':str(cwd),'argv':args,'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'dirty':subprocess.check_output(['git','status','--short'],cwd=root,text=True),'node':subprocess.check_output(['node','--version'],env=env,text=True).strip()},ensure_ascii=False)+'\n');f.flush()
 result=subprocess.run(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT)
 f.write('\nexit_code='+str(result.returncode)+'\n')
print((out/name).read_text()[-18000:]);sys.exit(result.returncode)
