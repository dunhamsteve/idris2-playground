// Worker to run idris on source code

onmessage = async function (ev) {
  console.log("message", ev);
  if (!archive) {
    // We pull down an archive of .ttc and support files
    try {
      let res = await this.fetch("files.zip");
      if (res.status === 200) {
        let data = await res.arrayBuffer();
        archive = new ZipFile(new Uint8Array(data));
        console.log("preload done");
      } else {
        console.error(
          `fetch of files.zip got status ${res.status}: ${res.statusText}`
        );
      }
    } catch (e) {
      console.error("preload failed", e);
    }
  }

  let module = "Main";
  let { src } = ev.data;
  let m = src.match(/module (\w+)/);
  if (m) module = m[1];
  let fn = `${module}.idr`;
  process.argv = ["foo", "bar", "-c", fn, "-o", "out.js"];
  console.log("Using args", process.argv);
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

// *** Zip implementation

// I wrote this inflate years ago, seems to work for zip
class BitReader {
  pos = 0;
  bits = 0;
  acc = 0;
  len: number;
  data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
    this.len = data.length;
  }
  read(bits: number) {
    while (this.bits < bits) {
      if (this.pos >= this.len) throw "EOF";

      this.acc |= this.data[this.pos++] << this.bits;
      this.bits += 8;
    }
    let rval = this.acc & ((1 << bits) - 1);
    this.acc >>= bits;
    this.bits -= bits;
    return rval;
  }
  read8() {
    if (this.pos > this.len) throw "EOF";

    // flush
    if (this.bits > 0) {
      this.bits = 0;
      this.acc = 0;
    }
    return this.data[this.pos++];
  }
  read16() {
    let rval = this.read8() * 256 + this.read8();
    return rval;
  }
}

class HuffDic {
  limit: number[];
  codes: number[];
  base: number[];
  constructor(lengths: number[]) {
    let counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let min = 0;
    let max = 0;

    for (let i = 0; i < lengths.length; i++) {
      let len = lengths[i];
      if (len != 0) {
        if (len < min || min == 0) min = len;
        if (len > max) max = len;
        counts[len]++;
      }
    }

    this.base = [];
    this.limit = [
      -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    ];

    let code = 0;
    let seq = 0;
    let next_code = [];

    for (let i = min; i <= max; i++) {
      let n = counts[i];
      next_code[i] = code;
      this.base[i] = code - seq;
      code += n;
      seq += n;
      this.limit[i] = code - 1;
      code <<= 1;
    }

    this.codes = [];
    for (let i = 0; i < lengths.length; i++) {
      let n = lengths[i];
      if (n != 0) {
        code = next_code[n];
        next_code[n]++;
        if (!this.base[n]) this.base[n] = 0;
        seq = code - this.base[n];
        this.codes[seq] = i;
      }
    }
  }

  readSymbol(r: BitReader) {
    let v = 0;
    let l = 0;
    let offset = 0;
    for (let i = 1; i < this.limit.length; i++) {
      v <<= 1;
      v |= r.read(1);

      let limit = this.limit[i];
      if (v <= limit) {
        return this.codes[v - this.base[i]];
      }
    }
    throw "eHUFF";
  }
}
let staticHuff: HuffDic;
let distHuff: HuffDic;
{
  let tmp = [];

  for (let i = 0; i < 144; i++) tmp[i] = 8;
  for (let i = 144; i < 256; i++) tmp[i] = 9;
  for (let i = 256; i < 280; i++) tmp[i] = 7;
  for (let i = 280; i < 288; i++) tmp[i] = 8;

  staticHuff = new HuffDic(tmp);
  tmp = [];
  for (let i = 0; i < 30; i++) {
    tmp[i] = 5;
  }
  distHuff = new HuffDic(tmp);
}

