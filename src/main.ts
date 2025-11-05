import { signal } from "@preact/signals";
import { Diagnostic } from "@codemirror/lint";
import { useEffect, useRef, useState } from "preact/hooks";
import { h, render, VNode } from "preact";
import { ChangeEvent } from "preact/compat";
import { archive, preload } from "./preload.ts";
import { b64decode, b64encode } from "./base64";
import {
  AbstractEditor,
  EditorDelegate,
  TopData,
  Marker,
  WorkerReq,
  CompileRes,
} from "./types.ts";
import { CMEditor } from "./cmeditor.ts";
import { deflate } from "./deflate.ts";
import { inflate } from "./inflate.ts";
// import { IPC } from "./ipc.ts";


// monaco.languages.register({ id: "idris" });
// monaco.languages.setMonarchTokensProvider("idris", idrisTokens);
// monaco.languages.setLanguageConfiguration("idris", idrisConfig);
// monaco.languages.registerHoverProvider("idris", {
//   provideHover: async (model, pos, token, ctx) => {
//     // getToken doesn't work because of the parsing in :typeat
//     const word = model.getWordAtPosition(pos);
//     if (word) {
//       let range: monaco.IRange = {
//         startLineNumber: pos.lineNumber,
//         startColumn: word.startColumn,
//         endColumn: word.endColumn,
//         endLineNumber: pos.lineNumber,
//       };
//       // TODO - need to distinguish errors from proper results (both emit text)
//       let res = await runCommand(
//         "repl",
//         `:typeat ${pos.lineNumber} ${word.startColumn} ${word.word}`
//       );
//       if (res && !res.startsWith('ERROR')) {
//         return {
//           contents: [{ value: "```\n" + res + "\n```" }],
//           range,
//         };
//       }
//     }
//     return undefined;
//   },
// });

const iframe = document.createElement("iframe");
iframe.src = "frame.html";
iframe.style.display = "none";
document.body.appendChild(iframe);

const idrisWorker = new Worker("worker.js");

function getFilename(src: string) {
  let module = "Main";
  let m = src.match(/module (\w+)/);
  if (m) module = m[1];
  return `${module}.idr`;
}
let replHeader = "";
async function build(src: string) {
  if (!replHeader) {
    replHeader = await runCommand("repl", "");
    state.repl.value += replHeader;
  }
  let fn = getFilename(src);
  console.log("FN", fn);
  let result = await runCommand("save", src);
  console.log("saved", result);
  let output = await runCommand("repl", `:load "${fn}"`);
  console.log("output now", result);
  state.output.value = output;
  state.repl.value += output;
  state.javascript.value = "";
  // state for the old build method
  state.result.value = {
    output,
    javascript: "",
    id: "",
    cases: "",
    duration: 0,
  };
}

type Suspense<T> = {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
};

const callbacks: Record<string, Suspense<string>> = {};

function runCommand(cmd: WorkerReq["cmd"], src: string) {
  let id = crypto.randomUUID();
  idrisWorker.postMessage({ id, cmd, src });
  return new Promise<string>(
    (resolve, reject) => (callbacks[id] = { resolve, reject })
  );
}
// make the run thinger update javacript first if empty
async function runOutput() {
  if (!state.javascript.value) await updateJavascript()
  const src = state.javascript.value;
  console.log("RUN", iframe.contentWindow);
  try {
    iframe.contentWindow?.postMessage({ cmd: "exec", src }, "*");
  } catch (e) {
    console.error(e);
  }
}

window.onmessage = (ev) => {
  console.log("window got", ev.data);
  if (ev.data.messages) state.messages.value = ev.data.messages;
};

idrisWorker.onmessage = (ev: MessageEvent<CompileRes>) => {
  let suspense = callbacks[ev.data.id];
  console.log("MSG", ev.data, "suspense", suspense);
  if (suspense) {
    suspense.resolve(ev.data.output);
    delete callbacks[ev.data.id];
  } else {
    console.log("OLDSCHOOL");
    state.result.value = ev.data;
    state.output.value = ev.data.output;
    state.javascript.value = ev.data.javascript;
  }
};

