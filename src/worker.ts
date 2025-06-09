// Worker to run idris on source code
import { shim } from "./emul";
import { archive, preload } from "./preload";
import { WorkerReq, CompileRes } from "./types";


function doCompile(data: WorkerReq) {
  let { id, src } = data;
  let module = "Main";
  let m = src.match(/module (\w+)/);
  if (m) module = m[1];
  let fn = `${module}.idr`;
  const outfile = "build/exec/out.js";
  process.argv = ["foo", "bar", "-c", fn, "-o", "out.js", "--dumpcases", "cases.out"];
  console.log("Using args", process.argv);
  delete shim.files['cases.out']
  shim.files[fn] = new TextEncoder().encode(src);
  shim.files[outfile] = new TextEncoder().encode("No JS output");
  shim.stdout = "";
  const start = +new Date();
  try {
    __mainExpression_0();
  } catch (e) {
    // make it clickable in console
    console.error(e);
    // make it visable on page
    shim.stdout += "\n" + String(e);
  }
  let duration = +new Date() - start;
  console.log(`process ${fn} in ${duration} ms`);
  let javascript = new TextDecoder().decode(shim.files[outfile]);
  let cases = shim.files['cases.out'] ? new TextDecoder().decode(shim.files['cases.out']) : '';
  let output = shim.stdout;
  sendResponse({ cases, javascript, output, duration, id });
}

function doSave(data: WorkerReq) {
  let {id, src} = data
  let module = "Main";
  let m = src.match(/module (\w+)/);
  if (m) module = m[1];
  let fn = `${module}.idr`;
  shim.files[fn] = new TextEncoder().encode(src)
  let resp: any = {id, output: fn}
  console.log('resp', resp)
  sendResponse(resp)
}
function doLoad(data: WorkerReq) {
  let {id, src} = data
  let buf = shim.files[src]
  let resp: any = {id, output: new TextDecoder().decode(buf)}
  sendResponse(resp)
}

let initialized = false
function doRepl(data: WorkerReq) {
  shim.stdout = ''
  if (!initialized) {
    // this runs too early at startup
    process.argv = ["", "", "--dumpcases", "cases.out"];
    __mainExpression_0()
    initialized = true
    console.log(shim.stdout)
  }
  let {src,id} = data
  let start = +new Date()
  let res = runCommand(src)
  let duration = +new Date() - start;
  console.log(src, '->', res)
  let output = shim.stdout
  // res : Either Error REPLResult
  // but thats the Core Error, REPL errors are a REPLError result
  // TODO we signal error with a prepended string for now, but let's return a richer structure
  if (res.h && res.a1.h === 1) output = `ERROR: ${res.a1}`
  sendResponse({id, output, javascript: '', duration, cases:''})
}

const handleMessage = async function (ev: { data: WorkerReq }) {
  console.log("message", ev.data);
  await preload;
  console.log('dispatch')
  shim.archive = archive
  switch (ev.data.cmd) {
    case 'build': return doCompile(ev.data)
    case 'repl': return doRepl(ev.data)
    case 'save': return doSave(ev.data)
    case 'load': return doLoad(ev.data);
    default:
    const _covering: never = ev.data.cmd;
  }
};

// hooks for worker.html to override
let sendResponse: (_: CompileRes) => void = postMessage;
onmessage = handleMessage;

// *** Load idris
importScripts("idris2.js");
