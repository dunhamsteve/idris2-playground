// TODO sum type
export interface WorkerReq {
  id: string
  cmd: 'build' | 'repl' | 'save' | 'load'
  src: string
}
export interface WorkerRes {
  id: string
  output: string
}

export interface CompileRes {
  id: string
  output: string
  javascript: string
  cases: string
  duration: number
}
