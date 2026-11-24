import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
const output = "src-tauri/resources/notices";
fs.mkdirSync(output,{recursive:true});
fs.copyFileSync("LICENSE", path.join(output,"APPLICATION.txt"));
const production = Object.entries(JSON.parse(fs.readFileSync("package-lock.json")).packages)
  .filter(([key, item]) => key && !item.dev && fs.existsSync(key));
const metadata=JSON.parse(execFileSync("cargo",["metadata","--format-version","1","--locked","--manifest-path","src-tauri/Cargo.toml"],{encoding:"utf8",maxBuffer:64*1024*1024}));
const crates=metadata.packages.filter(p=>p.name!=="foleymarks").map(p=>[path.dirname(p.manifest_path),p]);
function collect(items,file) {
  const blocks=[];
  for(const [dir,item] of items) {
    const names=fs.readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile() && /^(licen[cs]e|copying|notice|copyright|unlicense)(?:$|[-.])/i.test(x.name));
    blocks.push([item.name ?? dir.replace(/^node_modules\//,""),item.version,item.license].join(" "));
    for(const n of names) blocks.push(fs.readFileSync(path.join(dir,n.name),"utf8"));
    if(!names.length) blocks.push(item.repository?.url ?? (typeof item.repository==="string"?item.repository:""));
  }
  fs.writeFileSync(path.join(output,file),blocks.join("\n\n"));
}
collect(production,"frontend.txt");
collect(crates,"native.txt");
