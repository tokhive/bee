const task=await taskSpace(42);
console.log(JSON.stringify({spaceId:42,pages:await task.pages()}));
console.log(await task.finish({keep:[]}));
