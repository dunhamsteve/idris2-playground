import { AbstractEditor, EditCommand, EditorDelegate, Marker } from "./types";
import { basicSetup } from "codemirror";
import { defaultKeymap, indentMore, indentLess, toggleLineComment } from "@codemirror/commands";
import { Command, EditorView, hoverTooltip, keymap, Tooltip } from "@codemirror/view";
import { Compartment, Prec } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { linter } from "@codemirror/lint";
import {
  indentService,
  LanguageSupport,
  StreamLanguage,
  StringStream,
} from "@codemirror/language";

// maybe use https://github.com/codemirror/legacy-modes/blob/main/mode/simple-mode.js instead.
// @codemirror/legacy-modes/mode/simple-mode.js

// prettier flattened this...
const keywords = [
  "let",
  "in",
  "where",
  "case",
  "of",
  "data",
  "do",
  "export",
  "public",
  "rewrite",
  "mutual",
  "namespace",
  "module",
  "covering",
  "partial",
  "failing",
  "total",
  "constructor",
  "parameters",
  "default",
  "using",
  "private",
  "with",
  "impossible",
  "forall",
  "auto",
  "prefix",
  "module",
  "interface",
  "implementation",
  "infixl",
  "infixr",
  "infix",
  "forall",
  "import",
  "record",
  "constructor",
  "if",
  "then",
  "else",
  "λ",
  "->",
  ":",
  "=>",
  ":=",
  "$=",
  "=",
  "<-",
  "\\",
  "_",
  "|",
];

// a stack of tokenizers, current is first
// we need to push / pop {} so we can parse strings correctly
interface State {
  tokenizers: Tokenizer[]
}
type Tokenizer = (stream: StringStream, state: State) => string | null;


