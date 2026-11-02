import subprocess,pathlib,os,signal,json
root=pathlib.Path('/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/desktop')
result=subprocess.run(['lsof','-t','-iTCP:1519','-sTCP:LISTEN'],capture_output=True,text=True)
pids=[int(p) for p in result.stdout.split()]
assert len(pids)==1, {'expected':'one owned Vite listener','actual':pids}
pid=pids[0]
command=subprocess.check_output(['ps','-p',str(pid),'-o','command='],text=True).strip()
cwd=subprocess.check_output(['lsof','-a','-p',str(pid),'-d','cwd','-Fn'],text=True)
assert 'node_modules/vite/bin/vite.js' in command and '--port 1519' in command and '\nn'+str(root)+'\n' in cwd, {'pid':pid,'command':command,'cwd':cwd}
os.kill(pid,signal.SIGTERM)
print(json.dumps({'pid':pid,'command':command,'cwd':str(root),'signal':'SIGTERM','intentionalServiceStop':True}))
