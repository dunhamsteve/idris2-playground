
# Idris2 web playground

This repository contains a proof of concept web playground for Idris2. It is a work in progress. The playground can be found at https://dunhamsteve.github.io/idris2-playground.

The web page includes the monaco editor and runs Idris on your file, generating javascript.  There is a `⏵` button to run the javascript.  On the right are three tabs:

- "Output" of the compiler
- "JS" output of the compiler
- "Console" output from running your program

The compiler is run one second after the user stops changing the document.  There is a toggle between horizontal and vertical layout to accomodate mobile clients.

## How it is built

To compile Idris for node, the patch in `idris/IdrisPlayground.diff` was applied. It adds a few FFI implementations, disables scheme eval, and disables ide network sockets. Idris was then built with:
```sh
idris2 --cg node --build idris2.ipkg
```
The resulting file runs in node and can be found in `idris/idris2.js`.

### The compiler

The compiler runs in a web worker defined in `src/worker.ts`. I've stubbed out enough of the node API to get it to work in the browser. In that file you'll find an emulation of `Buffer`, a filesystem in `files` that is map of paths to `Uint8Array`, and the node api implementation. A `require` function is defined, which ties it to the Idris source.

IO in Idris/javascript is not asynchronous, so we need to pre-load any TTC files into our "filesystem".  They are listed in the `preload` array in `worker.ts`.

### The web page

I'm using the monaco editor, preact, and preact-signals. About 1 second after you stop changing the document, it will send it to the worker. When messages come back from the worker, the state is updated with the stdout and javascript output of the compiler and flows into the UI via signals.

When the "play" button is pressed, the javascript is passed to a hidden iframe that runs it.  It is defined in `frame.html` and intercepts console.log to collect messages and send them back to the main page.

The ui is in `main.ts`. The `monarch.ts` file defines the language highlighting and other properties for the editor.  


