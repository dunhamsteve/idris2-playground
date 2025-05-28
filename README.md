
# Idris2 web playground

This repository contains a proof of concept web playground for Idris2. It is a work in progress. The playground can be found at https://dunhamsteve.github.io/idris2-playground.

The web page includes the monaco editor and runs Idris on your file, generating javascript.  There is a `⏵` button to run the javascript.  On the right are three tabs:

- "Output" of the compiler
- "JS" output of the compiler
- "Console" output from running your program
- "Case Trees" shows the case trees of the program

The compiler is run one second after the user stops changing the document.  There is a toggle between horizontal and vertical layout to accomodate mobile clients. The last three tabs are only useful if there is a `main` function in your code. You can press `Ctrl-s` or `Cmd-s` to save your program in the url and copy it to the clipboard.

## Running

To get your own copy to deploy:
```
npm install -g esbuild vite
npm install
mkdir public
./build
vite build
```
If you're not deploying to the root of your web server, do something like `vite build --base /idris2-playground` for that last command.  The result will be in `dist`.

To run during development, first do `./build` and then `npm run dev`.

## How Idris is built for javascript

I'm using idris from `https://github.com/dunhamsteve/idris2-js`.  It has patches to disable scheme eval, ide mode, and address a few stack overflows. The `idris.js` and ttc files from the distribution are copied into the `idris` directory and checked in.

### The compiler

The compiler runs in a web worker defined in `src/worker.ts`. I've stubbed out enough of the node API to get it to work in the browser in the `emul.ts` file. In that file you'll find an emulation of `Buffer`, a filesystem in `files` that is map of paths to `Uint8Array`, and the node api implementation. A `require` function and `process` are defined, which ties it to the Idris code.

IO in Idris/javascript is not asynchronous, so we need to pre-load any TTC files into our "filesystem". We download `files.zip` which is contains all of the TTC files for the prelude, base, and contrib libraries. The files in the zip are decompressed and copied to `files` as needed.

### The web page

I'm using the monaco editor, preact, and preact-signals. About 1 second after you stop changing the document, it will send it to the worker. When messages come back from the worker, the state is updated with the stdout and javascript output of the compiler and flows into the UI via signals.

When the "play" button is pressed, the javascript is passed to a hidden iframe that runs it.  It is defined in `frame.html` and intercepts console.log to collect messages and send them back to the "Console" tab on main page.

The ui is in `main.ts`. The `monarch.ts` file defines the language highlighting and other properties for the editor.

