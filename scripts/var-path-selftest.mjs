// 自测：变量拼接路径（漏点一）
// 运行：node scripts/var-path-selftest.mjs
const m = await import('../lib/index.js')
const i = m.__internals
const expandLocalVars = m.expandLocalVars ?? i.expandLocalVars

const probe = `$p = 'C:\\Temp\\rg-bypass-1.txt'
Set-Content -LiteralPath $p -Value 'probe'`

const cases = [
  ['变量字面量赋值', probe],
  ['纯字面量', `Set-Content -LiteralPath 'C:\\Temp\\x.txt' -Value 'probe'`],
  ['变量无赋值（应判未知）', `Set-Content -LiteralPath $env:TEMP\\y.txt -Value 'probe'`],
  ['命令替换（应判未知）', `Set-Content -LiteralPath $(Get-Date) -Value 'x'`],
]

for (const [name, cmd] of cases) {
  const { text, unresolved } = expandLocalVars(cmd)
  const cwd = 'E:\\SK'
  const exec = { name: 'pwsh', arguments: { command: cmd } }
  const outside = (m.readsOutsideScope ?? i.readsOutsideScope)(exec, m.DEFAULTS ?? i.DEFAULTS, cwd)
  console.log(`[${name}]`)
  console.log('    展开后：' + text.replace(/\n/g, ' ⏎ ').slice(0, 100))
  console.log('    未解析变量：' + unresolved + '   判定为区外/未知：' + outside)
  console.log('')
}
