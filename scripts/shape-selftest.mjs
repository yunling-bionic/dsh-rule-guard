// 真实形状验证：assistant/message 的正文在 data.message.content（不是 data.content）
// 运行：node scripts/shape-selftest.mjs
const m = await import('../lib/index.js')
const i = m.__internals

const sess = {
  snapshotEvents: () => [
    { type: 'user/message', data: { content: [{ type: 'text', text: '把 package.json 的 version 改成 0.4.2' }] } },
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '我打算这样改：version 改成 0.4.2，并同步两份 README' }] } },
    },
    { type: 'user/message', data: { content: [{ type: 'text', text: '授权' }] } },
  ],
}

const out = i.recentUserTexts(sess, 3)
console.log('条数 ' + out.length)
for (const t of out) console.log('  - ' + String(t).replace(/\n/g, ' ⏎ ').slice(0, 110))

const ok = out.some((t) => String(t).includes('上一条助手提案'))
console.log('')
console.log(ok ? '✅ 授权已携带被授权的提案（真实形状）' : '❌ 提案没带上，多形状提取未生效')
