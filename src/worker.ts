class Buffer extends DataView {
  static alloc(n: number) {
    return new Buffer(new Uint8Array(n).buffer);
  }
  indexOf(n: number) {
    return new Uint8Array(this.buffer).indexOf(n);
  }
  get length() {
    return this.byteLength;
  }
  slice(start: number, end: number) {
    return new Buffer(this.buffer.slice(start, end));
  }
  readUInt8(i: number) {
    return this.getUint8(i);
  }
  writeUInt8(val: number, i: number) {
    this.setUint8(i, val);
  }
  write(value: string, start: number, len: number, enc: string) {
    // console.log("write", value, start, len, enc);
    let buf = new TextEncoder().encode(value);
    let ss = 0;
    let se = Math.min(len, buf.length);
    let ts = start;
    for (; ss < se; ss++, ts++) this.setInt8(ts, buf[ss]);
    process.errno = 0;
    return se;
  }
  readDoubleLE(i: number) {
    return this.getFloat64(i, true);
  }
  readInt32LE(i: number) {
    return this.getInt32(i, true);
  }
  writeInt32LE(val: number, i: number) {
    console.log("wi32", i, val);
    return this.setInt32(i, val, true);
  }
  copy(target: Buffer, ts: number, ss: number, se: number) {
    for (; ss < se; ss++, ts++) target.setInt8(ts, this.getInt8(ss));
  }
  static concat(bufs: Buffer[]) {
    let size = bufs.reduce((a, b) => (a += b.byteLength), 0);
    let rval = Buffer.alloc(size);
    let off = 0;
    for (let buf of bufs) {
      const view = new Int8Array(rval.buffer);
      view.set(new Uint8Array(buf.buffer), off);
      off += buf.byteLength;
    }
    return rval;
  }
  toString() {
    return new TextDecoder().decode(this);
  }
}

let files: Record<string, Uint8Array> = {};
interface Handle {
  name: string;
  mode: string;
  pos: number;
  buf: Uint8Array;
}
let fds: Handle[] = [];

let shim: any = {
  tty: {
    isatty() {
      return 0;
    },
  },
  os: {
    platform() {
      return "linux";
    },
  },
  fs: {
    opendirSync(name: string) {
      let fd = fds.findIndex((x) => !x);
      if (fd < 0) fd = fds.length;
      console.log("openDir", name);
      process.errno = 0;
      return fd;
    },
    mkdirSync(name: string) {
      console.log("mkdir", name);
      process.errno = 0;
      return 0;
    },
    openSync(name: string, mode: string) {
      console.log("open", name, mode);
      let te = new TextEncoder();

      let fd = fds.findIndex((x) => !x);
      if (fd < 0) fd = fds.length;
      let buf: Uint8Array;
      let pos = 0;
      if (mode == "w") {
        buf = new Uint8Array(0);
      } else {
        console.log(name, !!files[name]);
        if (!files[name]) {
          process.errno = 1;
          throw new Error(`${name} not found`);
        }
        buf = files[name];
      }
      process.errno = 0;
      fds[fd] = { buf, pos, mode, name };
      // we'll mutate the pointer as stuff is read
      return fd;
    },
    writeSync(fd: number, line: string | Buffer) {
      try {
        let handle = fds[fd];
        if (!handle) throw new Error(`bad fd ${fd}`);
        console.log("writeSync", handle.name);

        let buf2: ArrayBuffer;
        if (typeof line === "string") {
          buf2 = new TextEncoder().encode(line);
          let newbuf = new Uint8Array(handle.buf.byteLength + buf2.byteLength);
          newbuf.set(new Uint8Array(handle.buf));
          newbuf.set(new Uint8Array(buf2), handle.buf.byteLength);
          handle.buf = newbuf;
          process.errno = 0;
        } else if (line instanceof Buffer) {
          let start = arguments[2];
          let len = arguments[3];
          buf2 = line.buffer.slice(start, start + len);
          let newbuf = new Uint8Array(handle.buf.byteLength + buf2.byteLength);
          newbuf.set(new Uint8Array(handle.buf));
          newbuf.set(new Uint8Array(buf2), handle.buf.byteLength);
          handle.buf = newbuf;
          process.errno = 0;
          return len;
        } else {
          debugger;
          throw new Error(`write ${typeof line} not implemented`);
        }
      } catch (e) {
        debugger;
        throw e;
      }
    },
    chmodSync(fn: string, mode: number) {},
    fstatSync(fd: number) {
      let hand = fds[fd];
      console.log("size", hand.buf.byteLength);
      return { size: hand.buf.byteLength };
    },
    readSync(fd: number, buf: Buffer, start: number, len: number) {
      let hand = fds[fd];
      let avail = hand.buf.length - hand.pos;
      let rd = Math.min(avail, len);
      let src = hand.buf;
      let dest = new Uint8Array(buf.buffer);
      for (let i = 0; i < rd; i++) dest[start + i] = src[hand.pos++];
      return rd;
    },
    closeSync(fd: number) {
      let handle = fds[fd];
      console.log("close", handle.name);
      if (handle.mode == "w") {
        files[handle.name] = handle.buf;
      }
      delete fds[fd];
    },
  },
};

