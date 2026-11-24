import fs from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const installer = process.argv[2];
assert.ok(installer, "Provide the signed production installer");
const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json"));
const signature = fs.readFileSync(installer+".sig","utf8").trim();
const updaterPort = 19472;
const appPort = 19471;
const payload = fs.readFileSync(installer);
const corrupted = Buffer.from(payload);
corrupted[corrupted.length-1] ^= 1;
let version=config.version, served=corrupted, downloads=0;
const server=http.createServer((req,res)=>{
  if(req.url==="/latest.json"){
    const platform={url:"http://127.0.0.1:"+updaterPort+"/installer.exe",signature};
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({version,notes:"FoleyMarks local update verification",platforms:{"windows-x86_64":platform,"windows-x86_64-nsis":platform}}));
  }else if(req.url==="/installer.exe"){
    downloads++;
    res.setHeader("Content-Length",served.byteLength);
    res.end(served);
  }else res.writeHead(404).end();
});
await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(updaterPort,"127.0.0.1",resolve)});
const endpoint="http://127.0.0.1:"+appPort;
async function connect(){
  for(let i=0;i<60;i++){
    try{
      const browser=await chromium.connectOverCDP(endpoint,{timeout:1000});
      const ctx=browser.contexts()[0];
      const page=ctx.pages().find(p=>p.url().includes("tauri.localhost")) ?? ctx.pages()[0] ?? await ctx.waitForEvent("page");
      await page.locator("#root").waitFor({timeout:6000});
      return {browser,page};
    }catch{await new Promise(r=>setTimeout(r,1000))}
  }
  throw Error("WebView2 CDP did not respond");
}
const getState=page=>page.evaluate(async()=>{
  const invoke=window.__TAURI_INTERNALS__.invoke;
  return {version:await invoke("plugin:app|version"),settings:await invoke("get_settings"), recovery:await invoke("load_recovery")};
});
let browser;
try{
  const old=await connect();browser=old.browser;
  const before=await getState(old.page);
  assert.equal(before.version,"0.9.0");
  await old.page.getByRole("button",{name:"Settings",exact:true}).click();
  await old.page.getByRole("button",{name:"Updates",exact:true}).click();
  const check=old.page.getByRole("button",{name:"Check for updates",exact:true});
  const install=old.page.getByRole("button",{name:"Save work & install"});
  const status=old.page.getByRole("dialog").getByRole("status");
  version="0.8.0";
  await check.click();
  await status.filter({hasText:"up to date"}).waitFor();
  version=config.version;
  await check.click();
  await old.page.getByText("FoleyMarks local update verification",{exact:true}).waitFor();
  await install.click();
  await status.filter({hasText:/signature|validation|verification/i}).waitFor({timeout:120000});
  assert.equal(downloads,1);
  served=payload;
  await install.click();
  await Promise.race([old.page.waitForEvent("close",{timeout:120000}),browser.waitForEvent("disconnected",{timeout:120000})]);
  const updated=await connect();browser=updated.browser;
  const after=await getState(updated.page);
  assert.equal(after.version,config.version);
  assert.deepEqual(after.settings,before.settings);
  if(before.recovery)assert.deepEqual(after.recovery,before.recovery);
  assert.equal(downloads,2);
  console.log("Verified downgrade rejection, tamper rejection, signed in-place upgrade, restart and persistent settings.");
}finally{
  if(browser?.isConnected())await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
