import * as monaco from "monaco-editor";

export let idrisConfig: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: "--",
    blockComment: ["{-", "-}"],
  },
  // symbols used as brackets
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  // symbols that are auto closed when typing
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: "{-", close: "-}" },
  ],
  // symbols that can be used to surround a selection
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  onEnterRules: [
    {
      beforeText: /^\s+$/,
      action: {
        indentAction: monaco.languages.IndentAction.Outdent,
      },
    },
    {
      beforeText: /\bwhere$/,
      action: {
        indentAction: monaco.languages.IndentAction.Indent,
      },
    },
    {
      beforeText: /\bof$/,
      action: {
        indentAction: monaco.languages.IndentAction.Indent,
      },
    },
    {
      beforeText: /\{-/,
      afterText: /-\}/,
      action: {
        indentAction: monaco.languages.IndentAction.IndentOutdent,
      },
    },
  ],
};

export let idrisTokens: monaco.languages.IMonarchLanguage = {
  // Set defaultToken to invalid to see what you do not tokenize yet
  // defaultToken: "invalid",

  keywords: [
    "module",
    "import",
    "mutual",
    "namespace",
    "let",
    "in",
    "do",
    "export",
    "public",
    "rewrite",
    "where",
    "case",
    "of",
    "data",
    "record",
    "covering",
    "partial",
    "failing",
    "total",
    "constructor",
    "parameters",
    "default",
    "using",
    "with",
    "impossible",
    "forall",
    "module",
    "if",
    "then",
    "else",
    "interface",
    "implementation",
    "infixl",
    "infixr",
    "infix",
    "auto",
    "prefix",
  ],
  specialOps: ["=>", "->", ":", "=", ":="],
  tokenizer: {
    root: [
      [
        /[a-z_$'][\w$]*/,
        { cases: { "@keywords": "keyword", "@default": "identifier" } },
      ],
      [/[A-Z][\w\$]*/, "type.identifier"],
      [/\\|λ/, "keyword"],
      { include: "@whitespace" },
      [/[{}()\[\]]/, "@brackets"],
      [
        /[:!#$%&*+.<=>?@\\^|~\/-]+/,
        {
          cases: {
            "@specialOps": "keyword",
            "@default": "operator",
          },
        },
      ],

      [/\d+/, "number"],

      // strings
      [/"([^"\\]|\\.)*$/, "string.invalid"], // non-teminated string
      [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
    ],
    comment: [
      [/[^-]+/, "comment"],
      ["-/", "comment", "@pop"],
      ["-", "comment"],
    ],
    string: [
      [/[^\\"]+/, "string"],
      // [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
    ],
    whitespace: [
      [/[ \t\r\n]+/, "white"],
      ["/-", "comment", "@comment"],
      [/--.*$/, "comment"],
    ],
  },
};
