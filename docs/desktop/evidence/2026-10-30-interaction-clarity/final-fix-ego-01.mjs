const task=await taskSpace('bee-final-fix-20261103'),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:860,height:600,deviceScaleFactor:1,mobile:false});
await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
await page.goto('http://127.0.0.1:1519/tests/fixtures/bee-preview/app.html?scene=device-pending&locale=zh&theme=light');
await page.waitForFunction(()=>window.__beePreviewReady||window.__beePreviewError);
console.log(JSON.stringify({spaceId:task.spaceId,ownership:task.ownership,page:page.label,url:await page.url()}));
console.log(await page.snapshot());
