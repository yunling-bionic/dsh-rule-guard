/**
 * rule-guard — 改代码前的二次合规复核
 *
 * 在 tools/pre-execute 阶段拦截「会写文件」的工具调用，先把
 * 【项目规则 + 当前目标 + 待执行调用】交给当前模型复核一次：
 *   - 通过  -> 放行
 *   - 不通过 -> 拒绝，并把「违反了哪条 / 怎么改」回给模型，让它修正后重试
 *
 * 规则来源（按顺序合并，存在才读）：
 *   <工作区>/AGENTS.md
 *   <工作区>/.dsh/rules.md
 *
 * 复核失败（网络/模型报错）时放行，避免把工作卡死，但会以结构化日志
 * 记录「工具 / 目标文件 / 会话 / 调用 ID / 失败原文」，保证事后可追溯。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'rule-guard'
export const inject = ['llm', 'workingDirectory']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LOG_FILE = path.join(HERE, '..', 'rule-guard.log')

const MUTATING_TOOLS = new Set(['write', 'edit', 'str_replace_editor'])
const SHELL_TOOLS = new Set(['bash', 'pwsh'])
const SHELL_WRITE = /(^|[^<])>{1,2}(?!&)|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\bsed\s+-i|\btee\b|git\s+apply|\bRemove-Item\b|\bNew-Item\b|\bMove-Item\b|\bCopy-Item\b|\bdel\s|\brmdir\b/

const PATH_KEYS = ['path', 'file_path', 'filePath', 'target_file', 'filename', 'file', 'notebook_path']
const MAX_ARGS = 7000
const MAX_RULES = 5000
const MAX_DIGEST = 500
const MAX_RAW = 800
const TIMEOUT_MS = 25000

const SYSTEM = `你是代码改动前的规则复核器（rule-guard）。你会收到三段内容：项目规则、当前目标（用户最近一条指令）、待执行的工具调用。
判断这次改动是否：（1）违反项目规则；（2）偏离当前目标，例如做了没被要求的事、改了范围外的文件、顺手重构。

只输出一个 JSON 对象，不要任何其他文字、不要 Markdown 代码块：
{"decision":"allow"}
{"decision":"deny","reason":"...","fix":"..."}

判断原则：
- 只有「明确」违反规则或明确偏离目标时才 deny。
- 证据不足、无法判断、纯风格差异、只是不完整但方向正确 -> allow。
- deny 时 reason 用一句中文说清违反了哪条规则或哪个目标；fix 用一句中文给出最小修正建议。
- 不要因为代码质量、命名、注释、格式而 deny。`

function truncate(text, limit) {
  const s = String(text ?? '')
  if (s.length <= limit) return s
  const head = Math.floor(limit * 0.7)
  const tail = limit - head
  return `${s.slice(0, head)}\n...［中间省略 ${s.length - limit} 字］...\n${s.slice(-tail)}`
}

/** 从一次工具调用里提取可追溯的上下文（不依赖模型输出）。 */
function execContext(exec) {
  const args = exec.arguments ?? {}
  const paths = []

  for (const key of PATH_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) paths.push(value.trim())
  }

  if (paths.length === 0) {
    const cmd = typeof args.command === 'string'
      ? args.command
      : typeof args.script === 'string'
        ? args.script
        : ''
    const found = cmd.match(/(?:[A-Za-z]:\\[^\s"'|;]+|(?:\.{1,2}\/)[^\s"'|;]+)/g)
    if (found) paths.push(...found.slice(0, 3))
  }

  let digest
  try {
    digest = truncate(JSON.stringify(args), MAX_DIGEST)
  } catch {
    digest = '［参数无法序列化］'
  }

  return {
    tool: exec.name,
    session: exec.agent?.session?.id ?? null,
    call: exec.callId ?? exec.rootCallId ?? null,
    paths: [...new Set(paths)],
    digest,
  }
}

/** 追加一行 JSON 日志；日志失败绝不影响主流程。 */
function logEvent(event, detail) {
  const record = { ts: new Date().toISOString(), event, ...detail }
  fs.appendFile(LOG_FILE, `${JSON.stringify(record)}\n`, 'utf8').catch(() => {})
}

function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
}

function lastUserText(session) {
  try {
    const events = session.snapshotEvents()
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i]
      if (e?.type !== 'user/message') continue
      if (e.data?.source?.kind === 'tool') continue
      const t = contentText(e.data?.content).trim()
      if (t) return t
    }
  } catch {
    /* 读不到历史就当作没有目标 */
  }
  return ''
}

