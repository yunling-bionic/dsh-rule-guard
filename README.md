# dsh-rule-guard

> A DSH (DeepSeek Harness) plugin that reviews every side-effecting tool call against the project rules and the current goal before it executes, and denies anything outside that scope.

在工具真正执行之前插入一次复核：取**项目规则 + 当前目标 + 待执行动作**，判断该动作是否在当前目标内；不在则拒绝执行，并把违反的目标与修正建议回给模型。

仓库：<https://github.com/yunling-bionic/dsh-rule-guard>

- 版本：0.4.0
- 依赖：DeepSeek Harness ≥ 0.2.x
- 许可：MIT

## 一、设计目标

Agent 在长任务中容易产生范围外动作：改动未被要求的文件、顺手重构、把构建产物一并纳入修改、偏离当前目标。

本插件在动作落盘之前插入一次独立复核，将这类偏离挡在执行之前。复核由当前会话的模型完成，判定口径与项目规则文件一致。

## 二、判定原则

判据只有一条：**这一动作是否在当前目标之内。**

以下内容不作为判据：
- 是否写文件
- 技术风险高低
- 代码风格差异

判决口径为 fail-closed：

| 情形 | 处理 |
|---|---|
| 明确不在目标内 | 拒绝 |
| 复核失败（模型调用异常） | 拒绝 |
| 复核输出不可解析 | 拒绝 |
| 多路判决冲突 | 拒绝 |

本版本不含放行分支（fail-open），亦不提供任何豁免开关。因此**表述模糊的指令会被直接拒绝**，这是设计取舍：模糊授权不等于授权。

## 三、送审范围

**送审（有副作用的动作）**

- 文件写入与编辑（`write` / `edit` / `str_replace_editor` / 脚本内落盘）
- shell 非只读命令（重定向、`Set-Content`、`Remove-Item`、装包、起服务等）
- 网络请求、启动子代理、定时任务、桌面操作、office 文档落盘
- 未知工具：默认送审
- 读取工作区之外的路径

**免审**

- 纯读取，且路径在工作区内
- 只读 shell 白名单（`Get-Content`、`git log` 等）

## 四、使用方式

如需放行，请在指令中同时给出三项信息：**做什么、在哪里、为什么**。

```
允许示例：
  把 E:\SK\视觉\vision_mem_raw.py 的 --win-sec 默认值改为 60，
  因为瞬时层窗口按 60 秒计算。

拒绝示例：
  继续 / 优化一下 / 看着办
```

如需临时放宽力度，应在指令中写明授权范围；插件不提供配置开关：

```
本轮允许修改 视觉/ 目录下的任何文件，无需逐条确认。
本轮仅执行只读操作，无需复核。
```

被拒绝时，查看插件目录下的 `rule-guard.log`：`event=deny` 的记录包含违反的目标与建议做法。

## 五、工作原理

挂载于 Harness 的 `tools/pre-execute` 瀑布钩子，在动作执行前插入一次模型复核（`temperature=0`）：

```
有副作用的动作 / 未知工具 / 读取工作区外
        │
        ▼
   rule-guard 复核
        │
   ┌────┴─────┐
   ▼          ▼
 allow      deny
   │          │
 正常执行   返回错误（违反的目标 + 修正建议），模型修正后重试
```

复核输入由三部分组成：

1. **项目规则**：`<工作区>/AGENTS.md`、`<工作区>/.dsh/rules.md`（存在时读取）
2. **当前目标**：本会话中用户最近一条指令
3. **待执行动作**：工具名、参数，以及脚本正文开头 4 KiB

缓存策略：仅复用「拒绝」判决，按会话隔离，有效期 10 分钟。

## 六、自定义规则

规则文件由用户掌握，插件只负责读取与执行。定义方式有两种，效果相同：

**方式一：手动编辑**

在工作区根目录建立并维护 `AGENTS.md`（或 `.dsh/rules.md`）：

```markdown
# 项目规则

- 只修改用户明确要求的文件，不做顺手重构
- 不改动 dist/、build/ 等产物目录
- 依赖变更必须先说明理由
- 提交前必须通过 npm test
```

**方式二：让 AI 按需修改**

直接要求 AI 修改该规则文件即可，例如：

```
把"提交前必须通过 npm test"加进 AGENTS.md 的项目规则里
```

两种方式的共同前提：规则文件是数据，可以进版本库、可以回顾改动；插件本身不含硬编码的项目规则。

示例见 [examples/AGENTS.md](examples/AGENTS.md)。未提供规则文件时，仅按当前目标判断。

**首次安装提示**：插件首次加载时，会在标准插件数据目录生成 `RULES.md` 与 `INSTALL-NOTICE.txt`，
向 `rule-guard.log` 记一条 `first-run-notice`，并通过 stderr 输出中英文提示：

```
标准插件数据目录（与 dshHomePath('rule-guard') 等价）
  Windows   %APPDATA%\dsh-desktop\harness\rule-guard\
  Linux/mac ~/.dsh/rule-guard/
      RULES.md            复核机制的通用规则（首次生成；用户改过则不覆盖）
      INSTALL-NOTICE.txt  中英文提示原文
      .first-run-done     首次标记（存在即不再提示）
```

> 可以自己定规则，方式两种：自己手动编辑规则文件，或根据需要直接让 AI 改规则文件。
>
> You can define your own rules. Two ways: edit the rule file by hand, or simply ask the AI
> to modify that rule file as needed.

规则文件放在数据目录而非安装包内，因此**升级插件不会覆盖用户改动**。

## 七、日志

插件目录下的 `rule-guard.log`，每行一条 JSON：

```json
{"ts":"2026-10-31T11:30:00.000Z","event":"deny","tool":"write","session":"sess-abc","call":"call-12","paths":["src/app.ts"],"digest":"{\"path\":\"src/app.ts\"}","reason":"该写入不在当前目标内","fix":"只修改 README"}
```

| event | 含义 | 关键字段 |
|---|---|---|
| `plugin-loaded` | 插件加载完成 | `version` |
| `allow` | 复核通过 | `tool` `paths` `call` |
| `deny` | 拒绝（含复核失败与不可解析） | `reason` `fix` |
| `skip` | 免审，未复核 | `why` |
| `cache-hit-deny` | 同等动作命中缓存拒绝 | `paths` |

每条记录包含工具名、目标路径、会话 ID、调用 ID 与参数摘要，可用于定位到具体轮次与动作。

常用查询：

```powershell
Select-String '"event":"deny"' rule-guard.log | Select-Object -Last 5
Select-String 'src/app.ts' rule-guard.log
```

## 八、兼容性

- DeepSeek Harness ≥ 0.2.x（依赖 `tools/pre-execute`、`ctx.llm`、`workingDirectory` 服务）
- 已在 DSH Desktop 0.11.1（Harness 0.2.1-rc.2）实测加载

## 九、成本与限制

- 每次送审增加一次模型调用：约 2–5 秒延迟与少量 token 开销
- 复核使用当前会话的模型，模型能力越强，判定越准确
- 送审范围包含行为类工具、未知工具与工作区外读取
- 判决 fail-closed，表述模糊的指令会被拒绝
- 缓存仅复用「拒绝」，按会话隔离，10 分钟
- 属于软约束：模型可能被措辞误导，不应视为安全边界

## 十、目录结构

```
dsh-rule-guard/
├── package.json          # dsh.bundle.patch 元数据
├── cordis.patch.yml      # 挂载条目
├── lib/index.js          # 插件实现（无第三方依赖）
├── examples/AGENTS.md    # 规则示例
├── LICENSE
└── README.md
```

## License

MIT © 2026 YL（韵铃）
