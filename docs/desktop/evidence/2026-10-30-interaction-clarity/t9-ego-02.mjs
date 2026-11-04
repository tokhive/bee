const task=await taskSpace(40);const page=task.page('p1');await page.goto('http://127.0.0.1:1490/');await page.waitForSelector('loc=role:button[name="设置"]');console.log(await page.snapshot());