function isMutating(exec) {
  if (MUTATING_TOOLS.has(exec.name)) return true
  if (!SHELL_TOOLS.has(exec.name)) return false
  const args = exec.arguments ?? {}
  const cmd = String(args.command ?? args.script ?? args.cmd ?? '')
  return SHELL_WRITE.test(cmd)
}

async function readIfExists(file, limit) {
  try {
    const text = await fs.readFile(file, 'utf8')
    return truncate(text.trim(), limit)
  } catch {
    return ''
  }
}

async function loadRules(cwd) {
  const parts = []
  for (const rel of ['AGENTS.md', path.join('.dsh', 'rules.md')]) {
    const file = path.join(cwd, rel)
    const text = await readIfExists(file, MAX_RULES)
    if (text) parts.push(`# ${rel}\n${text}`)
  }
  return parts.join('\n\n')
}

/** 极简流式聚合：只取文本，不依赖外部包。 */
async function collectText(stream) {
  let delta = ''
  let final = ''
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
      delta += chunk.text
    } else if (chunk?.type === 'block-end' && chunk.block?.type === 'text') {
      final = typeof chunk.block.text === 'string' ? chunk.block.text : final
    }
  }
  return delta || final
}

function parseVerdict(text) {
  const match = String(text ?? '').match(/\{[\s\S]*\}/)
  if (!match) return null
  let obj
  try {
    obj = JSON.parse(match[0])
  } catch {
    return null
  }
  if (obj?.decision === 'allow') return { decision: 'allow' }
  if (obj?.decision === 'deny') {
    return {
      decision: 'deny',
      reason: typeof obj.reason === 'string' && obj.reason.trim() ? obj.reason.trim() : '改动与规则或目标不符',
      fix: typeof obj.fix === 'string' ? obj.fix.trim() : '',
    }
  }
  return null
}

async function review(ctx, exec, cwd) {
  const rules = await loadRules(cwd)
  const goal = lastUserText(exec.agent?.session)
  if (!rules && !goal) return { decision: 'allow', skipped: true, why: 'no-rules-or-goal' }

  const header = exec.agent?.session?.requestHeader?.()
  const provider = header?.config?.provider
  const model = header?.config?.model
  if (!provider || !model) return { decision: 'allow', skipped: true, why: 'no-model-route' }

  const payload = truncate(JSON.stringify(exec.arguments ?? {}, null, 2), MAX_ARGS)
  const userText = [
    '【项目规则】',
    rules || '（未配置规则文件）',
    '',
    '【当前目标（用户最近一条指令）】',
    goal || '（未找到用户指令）',
    '',
    '【待执行】',
    `工具: ${exec.name}`,
    `参数: ${payload}`,
  ].join('\n')

  const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean))
  const stream = ctx.llm.stream({
    provider,
    model,
    system: SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    temperature: 0,
    signal,
  })

  const text = await collectText(stream)
  const verdict = parseVerdict(text)
  if (!verdict) {
    const error = new Error('无法解析复核结果')
    error.raw = text
    throw error
  }
  return verdict
}

export function apply(ctx) {
  ctx.on(
    'tools/pre-execute',
    async (exec, next) => {
      if (!isMutating(exec)) return next()

      let cwd = ''
      try {
        cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      } catch {
        cwd = ''
      }
      if (!cwd) {
        logEvent('skip', { ...execContext(exec), why: 'no-working-directory' })
        return next()
      }

      let verdict
      try {
        verdict = await review(ctx, exec, cwd)
      } catch (error) {
        logEvent('fail-open', {
          ...execContext(exec),
          error: String(error?.message ?? error),
          raw: error?.raw ? truncate(error.raw, MAX_RAW) : null,
        })
        return next()
      }

      if (verdict.skipped) {
        logEvent('skip', { ...execContext(exec), why: verdict.why ?? 'skipped' })
        return next()
      }

      if (verdict.decision !== 'deny') {
        logEvent('allow', execContext(exec))
        return next()
      }

      logEvent('deny', {
        ...execContext(exec),
        reason: verdict.reason,
        fix: verdict.fix || null,
      })

      const fix = verdict.fix ? `；建议：${verdict.fix}` : ''
      return {
        kind: 'deny',
        reason: `[rule-guard] 改动未通过规则复核：${verdict.reason}${fix}。请修正后重新提交。`,
        info: { name: 'RuleGuardDeniedError', code: 'RULE_GUARD_DENIED', reason: verdict.reason },
      }
    },
    { prepend: true },
  )

  logEvent('plugin-loaded', { version: '0.1.1' })
}
