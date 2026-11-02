const task=await taskSpace(41);
console.log(JSON.stringify({spaceId:task.spaceId,name:task.name,pages:await task.pages(),observed_at:new Date().toISOString()}));
await task.finish({keep:[]});
console.log(JSON.stringify({spaceId:41,finished:true,keep:[],observed_at:new Date().toISOString()}));