const state = {
  result: signal<CompileRes | null>(null),
  repl: signal<string>(""),
  output: signal(""),
  javascript: signal(""),
  dark: signal(false),
  messages: signal<string[]>([]),
  editor: signal<AbstractEditor | null>(null),
  toast: signal(""),
};
window.state = state;

if (window.matchMedia) {
  function checkDark(ev: { matches: boolean }) {
    if (ev.matches) {
      document.body.className = "dark";
      state.dark.value = true;
      state.editor.value?.setDark(true);
    } else {
      document.body.className = "light";
      state.dark.value = false;
      state.editor.value?.setDark(false);
    }
  }
  let query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", checkDark);
  checkDark(query);
}

async function loadFile(fn: string) {
  if (fn) {
    const res = await fetch(fn);
    const text = await res.text();
    state.editor.value!.setValue(text);
  }
}

document.addEventListener("keydown", async (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.code == "KeyS") {
    ev.preventDefault();
    let src = state.editor.value!.getValue();
    let hash = `#code/${b64encode(deflate(new TextEncoder().encode(src)))}`;
    window.location.hash = hash;
    await navigator.clipboard.writeText(window.location.href);
    state.toast.value = "URL copied to clipboard";
    setTimeout(() => (state.toast.value = ""), 2_000);
  }
});

function getSavedCode() {
  let value: string = localStorage.idrisCode || LOADING;
  let hash = window.location.hash;
  if (hash.startsWith("#code/")) {
    try {
      value = new TextDecoder().decode(inflate(b64decode(hash.slice(6))));
    } catch (e) {
      console.error(e);
    }
  }
  return value;
}

const LOADING = "module Loading\n";

let value = getSavedCode();
let initialVertical = localStorage.vertical == "true";

interface EditorProps {
  initialValue: string;
}

const language: EditorDelegate = {
  async getEntry(word, _row, _col) {
    let res = await runCommand("repl", `:typeat ${_row} ${_col} ${word}`);
    if (res && !res.startsWith("ERROR")) {
      return {
        fc: {
          file: "FIXME",
          line: _row,
          col: _col,
        },
        name: word,
        type: res,
      };
    }
    return undefined;
  },
  async caseSplit(word, _row, _col) {
    let res = await runCommand("repl", `:cs ${_row} ${_col} ${word}`);
    if (res && !res.startsWith("ERROR") && !res.startsWith("No clause")) return res;
    return undefined;
  },
  async command(cmd, word, row, col) {
    if (cmd == "proofSearch") {
      let res = await runCommand("repl", `:ps ${row} ${word}`);
      if (res && !res.startsWith("ERROR")) return res;
      console.error(res)
      return undefined;
    }
    if (cmd == "intro") {
      let res = await runCommand("repl", `:intro ${row} ${word}`);
      if (res && !res.startsWith("ERROR")) return res;
      console.error(res)
      return undefined;
    }
    return undefined;
  },
  onChange(_value) {
    // we're using lint() now
  },
  async lint(view) {
    let src = view.state.doc.toString();
    localStorage.idrisCode = src;
    let value = src;

    await build(value);
    let markers = processOutput(state.output.value);
    try {
      let diags: Diagnostic[] = [];
      for (let marker of markers) {
        let col = marker.startColumn;

        let line = view.state.doc.line(marker.startLineNumber);
        const pos = line.from + col - 1;
        let word = view.state.wordAt(pos);
        diags.push({
          from: word?.from ?? pos,
          to: word?.to ?? pos + 1,
          severity: marker.severity,
          message: marker.message,
        });
      }
      return diags;
    } catch (e) {
      console.error(e);
    }
    return [];
  },
};

