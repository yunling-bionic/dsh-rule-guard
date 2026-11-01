// 自测：目标窗口取值逻辑（最近三条 / 刚开始全用 / 授权携带被授权提案）
// 运行：node scripts/goal-window-selftest.mjs
const m = await import('../lib/index.js')
const i = m.__internals

const mk = (pairs) => ({
  snapshotEvents: () =>
    pairs.map(([type, text]) => ({ type, data: { content: [{ type: 'text', text }] } })),
})

const cases = [
  ['刚开始：只有 1 条指令', [['user/message', '帮我修一下 vision_mem_raw.py 的窗口参数']]],
  [
    '授权 + 前面的提案',
    [
      ['user/message', '把 package.json 的 version 改成 0.4.2'],
      ['assistant/message', '我打算这样改：version 改成 0.4.2，并同步两份 README'],
      ['user/message', '授权'],
    ],
  ],
  ['只有授权、没有提案', [['user/message', '继续'], ['user/message', '授权']]],
  [
    '正常：多条都带内容',
    [
      ['user/message', '先看代码'],
      ['user/message', '改判别方式'],
      ['user/message', '把窗口从 3 条改成全部'],
      ['user/message', '授权'],
    ],
  ],
  [
    '长会话：窗口外还有实质指令',
    [
      ['user/message', '把 RULES.md 生成到数据目录'],
      ['user/message', '好'],
      ['user/message', '可以'],
      ['user/message', '授权'],
      ['user/message', '继续'],
    ],
  ],
]

for (const [name, pairs] of cases) {
  const out = i.recentUserTexts(mk(pairs), 3)
  console.log(`[${name}] → ${out.length} 条`)
  for (const t of out) console.log('    - ' + String(t).replace(/\n/g, ' ⏎ ').slice(0, 100))
  console.log('')
}
