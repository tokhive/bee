const fs=await import('node:fs/promises');
const task=await taskSpace(43);
const receipt=await task.finish({keep:[]});
const result={spaceId:43,observed_at:new Date().toISOString(),receipt,completedFinishCalls:1,previousAttempt:'Browser.getVersion rejected before finish was invoked; no replayed finish'};
await fs.writeFile('/Users/dayong/myspace/mywork/tokenhive/.worktrees/bee-desktop-p0/docs/desktop/evidence/2026-10-30-interaction-clarity/final-fix-ego-finish-receipt.json',JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify(result));
