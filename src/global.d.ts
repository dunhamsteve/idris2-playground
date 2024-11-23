declare module "*.css";
export {};
declare global {
  // typescript doesn't know worker.ts is a worker
  function importScripts(...scripts: string[]): void;
  interface Process {
    platform: string;
    stdout: {
      write(s: string): void;
    };
    argv: string[];
    exit(_: number): void;
    cwd(): string;
    env: Record<string,string>
    errno: number
  }
  let files: Record<string, string>;
  let process: Process;
  interface Window {
    state: any
  }
  let newtMain: () => unknown;
  let __mainExpression_0: () => unknown;
}
