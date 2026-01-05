# Idris2 Playground


The editor will typecheck the file with newt and render errors as the file is changed. The current file is saved to localStorage and will be restored if there is no data in the URL. Cmd-s or Ctrl-s will create a url embedding the file contents.

## Tabs

**Output** - Displays the compiler output, which is also used to render errors and info annotations in the editor.

**REPL** - The Idris2 REPL

**JS Source** - Displays the javascript translation of the file

**JS Console** - Displays the console output from running the javascript

**Help** - Displays this help file

## Buttons

:play: Compile and run the current file in an iframe, console output is collected to the console tab.

:share: Embed the current file in the URL and copy to clipboard.

## Keyboard Shortcuts

| macos | linux / windows  | command |
| ----- | ---------------- | ------- |
| M-s   | C-s   | Embed code to url and copy to clipboard |
| M-. i | C-. i | Introduce unambiguous constructor in hole |
| M-. c | C-. c | Case split |
| M-. s | C-. s | Proof search in hole |
| C-l   | C-l   | Clears the repl, if focused |