// see https://lezer.codemirror.net/docs/ref/#highlight.Tag%5EdefineModifier for tag list
function tokenizer(stream: StringStream, state: State): string | null {
  if (stream.eatSpace()) return null
  if (stream.match("--")) {
    stream.skipToEnd();
    return "comment";
  }
  if (stream.match(/^[{]-/)) {
    state.tokenizers.unshift(commentTokenizer);
    return state.tokenizers[0](stream, state);
  }
  // maybe keyword?
  if (stream.match(/{/)) {
    state.tokenizers.unshift(tokenizer)
    return null
  }
  if (stream.match(/}/) && state.tokenizers.length > 1) {
    state.tokenizers.shift()
    return state.tokenizers[0] === stringTokenizer ? "keyword" : null
  }
  if (stream.match(/"/)) {
    state.tokenizers.unshift(stringTokenizer);
    return stringTokenizer(stream, state);
  }
  if (stream.match(/[^\\(){}[\],.@;\s][^()\\{}\[\],.@;\s]*/)) {
    let word = stream.current();
    if (keywords.includes(word)) return "keyword";
    if (word[0] >= "A" && word[0] <= "Z") return "typeName";
    if (word[0] == '%') return "keyword";
    return "variableName";
  }
  // unhandled
  stream.next()
  return null;
}

function stringTokenizer(stream: StringStream, state: State) {
  while (true) {
    if (stream.current() && stream.match(/^\\{/, false)) {
      return "string";
    }
    if (stream.match(/^\\{/)) {
      state.tokenizers.unshift(tokenizer)
      return "keyword";
    }
    let ch = stream.next()
    if (!ch) return "string";
    if (ch === '"') {
      state.tokenizers.shift()
      return "string";
    }
  }
}

// We don't need a tokenizer for this until we add nested comments
function commentTokenizer(stream: StringStream, state: State): string | null {
  console.log("ctok");
  let dash = false;
  let ch;
  while ((ch = stream.next())) {
    if (dash && ch === "}") {
      state.tokenizers.shift()
      return "comment";
    }
    dash = ch === "-";
  }
  return "comment";
}

const newtLanguage2 = StreamLanguage.define({
  startState: () => ({ tokenizers: [tokenizer] }),
  token(stream, st) {
    if (!st.tokenizers.length) {
      console.error('NO TOKENIZER')
      st.tokenizers.push(tokenizer)
    }
    return st.tokenizers[0](stream, st);
  },
  languageData: {
    commentTokens: {
      line: "--"
    },
    wordChars: "!#$%^&*_+-=<>|",
  }
});

function newt() {
  return new LanguageSupport(newtLanguage2);
}

export class CMEditor implements AbstractEditor {
  view: EditorView;
  delegate: EditorDelegate;
  theme: Compartment;
  constructor(container: HTMLElement, doc: string, delegate: EditorDelegate) {
    this.delegate = delegate;
    this.theme = new Compartment();

    const runCommand =
      (cmd: EditCommand): Command =>
      () => {
        let pos = this.view.state.selection.ranges[0].anchor;
        let cursor = this.view.state.doc.lineAt(pos);
        let line = cursor.number;
        let range = this.view.state.wordAt(pos);
        console.log(range);
        if (!range) return false;
        let col = range.from - cursor.from;
        let word = this.view.state.doc.sliceString(range.from, range.to);
        // might want to have a generalized function that returns edits
        // maybe see what ide-mode can do and expose it as an extern?
        this.delegate.command(cmd, word, line, col).then((result) => {
          if (result) {
            console.log("GOT", JSON.stringify(result));
            let opts = result.trim().split("\n");
            // FIXME - intro gives multiple choice, we'll want to prompt the user
            // need to put UI on the screen..
            if (opts.length > 1) {
              let eline = this.view.state.doc.line(line);
              let coord = this.view.coordsAtPos(eline.from + col);
              console.log("pos", coord);
              return;
            }
            let { from, to } = range;
            if (cursor.text[from - cursor.from - 1] === "?") from--;
            this.view.dispatch({
              changes: { from, to, insert: result },
            });
          }
        });
        return true;
      };

    this.view = new EditorView({
      doc,
      parent: container,
      extensions: [
        basicSetup,
        linter((view) => this.delegate.lint(view)),
        // For indent on return
        indentService.of((ctx, pos) => {
          let line = ctx.lineAt(pos)
          if (!line || !line.from) return null
            let prevLine = ctx.lineAt(line.from - 1);
            if (prevLine.text.trimEnd().match(/\b(of|where|do)\s*$/)) {
              let pindent = prevLine.text.match(/^\s*/)?.[0].length ?? 0
              return pindent + 2
            }
          return null
        }),
        Prec.highest(keymap.of([
          {
            key: "Tab",
            preventDefault: true,
            run: indentMore,
          },
          {
            key: "Cmd-/",
            run: toggleLineComment,
          },
          // TODO figure out what prefix we want here and document it
          // C-c from emacs conflicts with system copy/paste on most platforms
          // I've got Control-. and Meta-. for now
            {
              // Intro
              key: "c-. i",
              mac: "m-. i",
              run: runCommand("intro"),
            },
            {
              key: "c-. s",
              mac: "m-. s",
              run: runCommand("proofSearch"),
            },
            {
              key: "c-. c",
              mac: "m-. c",
              run: () => {
                let pos = this.view.state.selection.ranges[0].anchor;
                let cursor = this.view.state.doc.lineAt(pos);
                let line = cursor.number;
                let range = this.view.state.wordAt(pos);
                if (!range) return false;
                let col = range.from - cursor.from;
                let word = this.view.state.doc.sliceString(
                  range.from,
                  range.to
                );
                // We can't return an accurate true/false because this is async
                // hopefully the command doesn't have to complete before we return
                this.delegate.caseSplit(word, line, col).then((result) => {
                  if (result) {
                    this.view.dispatch({
                      changes: {
                        from: cursor.from,
                        to: cursor.to,
                        insert: result,
                      },
                    });
                  }
                });
                return true;
              },
          },
          {
            key: "Shift-Tab",
            preventDefault: true,
            run: indentLess,
          },
        ])),
        this.theme.of(EditorView.baseTheme({})),
        hoverTooltip(async (view, pos) => {
          let cursor = this.view.state.doc.lineAt(pos);
          let line = cursor.number;
          let range = this.view.state.wordAt(pos);
          console.log(range);
          if (range) {
            let col = range.from - cursor.from;
            let word = this.view.state.doc.sliceString(range.from, range.to);
            let entry = await this.delegate.getEntry(word, line, col);
            console.log("entry for", word, "is", entry);
            if (entry) {
              let rval: Tooltip = {
                pos: range.head,
                above: true,
                create: () => {
                  let dom = document.createElement("div");
                  dom.className = "tooltip";
                  dom.textContent = entry.type;
                  return { dom };
                },
              };
              return rval;
            }
          }
          // we'll iterate the syntax tree for word.
          // let entry = delegate.getEntry(word, line, col)
          return null;
        }),
        newt(),
      ],
    });
  }
  setDark(isDark: boolean) {
    this.view.dispatch({
      effects: this.theme.reconfigure(
        isDark ? oneDark : EditorView.baseTheme({})
      ),
    });
  }
  setValue(_doc: string) {
    // Is this all we can do?
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: _doc },
    });
  }
  getValue() {
    // maybe?
    return this.view.state.doc.toString();
  }
  setMarkers(_: Marker[]) {}
}
