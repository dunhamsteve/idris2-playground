import { effect, signal } from "@preact/signals";
import { idrisConfig, idrisTokens } from "./monarch.ts";
import * as monaco from "monaco-editor";
import { useEffect, useRef, useState } from "preact/hooks";
import { h, render, VNode } from "preact";
import { ChangeEvent } from "preact/compat";
import { CompileRes } from "./types.ts";

monaco.languages.register({ id: "idris" });
monaco.languages.setMonarchTokensProvider("idris", idrisTokens);
monaco.languages.setLanguageConfiguration("idris", idrisConfig);

const iframe = document.createElement("iframe");
iframe.src = "frame.html";
iframe.style.display = "none";
document.body.appendChild(iframe);

const idrisWorker = new Worker("worker.js");

function build(src: string) {
  idrisWorker.postMessage({ cmd: "build", src });
}

function runOutput() {
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
  state.result.value = ev.data
  state.output.value = ev.data.output;
  state.javascript.value = ev.data.javascript;
};

self.MonacoEnvironment = {
  getWorkerUrl(moduleId, _label) {
    console.log("Get worker", moduleId);
    return moduleId;
  },
};

const state = {
  result: signal<CompileRes|null>(null),
  output: signal(""),
  javascript: signal(""),
  messages: signal<string[]>([]),
  editor: signal<monaco.editor.IStandaloneCodeEditor | null>(null),
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
  } else {
    state.editor.value!.setValue("module Main\n");
  }
}

// I keep pressing save.
document.addEventListener("keydown", (ev) => {
  if (ev.metaKey && ev.code == "KeyS") ev.preventDefault();
});

const LOADING = "module Loading\n";

let value = localStorage.idrisCode || LOADING;
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

// for extra credit, we could have a read-only monaco
function JavaScript() {
  const text = state.javascript.value;
  return h("div", { id: "javascript" }, text);
}

function Result({field}: {field : keyof CompileRes}) {
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

const RESULTS = "Output";
const JAVASCRIPT = "JS";
const CONSOLE = "Console";
const CASES = "Case Trees";

function Tabs() {
  const [selected, setSelected] = useState(localStorage.tab ?? RESULTS);
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
    if (state.messages.value) setSelected(CONSOLE);
  }, [state.messages.value]);

  let body;
  switch (selected) {
    case RESULTS:
      body = h(Result, {field:'output'});
      break;
    case JAVASCRIPT:
      body = h(JavaScript, {});
      break;
    case CONSOLE:
      body = h(Console, {});
      break;
    case CASES:
      body = h(Result, {field:'cases'});
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
      Tab(RESULTS),
      Tab(JAVASCRIPT),
      Tab(CONSOLE),
      Tab(CASES),
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
      h("button", { onClick: runOutput }, svg(play)),
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
  return h(
    "div",
    { className },
    h(EditWrap, { vertical, toggle }),
    h(Tabs, {})
  );
}

render(h(App, {}), document.getElementById("app")!);

let timeout: any;

// Adapted from the vscode extension, but types are slightly different
// and positions are 1-based.
const processOutput = (
  editor: monaco.editor.IStandaloneCodeEditor,
  output: string
) => {
  let model = editor.getModel()!;
  let markers: monaco.editor.IMarkerData[] = [];
  let lines = output.split("\n");
  let error: undefined | ["ERROR", string];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (line.match(/^Error: .*/)) {
      while (lines[i + 1]) line = line + " " + lines[++i];
      error = ["ERROR", line];
    }
    // Foo:4:25--4:29
    const match = line.match(/^\w+:(\d+):(\d+)--(\d+):(\d+).*/);
    if (match && error) {
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
