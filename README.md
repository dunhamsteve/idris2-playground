
# Idris2 web playground

This repository contains a proof of concept web playground for Idris2. It is a work in progress. The playground can be found at https://dunhamsteve.github.io/idris2-playground.

The web page includes the monaco editor and runs Idris on your file, generating javascript.  There is a `⏵` button to run the javascript.  On the right are three tabs:

- "Output" of the compiler
- "JS" output of the compiler
- "Console" output from running your program
- "Case Trees" shows the case trees of the program

The compiler is run one second after the user stops changing the document.  There is a toggle between horizontal and vertical layout to accomodate mobile clients. The last three tabs are only useful if there is a `main` function in your code. You can press `Ctrl-s` or `Cmd-s` to save your program in the url and copy it to the clipboard.

## Keyboard Shortcuts

| macos | linux / windows  | command |
| ----- | ---------------- | ------- |
| M-s   | C-s              | Embed code to url and copy to clipboard |
| M-. i | C-. i | Introduce unambiguous constructor in hole |
| M-. c | C-. c | Case split |
| M-. s | C-. s | Proof search in hole |


## Running

To get your own copy to deploy:
```sh
npm install -g esbuild vite
npm install
mkdir public
./build
vite build
```
If you're not deploying to the root of your web server, do something like `vite build --base /idris2-playground` for that last command.  The result will be in `dist`.

To run during development, first do `./build` and then `npm run dev`.

## How Idris is built for javascript

I'm using idris from `https://github.com/dunhamsteve/idris2-js`.  It has patches to disable scheme eval, ide mode, and address a few stack overflows. The `build` scripts downloads the build artifact from that project, bundles the ttc and support as `files.zip`, wraps Idris with a iffe with a small patch found in `patch.js`. The patch captures the compiler context when `repl` is invoked and exposes `interpret` and `displayResult` from `Idris.REPL`.  This enables us to provide a REPL in the web UI.

### The compiler

The compiler runs in a web worker defined in `src/worker.ts`. I've stubbed out enough of the node API to get it to work in the browser. The stub functions are in `emul.ts`. In that file you'll find an emulation of `Buffer`, a filesystem in `files` that is map of paths to `Uint8Array`, and the node api implementation. A `require` function and `process` are defined, which ties it to the Idris code.

IO in Idris/javascript is not asynchronous, so we need to pre-load any TTC files into our "filesystem". We download `files.zip` which is contains all of the TTC files for the prelude, base, and contrib libraries. The files in the zip are decompressed and copied to `files` on demand.

### The web page

I'm using the codemirror, preact, and preact-signals. As you edit the document, the content is sent to the worker. When messages come back from the worker, the state is updated with the stdout and javascript output of the compiler and flows into the UI via signals.

The REPL is exposed to the user, and also used for type on hover and functions like case split.

When the "play" button is pressed, the javascript is passed to a hidden iframe that runs it.  It is defined in `frame.html` and intercepts console.log to collect messages and send them back to the "Console" tab on main page.

