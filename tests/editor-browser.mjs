import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {createServer} from "node:http"
import {mkdtemp,readFile,rm,stat} from "node:fs/promises"
import {tmpdir} from "node:os"
import path from "node:path"
import {chromium} from "playwright-core"

const temp=await mkdtemp(path.join(tmpdir(),"foley-ui-"))
const ffmpeg=process.env.FOLEY_TEST_FFMPEG||"ffmpeg"
const encode=(args)=>{const r=spawnSync(ffmpeg,["-hide_banner","-loglevel","error","-y",...args],{encoding:"utf8"});if(r.status!==0)throw Error(r.error?.message||r.stderr)}
let browser,server
try{
 encode(["-f","lavfi","-i","testsrc2=size=240x160:rate=25","-t","4","-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart",path.join(temp,"fixture.mp4")])
 encode(["-f","lavfi","-i","sine=frequency=440:duration=1.4",path.join(temp,"tone.wav")])
 const mime={".js":"text/javascript",".css":"text/css",".html":"text/html",".png":"image/png",".mp4":"video/mp4",".wav":"audio/wav"}
 server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,"http://localhost"),name=url.pathname==="/"?"/index.html":url.pathname
   const root=["/fixture.mp4","/tone.wav"].includes(name)?temp:path.resolve("dist")
   const file=path.resolve(root,"."+name)
   if(!file.startsWith(root+path.sep))throw Error("invalid path")
   const [data,info]=await Promise.all([readFile(file),stat(file)]),range=/^bytes=(\d+)-(\d*)/.exec(req.headers.range||"")
   const start=range?+range[1]:0,end=range?.[2]?+range[2]:info.size-1
   res.writeHead(range?206:200,{"content-type":mime[path.extname(file)]||"application/octet-stream","accept-ranges":"bytes","content-length":end-start+1,...(range?{"content-range":"bytes "+start+"-"+end+"/"+info.size}:{})});res.end(data.subarray(start,end+1))
  }catch{res.writeHead(404);res.end()}
 })
 await new Promise(r=>server.listen(0,"127.0.0.1",r))
 browser=await chromium.launch({channel:process.env.FOLEY_TEST_BROWSER||"msedge",headless:true,args:["--autoplay-policy=no-user-gesture-required"]})
 const page=await browser.newPage({viewport:{width:1366,height:850}})
 const errors=[];page.on("pageerror",e=>errors.push(e.message))
 await page.addInitScript(()=>{
  const projectVideo="D:/Fixture Ω/fixture.mp4",sound="F:/Effects/tone.wav"
  window.isTauri=true
  window.__state={project:null,settings:{startup:"blank",autoUpdate:false,backgroundProcessing:false,soundDir:"F:/Effects",datasetRoot:"D:/Fixture Ω"},audio:[]}
  const AudioImpl=window.Audio
  window.Audio=function(...args){const a=new AudioImpl(...args);window.__state.audio.push(a);return a}
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:"main"},currentWebview:{label:"main"}},transformCallback:()=>0,convertFileSrc:p=>p.endsWith(".wav")?"/tone.wav":"/fixture.mp4",invoke:async(cmd,args)=>{
   if(cmd==="get_settings")return window.__state.settings
   if(cmd==="save_settings"){window.__state.settings=args.settings;return}
   if(cmd==="save_recovery"||cmd==="save_project"){window.__state.project=args.project;return}
   if(cmd==="load_project")return window.__state.project
   if(cmd==="scan_dataset")return {videos:[],annotations:[],sounds:[{path:sound,name:"tone.wav",size:9000,category:"Tone"}],missing:[],bytes:9000}
   if(cmd==="pick_path")return args.kind==="video"?projectVideo:args.kind==="audio"?sound:"D:/fixture.foleymarks"
   if(cmd==="probe_media")return {duration:args.path.endsWith(".mp4")?4:1.4,fps:25,width:args.path.endsWith(".mp4")?240:0,height:160}
   if(cmd==="authorize_media")return args.path
   if(cmd==="waveform")return [0,.6,1,.3,.2,.4,.8]
   if(cmd==="plugin:app|version")return "1.0.0"
   if(cmd.startsWith("plugin:event|"))return 1
   throw Error(cmd)
  }}
 })
 await page.goto("http://127.0.0.1:"+server.address().port)
 await page.getByRole("button",{name:"Import video",exact:true}).click()
 await page.waitForFunction(()=>document.querySelector("video")?.readyState>=2)
 await page.locator(".asset").filter({hasText:"tone.wav"}).dblclick()
 await page.locator(".clip.audio").waitFor()
 await page.getByRole("button",{name:"Play",exact:true}).click()
 await page.waitForFunction(()=>document.querySelector("video").currentTime>.25&&window.__state.audio.some(a=>!a.paused&&a.currentTime>.1))
 const delta=await page.evaluate(()=>Math.abs(document.querySelector("video").currentTime-window.__state.audio.find(a=>!a.paused).currentTime))
 assert.ok(delta<.15,"clock difference "+delta)
 await page.getByRole("button",{name:"Pause",exact:true}).click()
 await page.locator(".clip.audio").click()
 await page.keyboard.press("s")
 assert.equal(await page.locator(".clip.audio").count(),2)
 await page.keyboard.press("Control+z");assert.equal(await page.locator(".clip.audio").count(),1)
 await page.keyboard.press("Control+y");assert.equal(await page.locator(".clip.audio").count(),2)
 await page.keyboard.press("Control+s")
 await page.waitForFunction(()=>window.__state.project?.annotations?.length===2)
 await page.getByRole("button",{name:"Settings",exact:true}).click()
 const dialog=page.getByRole("dialog")
 await dialog.locator("label").filter({hasText:/^Theme/}).locator("select").selectOption("light")
 await page.waitForFunction(()=>document.documentElement.dataset.theme==="light")
 await page.getByRole("button",{name:"Dataset & Storage",exact:true}).click()
 assert.ok(await dialog.getByRole("button",{name:"Choose Dataset root",exact:true}).isVisible())
 await page.getByRole("button",{name:"Close",exact:true}).click()
 await page.keyboard.press("Control+o")
 await page.waitForFunction(()=>document.querySelectorAll(".clip.audio").length===2)
 assert.deepEqual(errors,[])
 console.log("Browser UI passed: import, waveform clips, playback, pause, SFX sync, split, undo, redo, save, reload, settings. Observed A/V clock difference:",delta.toFixed(3),"seconds. Native calls mocked.")
} finally {await browser?.close();if(server)await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true})}

