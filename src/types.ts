export interface CompileReq {
  id: string
  cmd: 'build' | 'repl' | 'save'
  src: string
}

export interface CompileRes {
  id: string
  output: string
  javascript: string
  cases: string
  duration: number
}