function inflate(input: Uint8Array) {
  let r = new BitReader(input);
  let out = new Uint8Array(65536);
  let pos = 0;
  const push = (b: number) => {
    if (pos + 10 > out.length) {
      const tmp = new Uint8Array(out.length * 1.5);
      tmp.set(out);
      out = tmp;
    }
    out[pos++] = b;
  };

  let fin = 0;
  while (!fin) {
    fin = r.read(1);
    let btype = r.read(2);

    let huff2;
    let huff3;

    if (btype == 0) {
      let len = r.read16();
      let nlen = r.read16();
      for (let i = 0; i < len; i++) push(r.read8());
    } else if (btype == 1) {
      // fixed huffman
      huff2 = staticHuff;
      huff3 = distHuff;
    } else if (btype == 2) {
      // dynamic huffman
      let hlit = r.read(5) + 257;
      let hdist = r.read(5) + 1;
      let hclen = r.read(4) + 4;
      let lengths: number[] = [];
      for (let i = 0; i < 19; i++) lengths[i] = 0;

      let xx = [
        16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
      ];
      for (let i = 0; i < hclen; i++) {
        let t = r.read(3);
        lengths[xx[i]] = t;
      }

      let huff = new HuffDic(lengths);

      lengths = [];
      while (true) {
        let k = huff.readSymbol(r);
        if (k < 16) {
          lengths.push(k);
        } else if (k == 16) {
          let count = r.read(2) + 3;
          if (lengths.length == 0) throw new Error("no lengths?");
          for (; count > 0; count--) lengths.push(lengths[lengths.length - 1]);
        } else if (k == 17) {
          let count = r.read(3) + 3;
          for (; count > 0; count--) lengths.push(0);
        } else if (k == 18) {
          let count = r.read(7) + 11;
          for (; count > 0; count--) lengths.push(0);
        }
        if (lengths.length >= hlit + hdist) break;
      }

      huff2 = new HuffDic(lengths.slice(0, hlit));
      huff3 = new HuffDic(lengths.slice(hlit));
    } else {
      throw new Error("btype " + btype);
    }

    if (huff2) {
      while (true) {
        let k = huff2.readSymbol(r);
        let len = 0;
        let n = 0; // extra bits
        if (k < 256) {
          push(k);
          continue;
        } else if (k == 256) {
          // End of block
          break;
        } else if (k < 265) {
          len = k - 257 + 3;
          n = 0;
        } else if (k < 269) {
          len = (k - 265) * 2 + 11;
          n = 1;
        } else if (k < 273) {
          len = (k - 269) * 4 + 19;
          n = 2;
        } else if (k < 277) {
          len = (k - 273) * 8 + 35;
          n = 3;
        } else if (k < 281) {
          len = (k - 277) * 16 + 67;
          n = 4;
        } else if (k < 285) {
          len = (k - 281) * 32 + 131;
          n = 5;
        } else {
          len = 258;
          n = 0;
        }

        if (n > 0) len += r.read(n);

        // distance

        if (r.pos > r.len) throw new Error("EOF");

        let dist;
        if (huff3) dist = huff3.readSymbol(r);
        else dist = r.read(5);

        if (dist < 4) {
          dist++;
        } else if (dist < 30) {
          let db = (dist - 2) >> 1;
          let extra = (dist & 1) << db;
          extra |= r.read(db);
          dist = (1 << (db + 1)) + 1 + extra;
        } else {
          throw new Error(`dist ${dist}`);
        }

        if (dist > pos) throw new Error(`dist ${dist} > pos ${pos}`);

        let s: number = pos - dist;

        for (let i = 0; i < len; i++) push(out[s + i]);
      }
    }
  }
  return out.slice(0, pos);
}

interface Entry {
  size: number;
  start: number;
  end: number;
}

class ZipFile {
  data: Uint8Array;
  entries: Record<string, Entry>;
  constructor(data: Uint8Array) {
    this.data = data;
    this.entries = {};
    let td = new TextDecoder();
    let error = (msg: string) => {
      throw new Error(`${msg} at ${pos}`);
    };

    let view = new DataView(data.buffer);
    let pos = 0;
    while (pos < view.byteLength) {
      let sig = view.getUint32(pos, true);
      if (sig == 0x02014b50) break;
      if (sig != 0x04034b50) error(`bad sig ${sig.toString(16)}`);
      let method = view.getUint16(pos + 8, true);
      let csize = view.getUint32(pos + 18, true);
      let size = view.getUint32(pos + 22, true);
      let fnlen = view.getUint16(pos + 26, true);
      let eflen = view.getUint16(pos + 28, true);
      let fn = td.decode(data.slice(pos + 30, pos + 30 + fnlen));
      if (size) {
        let start = pos + 30 + fnlen + eflen;
        let end = start + csize;
        this.entries[fn] = { size, start, end };
      }
      pos = pos + 30 + fnlen + eflen + csize;
    }
  }
  getData(name: string) {
    let { start, end, size } = this.entries[name];
    return inflate(new Uint8Array(this.data.slice(start, end)));
  }
}

// *** node library emulation

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

let archive: ZipFile | undefined;
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
    // TODO - Idris is doing readdir, we should implement that
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
        if (files[name]) {
          buf = files[name];
        } else if (archive?.entries[name]) {
          // keep a copy of the uncompressed version for speed
          buf = files[name] = archive.getData(name);
        } else {
          process.errno = 1;
          throw new Error(`${name} not found`);
        }
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
      // console.log("close", handle.name);
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

let stdout = ''
const process: Process = {
  platform: "linux",
  argv: ["", ""],
  stdout: {
    // We'll want to replace this one
    write(s) {
      console.log("*", s);
      stdout += s;
    }
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

// This is referenced by Idris
const require = (x: string) => shim[x];

// *** Load idris
importScripts("idris2.js");
