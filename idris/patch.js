let hook
Idris_REPL_repl = function(c,u,s,m,o,w) {
  hook = (cmd) => {
    let res = Idris_REPL_interpret(c, u, s, m, o, cmd, w)
    if (res.h) Idris_REPL_displayResult(c, s, o, res.a1)(w)
      else console.error('REPL ERROR:', res.a1)
    return res
  }
  // Right ()
  return {h: 1, a1: undefined}
}
function runCommand(cmd) {
  return hook(cmd)
}
// __mainExpression_0(); too early
