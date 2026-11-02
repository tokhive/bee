"""本轮重建二进制＋真实 Hive/专属临时 PostgreSQL；无 GUI、无默认路由。"""
import hashlib,json,pathlib,subprocess,time
B=pathlib.Path('/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0')
H=B.parent/'hive-desktop-interaction'
network='bee-final-fix-runtime-internal-20261103';db='bee-final-fix-postgres-20261103';qa='bee-final-fix-runtime-qa-20261103';label='bee.final-fix=20261103'
def run(argv,check=True):
 print(json.dumps({'argv':argv}),flush=True)
 r=subprocess.run(argv,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 print(r.stdout,flush=True);print(json.dumps({'exit':r.returncode}),flush=True)
 if check:r.check_returncode()
 return r
for name in ['bee-final-fix','hive-integration-final-fix.test']:
 p=B/'.cache/interaction-clarity-linux'/name
 print(json.dumps({'binary':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}),flush=True)
run(['docker','image','inspect','bee-linux-minimum-window-qa:20261023','postgres:18.1-alpine3.23','--format','{{.Id}}'])
assert not run(['docker','network','ls','--filter','name=^'+network+'$','--format','{{.ID}}']).stdout.strip()
assert not run(['docker','ps','-a','--filter','name=^/'+db+'$','--format','{{.ID}}']).stdout.strip()
created_net=created_db=False
try:
 run(['docker','network','create','--internal','--label',label,network]);created_net=True
 info=json.loads(run(['docker','network','inspect',network]).stdout)[0];assert info['Internal'] is True
 run(['docker','run','--rm','--network',network,'bee-linux-minimum-window-qa:20261023','awk','NR==1{print;next}{print;if ($2 == "00000000") bad=1} END{exit bad}','/proc/net/route'])
 run(['docker','run','-d','--name',db,'--label',label,'--network',network,'-e','POSTGRES_USER=hive','-e','POSTGRES_PASSWORD=hive_local_dev','-e','POSTGRES_DB=hive','postgres:18.1-alpine3.23']);created_db=True
 for attempt in range(40):
  if run(['docker','exec',db,'pg_isready','-U','hive','-d','hive'],check=False).returncode==0:break
  time.sleep(.5)
 else:raise RuntimeError('task PostgreSQL readiness failed: attempts=40 expected=ready')
 run(['docker','run','--rm','--name',qa,'--label',label,'--network',network,'-v',str(B/'.cache/interaction-clarity-linux')+':/qa:ro','-v',str(H)+':/hive:ro','-w','/hive/hive/internal/integration','-e','TEST_BEE_BIN=/qa/bee-final-fix','-e','TEST_DATABASE_URL=postgres://hive:hive_local_dev@'+db+':5432/hive?sslmode=disable','-e','TEST_ISOLATED_INTERNAL_NETWORK=1','bee-linux-minimum-window-qa:20261023','/qa/hive-integration-final-fix.test','-test.run','^TestDesktopBroker(FinalBinaryProvenance|Runtime)','-test.v','-test.timeout=240s'])
finally:
 if created_db:
  tag=run(['docker','inspect',db,'--format','{{index .Config.Labels "bee.final-fix"}}']).stdout.strip();assert tag=='20261103'
  run(['docker','rm','-f',db])
 if created_net:
  tag=run(['docker','network','inspect',network,'--format','{{index .Labels "bee.final-fix"}}']).stdout.strip();assert tag=='20261103'
  run(['docker','network','rm',network])
 print('owned final-fix DB/container/network cleanup completed',flush=True)
