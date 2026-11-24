import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
const url="http://127.0.0.1:19471";
let browser;
for(let i=0;i<60 && !browser;i++){
  try{browser=await chromium.connectOverCDP(url,{timeout:1000})}
  catch{await new Promise(r=>setTimeout(r,1000))}
}
assert.ok(browser,"WebView2 CDP endpoint not ready");
try {
  const ctx=browser.contexts()[0];
  const page=ctx.pages().find(p=>p.url().includes("tauri.localhost")) ?? ctx.pages()[0] ?? await ctx.waitForEvent("page");
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.locator("#root").waitFor();
  await page.waitForFunction(()=>document.querySelector("#root")?.innerText.trim().length>40);
  const state=await page.evaluate(async()=>{
    const invoke=window.__TAURI_INTERNALS__.invoke;
    return {version:await invoke("plugin:app|version"), settings:await invoke("get_settings")};
  });
  assert.equal(state.version,JSON.parse(fs.readFileSync("package.json")).version);
  assert.ok(state.settings.datasetRoot);
  fs.mkdirSync("artifacts",{recursive:true});
  await page.screenshot({path:"artifacts/installed-editor.png"});
  assert.deepEqual(errors,[]);
  console.log("Verified rendered desktop and native settings, version",state.version);
} finally {await browser.close()}
