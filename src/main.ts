import { effect, signal } from "@preact/signals";
import { idrisConfig, idrisTokens } from "./monarch.ts";
import * as monaco from "monaco-editor";
import { useEffect, useRef, useState } from "preact/hooks";
import { h, render, VNode } from "preact";
import { ChangeEvent } from "preact/compat";
import { WorkerReq, CompileRes } from "./types.ts";
import { b64decode, b64encode } from "./base64.ts";
import { deflate } from "./deflate.ts";
import { inflate } from "./inflate.ts";

function getToken(model: monaco.editor.ITextModel, pos: monaco.Position) {
  const lineContent = model.getLineContent(pos.lineNumber);
  const regex = /([-+*&<>=]+|\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(lineContent)) !== null) {
    const start = match.index + 1;
    const end = start + match[0].length - 1;
    if (pos.column >= start && pos.column <= end) {
      return { word: match[0], startColumn: start, endColumn: end };
    }
  }
}

monaco.languages.register({ id: "idris" });
monaco.languages.setMonarchTokensProvider("idris", idrisTokens);
monaco.languages.setLanguageConfiguration("idris", idrisConfig);
monaco.languages.registerHoverProvider("idris", {
  provideHover: async (model, pos, token, ctx) => {
    // getToken doesn't work because of the parsing in :typeat
    const word = model.getWordAtPosition(pos);
    if (word) {
      let range: monaco.IRange = {
        startLineNumber: pos.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
        endLineNumber: pos.lineNumber,
      };
      // TODO - need to distinguish errors from proper results (both emit text)
      let res = await runCommand(
        "repl",
        `:typeat ${pos.lineNumber} ${word.startColumn} ${word.word}`
      );
      if (res && !res.startsWith('ERROR')) {
        return {
          contents: [{ value: "```\n" + res + "\n```" }],
          range,
        };
      }
    }
    return undefined;
  },
});

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

self.MonacoEnvironment = {
  getWorkerUrl(moduleId, _label) {
    console.log("Get worker", moduleId);
    return moduleId;
  },
};

const state = {
  result: signal<CompileRes | null>(null),
  repl: signal<string>(""),
  output: signal(""),
  javascript: signal(""),
  messages: signal<string[]>([]),
  editor: signal<monaco.editor.IStandaloneCodeEditor | null>(null),
  toast: signal(""),
};
window.state = state;

if (window.matchMedia) {
  function checkDark(ev: { matches: boolean }) {
    console.log("CHANGE", ev);
    if (ev.matches) {
      monaco.editor.setTheme("vs-dark");
      document.body.className = "dark";
    } else {
      monaco.editor.setTheme("vs");
      document.body.className = "light";
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

// the editor might handle this itself with the right prodding.
effect(() => {
  let text = state.output.value;
  let editor = state.editor.value;
  if (editor) processOutput(editor, text);
});

interface EditorProps {
  initialValue: string;
}

function Editor({ initialValue }: EditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = ref.current!;
    const editor = monaco.editor.create(container, {
      value,
      language: "idris",
      fontFamily: "Comic Code, Menlo, Monaco, Courier New, sans",
      automaticLayout: true,
      acceptSuggestionOnEnter: "off",
      unicodeHighlight: { ambiguousCharacters: false },
      minimap: { enabled: false },
    });
    state.editor.value = editor;

    editor.onDidChangeModelContent((ev) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        let value = editor.getValue();
        build(value);
        localStorage.idrisCode = value;
      }, 1000);
    });
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
  let onKeyPress = async (ev: KeyboardEvent) => {
    if (ev.key === "Enter") {
      if (ev.target instanceof HTMLInputElement) {
        let cmd = ev.target.value;
        ev.target.value = "";
        state.repl.value += `> ${cmd}\n`;
        let resp = await runCommand("repl", cmd);
        state.repl.value += resp + "\n";
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
  return h(
    "div",
    { id: "repl", className: "vbox" },
    h("div", { className: "replTop stretch", ref }, state.repl.value),
    h(
      "div",
      { className: "replBottom hbox" },
      h("div", { className: 'prompt'}, "›"),
      h("input", { onKeyPress, className: "stretch" }),
      h("button", { className: "clear", title: 'clear', onClick }, "⨂")
    )
  );
}

const REPL = "REPL";
const JAVASCRIPT = "JS Source";
const CONSOLE = "JS Console";
const CASES = "Case Trees";

let TABS = [REPL, JAVASCRIPT, CONSOLE]

function Tabs() {
  const [selected, setSelected] = useState(TABS.includes(localStorage.tab) ? localStorage.tab : REPL);
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
    default:
      body = h("div", {});
  }

  return h(
    "div",
    { className: "tabPanel right" },
    h(
      "div",
      { className: "tabBar" },
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
  let play = "M0 0 L20 10 L0 20 z";
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
        h("option", { value: "" }, "choose sample"),
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
  editor: monaco.editor.IStandaloneCodeEditor,
  output: string
) => {
  console.log("PROCESS OUTPUT", output);
  let model = editor.getModel()!;
  let markers: monaco.editor.IMarkerData[] = [];
  let lines = output.split("\n");
  let error: undefined | ["ERROR", string];
  let FCRE = /^\w+:(\d+):(\d+)--(\d+):(\d+).*/m;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (line.match(/^Error: .*/)) {
      console.log("WOO", line);
      // sometimes there is a blank line and then the chunk with the location
      while (lines[i + 1] || lines[i + 2]?.match(FCRE))
        line = line + "\n" + lines[++i];
      console.log("BAR", line);
      error = ["ERROR", line];
    }
    // Foo:4:25--4:29
    const match = line.match(FCRE);
    if (match && error) {
      console.log("match", match);
      let [_full, sr, sc, er, ec] = match;
      let [kind, message] = error;
      const severity =
        kind === "ERROR"
          ? monaco.MarkerSeverity.Error
          : monaco.MarkerSeverity.Info;

      markers.push({
        severity,
        message,
        startLineNumber: +sr,
        startColumn: +sc,
        endLineNumber: +er,
        endColumn: +ec,
      });
      error = undefined;
    }
  }
  monaco.editor.setModelMarkers(model, "idris", markers);
};
