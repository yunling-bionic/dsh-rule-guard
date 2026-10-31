// 自测：数据目录解析与首次安装生成
// 运行：node scripts/first-run-selftest.mjs
// 效果：在标准插件数据目录下生成 RULES.md / INSTALL-NOTICE.txt / .first-run-done
//       （若已存在则不覆盖；想重测请先删除 .first-run-done）

const m = await import('../lib/index.js')
const i = m.__internals

const dir = i.dataDir()
console.log('数据目录：', dir)
console.log('规则文件：', dir + '\\RULES.md')
console.log('提示文件：', dir + '\\INSTALL-NOTICE.txt')

const fired = await i.emitFirstRunNoticeOnce()
console.log('本次是否触发首次提示：', fired)

console.log('\n--- 中文提示 ---')
console.log(i.FIRST_RUN_NOTICE_ZH)
console.log('\n--- English notice ---')
console.log(i.FIRST_RUN_NOTICE_EN)