// Spy on Idris' calls to see what we need to fill in
shim.fs = new Proxy(shim.fs, {
  get(target, prop, receiver) {
    if (prop in target) {
      return (target as any)[prop];
    }
    let err = new Error(`IMPLEMENT fs.${String(prop)}`);
    // idris support eats the exception
    console.error(err);
    throw err;
  },
});

const process: Process = {
  platform: "linux",
  argv: ["", ""],
  stdout: {
    // We'll want to replace this one
    write: console.log,
  },
  exit(v: number) {
    console.log("exit", v);
  },
  cwd() {
    return "";
  },
  env: {
    NO_COLOR: "true",
    IDRIS2_CG: "javascript",
    IDRIS2_PREFIX: "",
  },
  errno: 0,
  // stdin: { fd: 0 },
};

const require = (x: string) => {
  console.log("require", x);
  return shim[x];
};

// Maybe the shim goes here and we append newt...

let stdout = "";
// We'll want to collect and put info in the monaco
process.stdout.write = (s) => {
  console.log("*", s);
  stdout += s;
};
// We can't do async io, so we have to preload all of this from the web into the "filesystem"
// TODO - this is 25MB of download, but could be a single 2.5MB zip file
const preload = [
  "idris2-0.7.0/support/js/support.js",
  "2024103000/Prelude.ttc",
  "2024103000/Builtin.ttc",
  "2024103000/PrimIO.ttc",
  "2024103000/Prelude/Interpolation.ttc",
  "2024103000/Prelude/Show.ttc",
  "2024103000/Prelude/IO.ttc",
  "2024103000/Prelude/Cast.ttc",
  "2024103000/Prelude/Uninhabited.ttc",
  "2024103000/Prelude/Types.ttc",
  "2024103000/Prelude/Ops.ttc",
  "2024103000/Prelude/Interfaces.ttc",
  "2024103000/Prelude/Num.ttc",
  "2024103000/Prelude/Basics.ttc",
  "2024103000/Prelude/EqOrd.ttc",
  "2024103000/System.ttc",
  "2024103000/Language/Reflection.ttc",
  "2024103000/Language/Reflection/TT.ttc",
  "2024103000/Language/Reflection/TTImp.ttc",
  "2024103000/Deriving/Show.ttc",
  "2024103000/Deriving/Functor.ttc",
  "2024103000/Deriving/Common.ttc",
  "2024103000/Deriving/Foldable.ttc",
  "2024103000/Deriving/Traversable.ttc",
  "2024103000/System/FFI.ttc",
  "2024103000/System/Signal.ttc",
  "2024103000/System/File.ttc",
  "2024103000/System/Term.ttc",
  "2024103000/System/Concurrency.ttc",
  "2024103000/System/Errno.ttc",
  "2024103000/System/File/Handle.ttc",
  "2024103000/System/File/Permissions.ttc",
  "2024103000/System/File/Meta.ttc",
  "2024103000/System/File/Support.ttc",
  "2024103000/System/File/Mode.ttc",
  "2024103000/System/File/Types.ttc",
  "2024103000/System/File/ReadWrite.ttc",
  "2024103000/System/File/Process.ttc",
  "2024103000/System/File/Virtual.ttc",
  "2024103000/System/File/Error.ttc",
  "2024103000/System/File/Buffer.ttc",
  "2024103000/System/Info.ttc",
  "2024103000/System/REPL.ttc",
  "2024103000/System/Escape.ttc",
  "2024103000/System/Directory.ttc",
  "2024103000/System/Clock.ttc",
  "2024103000/Syntax/WithProof.ttc",
  "2024103000/Syntax/PreorderReasoning.ttc",
  "2024103000/Syntax/PreorderReasoning/Ops.ttc",
  "2024103000/Syntax/PreorderReasoning/Generic.ttc",
  "2024103000/Decidable/Equality.ttc",
  "2024103000/Decidable/Decidable.ttc",
  "2024103000/Decidable/Equality/Core.ttc",
  "2024103000/Data/Fuel.ttc",
  "2024103000/Data/OpenUnion.ttc",
  "2024103000/Data/Either.ttc",
  "2024103000/Data/SortedMap.ttc",
  "2024103000/Data/Fin/Properties.ttc",
  "2024103000/Data/Fin/Arith.ttc",
  "2024103000/Data/Fin/Order.ttc",
  "2024103000/Data/Fin/Split.ttc",
  "2024103000/Data/SortedMap/Dependent.ttc",
  "2024103000/Data/Stream.ttc",
  "2024103000/Data/List.ttc",
  "2024103000/Data/Vect/AtIndex.ttc",
  "2024103000/Data/Vect/Elem.ttc",
  "2024103000/Data/Vect/Quantifiers.ttc",
  "2024103000/Data/List1/Properties.ttc",
  "2024103000/Data/List1/Elem.ttc",
  "2024103000/Data/List1/Quantifiers.ttc",
  "2024103000/Data/Zippable.ttc",
  "2024103000/Data/SnocList.ttc",
  "2024103000/Data/Bits.ttc",
  "2024103000/Data/Bifoldable.ttc",
  "2024103000/Data/DPair.ttc",
  "2024103000/Data/Vect.ttc",
  "2024103000/Data/Nat/Views.ttc",
  "2024103000/Data/Nat/Order/Properties.ttc",
  "2024103000/Data/Nat/Order.ttc",
  "2024103000/Data/IOArray.ttc",
  "2024103000/Data/IOArray/Prims.ttc",
  "2024103000/Data/These.ttc",
  "2024103000/Data/Morphisms.ttc",
  "2024103000/Data/Colist.ttc",
  "2024103000/Data/Fun.ttc",
  "2024103000/Data/Bool.ttc",
  "2024103000/Data/Rel.ttc",
  "2024103000/Data/Nat.ttc",
  "2024103000/Data/Double.ttc",
  "2024103000/Data/Primitives/Views.ttc",
  "2024103000/Data/Primitives/Interpolation.ttc",
  "2024103000/Data/Singleton.ttc",
  "2024103000/Data/SnocList/HasLength.ttc",
  "2024103000/Data/SnocList/Elem.ttc",
  "2024103000/Data/SnocList/Quantifiers.ttc",
  "2024103000/Data/SnocList/Operations.ttc",
  "2024103000/Data/Maybe.ttc",
  "2024103000/Data/IORef.ttc",
  "2024103000/Data/Ref.ttc",
  "2024103000/Data/List/Views.ttc",
  "2024103000/Data/List/HasLength.ttc",
  "2024103000/Data/List/AtIndex.ttc",
  "2024103000/Data/List/Lazy.ttc",
  "2024103000/Data/List/Lazy/Quantifiers.ttc",
  "2024103000/Data/List/Elem.ttc",
  "2024103000/Data/List/Quantifiers.ttc",
  "2024103000/Data/Bool/Xor.ttc",
  "2024103000/Data/Bool/Decidable.ttc",
  "2024103000/Data/Colist1.ttc",
  "2024103000/Data/Fin.ttc",
  "2024103000/Data/Contravariant.ttc",
  "2024103000/Data/Integral.ttc",
  "2024103000/Data/So.ttc",
  "2024103000/Data/Void.ttc",
  "2024103000/Data/Buffer.ttc",
  "2024103000/Data/SortedSet.ttc",
  "2024103000/Data/List1.ttc",
  "2024103000/Data/String.ttc",
  "2024103000/Control/Function.ttc",
  "2024103000/Control/Relation/Closure.ttc",
  "2024103000/Control/App/Console.ttc",
  "2024103000/Control/App/FileIO.ttc",
  "2024103000/Control/Relation.ttc",
  "2024103000/Control/Ord.ttc",
  "2024103000/Control/App.ttc",
  "2024103000/Control/Order.ttc",
  "2024103000/Control/Function/FunExt.ttc",
  "2024103000/Control/Applicative/Const.ttc",
  "2024103000/Control/WellFounded.ttc",
  "2024103000/Control/Monad/Reader/Interface.ttc",
  "2024103000/Control/Monad/Reader/Reader.ttc",
  "2024103000/Control/Monad/ST.ttc",
  "2024103000/Control/Monad/Partial.ttc",
  "2024103000/Control/Monad/Either.ttc",
  "2024103000/Control/Monad/RWS/Interface.ttc",
  "2024103000/Control/Monad/RWS/CPS.ttc",
  "2024103000/Control/Monad/Reader.ttc",
  "2024103000/Control/Monad/Writer.ttc",
  "2024103000/Control/Monad/State/Interface.ttc",
  "2024103000/Control/Monad/State/State.ttc",
  "2024103000/Control/Monad/Maybe.ttc",
  "2024103000/Control/Monad/Writer/Interface.ttc",
  "2024103000/Control/Monad/Writer/CPS.ttc",
  "2024103000/Control/Monad/State.ttc",
  "2024103000/Control/Monad/RWS.ttc",
  "2024103000/Control/Monad/Error/Interface.ttc",
  "2024103000/Control/Monad/Error/Either.ttc",
  "2024103000/Control/Monad/Trans.ttc",
  "2024103000/Control/Monad/Identity.ttc",
  "2024103000/Debug/Trace.ttc",
];

