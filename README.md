# dsh-rule-guard

> A DSH (DeepSeek Harness) plugin that reviews every code-modifying tool call against your project rules and the current goal **before** it executes. If the change breaks a rule or drifts off-task, the call is denied and the model is told exactly what to fix.

给 DeepSeek Harness 加一道「改代码前的二次复核」：每次写文件前，先拿**项目规则 + 你最近一条指令 + 待执行内容**过一遍模型，不合规直接拦下并给出修正建议。

仓库：<https://github.com/yunling-bionic/dsh-rule-guard>

## 当前状态（v0.4.0）：它没有放行分支，模糊指令会被直接拒

这一版把判据换掉了：**不再问"这一步写不写文件"，只问"这一步在不在你当前的目标里"。**
技术风险、是否写文件都不再是判据。换来的是更严的边界，代价是**它不会替你猜意图**。

```
送审   行为类工具（写文件 / shell 非只读 / 装包 / 起服务 / 网络 /
       派子代理 / 定时任务 / 桌面操作 / office 落盘）
       未知工具默认送审；读工作区外也送审
免审   纯读取且在工作区内；只读 shell 白名单（Get-Content、git log 等）
失败   复核失败、输出不可解析、判决冲突 → 一律拒绝（不 fail-open）
豁免   无。failMode / allowTools / reviewReadsOutside / readRoots / 日志路径覆盖 全部删除
缓存   只复用「拒绝」，按会话隔离，10 分钟
```

**要它放行，把三件事说清：做什么、在哪、为什么。**

```
✅ "把 E:\SK\视觉\vision_mem_raw.py 里的 --win-sec 默认值改成 60，
    因为瞬时窗口按 60 秒算"
❌ "继续" / "优化一下" / "看着办"     → 目标不含具体改动 → 拒
```

**被拒时看 `rule-guard.log`**：每条是 JSON，`event=deny` 里有

```
ts        时间
tool      工具名（write / edit / pwsh / …）
paths     涉及的文件（数组）
digest    参数摘要（截断，足以判断你当时想干什么）
reason    违反了哪一条目标（点名）
fix       建议怎么改
```

**要放宽力度也可以，但得明说**——它没有开关可调，放宽的唯一方式是在指令里写清授权范围：

```
"这一轮允许改 视觉/ 下任何文件，不必逐条确认"
"这次只读操作，不需要复核"
```

说清楚了，它就不再拦；说不清楚，它就拒。这是刻意的：**模糊授权等于没授权。**

## 解决什么问题

Agent 经常"顺手"做你没要求的事：改范围外的文件、顺手重构、把产物文件一起改了、跑偏目标。

`dsh-rule-guard` 在工具真正执行前插入一次复核，把"偏离"挡在落盘之前。

## 工作原理

挂在 Harness 的 `tools/pre-execute` 瀑布钩子上，在**任何有副作用的动作**执行前插入一次复核：

```
行为类工具（写文件 / shell 非只读 / 装包 / 起服务 / 网络 /
            派子代理 / 定时任务 / 桌面操作 / office 落盘）
未知工具（默认送审）
读取工作区外的路径
        │
        ▼
   rule-guard 复核（一次模型调用，temperature=0）
        │
   ┌────┴─────┐
   ▼          ▼
 allow      deny
   │          │
 正常执行   返回错误：违反了哪条目标 + 怎么改 → 模型修正后重试
```

复核输入三段：

1. **项目规则**：`<工作区>/AGENTS.md`、`<工作区>/.dsh/rules.md`（存在才读）
2. **当前目标**：本会话用户最近一条指令
3. **待执行调用**：工具名 + 参数 + **脚本正文开头 4KB**（不只命令首行）

判据只有一条：**这一步是否在当前目标内。** 证据不足、无法解析、判决冲突时 **一律拒绝**，
不做"宁可放过"的推断 —— 这一版没有 fail-open 分支。

## 配置规则

在项目根目录建 `AGENTS.md`（或 `.dsh/rules.md`）：

```markdown
# 项目规则

- 只修改用户明确要求的文件，不做顺手重构
- 不改动 dist/、build/ 等产物目录
- 依赖变更必须先说明理由
- 提交前必须通过 npm test
```

参考示例：[examples/AGENTS.md](examples/AGENTS.md)

> 没有规则文件时，只按"当前目标"判断，效果会弱一些。

## 日志

插件目录下 `rule-guard.log`，**每行一个 JSON**，便于 grep 和脚本分析：

```json
{"ts":"2026-10-31T11:30:00.000Z","event":"deny","tool":"write","session":"sess-abc","call":"call-12","paths":["src/app.ts"],"digest":"{\"path\":\"src/app.ts\",...}","reason":"该写入不在目标内","fix":"只修改 README"}
{"ts":"2026-10-31T11:31:02.000Z","event":"deny","tool":"edit","session":"sess-abc","call":"call-13","paths":["src/util.ts"],"digest":"{...}","reason":"复核输出不可解析，按拒绝处理","fix":"把目标说清后重试"}
```

| event | 含义 | 关键字段 |
|---|---|---|
| `plugin-loaded` | 加载成功 | `version` |
| `allow` | 复核通过 | `tool` `paths` `call` |
| `deny` | 拦截（含"复核失败/不可解析"—— 这一版一律按拒绝处理） | `reason` `fix` |
| `skip` | 未复核（免审范围） | `why` |
| `cache-hit-deny` | 重复的同等动作直接命中缓存拒绝 | `paths` |

每条记录都带 **工具名、目标文件、会话 ID、调用 ID、参数摘要**，所以事后能精确定位到"哪一轮、哪一个动作、想干什么"。

常用排查：

```powershell
# 最近 5 次拦截
Select-String '"event":"deny"' rule-guard.log | Select-Object -Last 5
# 某个文件的全部记录
Select-String 'src/app.ts' rule-guard.log
```


## 兼容性

- DeepSeek Harness ≥ 0.2.x（依赖 `tools/pre-execute`、`ctx.llm`、`workingDirectory` 服务）
- 已在 DSH Desktop 0.11.1（Harness 0.2.1-rc.2）实测加载

## 成本与限制

- 每次送审多一次模型调用：约 2–5 秒延迟 + 少量 token
- 复核使用**当前会话的模型**，模型越强判定越准
- 送审面比 0.1.x 大：行为类工具 + 未知工具（默认送审）+ 读工作区外；
  只有"纯读取且在工作区内"和只读 shell 白名单免审
- 判决口径是 fail-closed：复核失败、输出不可解析、判决冲突 → 拒绝，
  所以**模糊指令会被直接拒**（这是刻意的，见上文「当前状态」）
- 缓存只复用"拒绝"，按会话隔离 10 分钟；不会因为曾被拒就永久拒绝
- 这是**软约束**：模型仍可能被措辞误导，不要当成安全边界

## 目录结构

```
dsh-rule-guard/
├── package.json          # dsh.bundle.patch 元数据
├── cordis.patch.yml      # 挂载条目
├── lib/index.js          # 插件本体（无第三方依赖）
├── examples/AGENTS.md    # 规则示例
├── LICENSE
└── README.md
```

## License

MIT © 2026 YL (韵铃)
