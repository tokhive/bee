const task=await taskSpace(42),page=task.page('p1');
console.log(await page.evaluate(()=>({width:innerWidth,height:innerHeight,hasFixture:!!window.t10Fix2Failure,lang:document.documentElement.lang,theme:document.documentElement.dataset.theme,body:document.querySelector('main')?.innerText?.slice(0,1400)})));
console.log(await page.snapshot());
