console.log(JSON.stringify(await listTaskSpaces()));
const task=await taskSpace("T10 fix2 startup feedback 20261103");
console.log(JSON.stringify({spaceId:task.spaceId,page:task.page("p1").label}));
console.log(await task.page("p1").snapshot());