function Editor({ initialValue }: EditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = ref.current!;
    const editor = new CMEditor(container, value, language);
    state.editor.value = editor;
    editor.setDark(state.dark.value)

    if (initialValue === LOADING) loadFile("Main.idr");
    else build(initialValue);
  }, []);

  return h("div", { id: "editor", ref });
}

async function updateJavascript() {
  await runCommand("build", state.editor.value?.getValue() ?? '')
  let javascript = await runCommand("load", "build/exec/out.js");
  state.javascript.value = javascript;
}

// for extra credit, we could have a read-only monaco
function JavaScript() {
  const text = state.javascript.value;
  useEffect(() => {
    if (!text) updateJavascript().catch(console.error);
  }, [text]);
  return h("div", { id: "javascript" }, text);
}

function Result({ field }: { field: keyof CompileRes }) {
  const text = state.result.value?.[field];
  return h("div", { id: field }, text);
}

function Console() {
  const messages = state.messages.value ?? [];
  return h(
    "div",
    { id: "console" },
    messages.map((msg) => h("div", { className: "message" }, msg))
  );
}

function Repl() {
  let [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.replHistory)
    } catch (e) {
      return []
    }
  })
  let [tmpHistory, setTmpHistory] = useState<string[]>(history.concat(''))
  let [pos, setPos] = useState(tmpHistory.length - 1)

  let onKeyDown = async (ev: KeyboardEvent) => {
    if (ev.target instanceof HTMLInputElement) {
      const input = ev.target
      let delta = 0
      if (ev.code === 'ArrowUp') delta = -1
      if (ev.code === 'ArrowDown') delta = 1
      if (delta !== 0) {
        ev.preventDefault()
        if (tmpHistory[pos+delta] !== undefined) {
          setPos(pos + delta)
          setTmpHistory(tmpHistory => {
            let tmp = tmpHistory.slice(0)
            tmp[pos] = input.value
            input.value = tmp[pos+delta]
            return tmp
          })
        }
      }
    }
  }
  let onKeyPress = async (ev: KeyboardEvent) => {
    if (ev.code === "KeyL" && ev.ctrlKey) {
      state.repl.value = replHeader
    }
    if (ev.key === "Enter") {
      if (ev.target instanceof HTMLInputElement) {
        let cmd = ev.target.value;
        state.repl.value += `> ${cmd}\n`;
        let resp = await runCommand("repl", cmd);
        state.repl.value += resp + "\n";
        const newHistory = history.slice(0)
        if (newHistory[newHistory.length-1] !== cmd)
            newHistory.push(cmd)
        while (newHistory.length > 20) newHistory.shift()
        setHistory(newHistory)
        setPos(tmpHistory.length)
        setTmpHistory((history.concat(cmd)).concat(''))
        ev.target.value = "";
        localStorage.replHistory = JSON.stringify(newHistory)
      }
    }
  };
  let onClick = () => (state.repl.value = replHeader);
  let ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = Math.max(
        0,
        ref.current.scrollHeight - ref.current.clientHeight
      );
    }
  });
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), [])
  return h(
    "div",
    { id: "repl", className: "vbox" },
    h("div", { className: "replTop stretch", ref }, state.repl.value),
    h(
      "div",
      { className: "replBottom hbox" },
      h("div", { className: 'prompt'}, "›"),
      h("input", { onKeyPress, onKeyDown, ref: inputRef, className: "stretch" }),
      h("button", { className: "clear", title: 'clear', onClick }, "⨂")
    )
  );
}

const REPL = "REPL";
const OUTPUT = "Output";
const JAVASCRIPT = "JS Source";
const CONSOLE = "JS Console";
const CASES = "Case Trees";

let TABS = [OUTPUT, REPL, JAVASCRIPT, CONSOLE]

