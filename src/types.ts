export interface CompileReq {
  src: string;
}

export interface CompileRes {
  output: string
  javascript: string
  cases: string
  duration: number
}