function doBuild(src: string) {}

onmessage = async function (ev) {
  console.log("message", ev);
  for (let fn of preload) {
    if (!files[fn]) {
      try {
        let res = await fetch(fn);
        // probably need binary...
        let text = await res.arrayBuffer();
        files[fn] = new Uint8Array(text);
        console.log("preload", fn);
      } catch (e) {
        console.error("preload", fn, "failed", e);
      }
    }
  }
  console.log("preload done");

  let module = "Main";
  let { src } = ev.data;
  let m = src.match(/module (\w+)/);
  if (m) module = m[1];
  let fn = `${module}.idr`;
  process.argv = ["foo", "bar", "-c", fn, "-o", "out.js"];
  console.log("args", process.argv);
  files[fn] = new TextEncoder().encode(src);
  files["build/exec/out.js"] = new TextEncoder().encode("No JS output");
  stdout = "";
  const start = +new Date();
  try {
    __mainExpression_0();
  } catch (e) {
    console.log("catch", e);
    // make it clickable in console
    console.error(e);
    // make it visable on page
    stdout += "\n" + String(e);
  }
  let duration = +new Date() - start;
  console.log(`process ${fn} in ${duration} ms`);
  let javascript = new TextDecoder().decode(files["build/exec/out.js"]);
  let output = stdout;
  postMessage({ javascript, output, duration });
};
importScripts("idris2.js");