function Tabs() {
  const [selected, setSelected] = useState(TABS.includes(localStorage.tab) ? localStorage.tab : OUTPUT);
  const Tab = (label: string) => {
    let onClick = () => {
      setSelected(label);
      localStorage.tab = label;
    };
    let className = "tab";
    if (label == selected) className += " selected";
    return h("div", { className, onClick }, label);
  };

  useEffect(() => {
    if (!state.messages.value) setSelected(CONSOLE);
  }, [state.messages.value]);

  let body;
  switch (selected) {
    case REPL:
      body = h(Repl, {});
      break;
    case JAVASCRIPT:
      body = h(JavaScript, {});
      break;
    case CONSOLE:
      body = h(Console, {});
      break;
    case CASES:
      body = h(Result, { field: "cases" });
      break;
    case OUTPUT:
      body = h(Result, { field: "output" });
      break;
    default:
      body = h("div", {});
  }

  return h(
    "div",
    { className: "tabPanel right" },
    h(
      "div",
      { className: "tabBar" },
      Tab(OUTPUT),
      Tab(REPL),
      Tab(JAVASCRIPT),
      Tab(CONSOLE),
      // Tab(CASES),
    ),
    h("div", { className: "tabBody" }, body)
  );
}

const SAMPLES = ["Main.idr", "BTree.idr", "Interp.idr"];

function EditWrap({
  vertical,
  toggle,
}: {
  vertical: boolean;
  toggle: () => void;
}) {
  const options = SAMPLES.map((value) => h("option", { value }, value));

  const onChange = async (ev: ChangeEvent) => {
    if (ev.target instanceof HTMLSelectElement) {
      let fn = ev.target.value;
      ev.target.value = "";
      loadFile(fn);
    }
  };
  // let play = "M0 0 L20 10 L0 20 z";
  let svg = (d: string) =>
    h("svg", { width: 20, height: 20, className: "icon" }, h("path", { d }));
  let d = vertical
    ? "M0 0 h20 v20 h-20 z M0 10 h20"
    : "M0 0 h20 v20 h-20 z M10 0 v20";
  return h(
    "div",
    { className: "tabPanel left" },
    h(
      "div",
      { className: "tabBar" },
      h(
        "select",
        { onChange },
        h("option", { value: "" }, "load sample"),
        options
      ),
      h("div", { style: { flex: "1 1" } }),
      // h("button", { onClick: runOutput }, svg(play)),
      h("button", { onClick: runOutput, title: 'run output' }, "▶"),
      h("button", { onClick: toggle }, svg(d))
    ),
    h(
      "div",
      { className: "tabBody editor" },
      h(Editor, { initialValue: value })
    )
  );
}

function App() {
  let [vertical, setVertical] = useState(initialVertical);
  let toggle = () => {
    setVertical(!vertical);
    localStorage.vertical = !vertical;
  };
  let className = `wrapper ${vertical ? "vertical" : "horizontal"}`;
  let toast;
  if (state.toast.value) {
    toast = h("p", { className: "toast" }, h("div", {}, state.toast.value));
  }
  return h(
    "div",
    { className },
    toast,
    h(EditWrap, { vertical, toggle }),
    h(Tabs, {})
  );
}

render(h(App, {}), document.getElementById("app")!);

let timeout: any;

const processOutput = (
  output: string
) => {
  let markers: Marker[] = [];
  let lines = output.split("\n");
  let error: undefined | ["ERROR", string];
  let FCRE = /^\w+:(\d+):(\d+)--(\d+):(\d+).*/m;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (line.match(/^Error: .*/)) {
      // sometimes there is a blank line and then the chunk with the location
      while (lines[i + 1] || lines[i + 2]?.match(FCRE))
        line = line + "\n" + lines[++i];
      error = ["ERROR", line];
    }
    // Foo:4:25--4:29
    const match = line.match(FCRE);
    if (match && error) {
      let [_full, sr, sc, er, ec] = match;
      let [kind, message] = error;
      markers.push({
        severity: kind === "ERROR" ? "error" : "info",
        message,
        startLineNumber: +sr,
        startColumn: +sc,
        endLineNumber: +er,
        endColumn: +ec,
      });
      error = undefined;
    }
  }
  console.log("markers", markers);
  return markers;
};
