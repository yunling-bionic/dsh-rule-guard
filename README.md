# dsh-rule-guard

> A DSH (DeepSeek Harness) plugin that reviews every code-modifying tool call against your project rules and the current goal **before** it executes. If the change breaks a rule or drifts off-task, the call is denied and the model is told exactly what to fix.

给 DeepSeek Harness 加一道「改代码前的二次复核」：每次写文件前，先拿**项目规则 + 你最近一条指令 + 待执行内容**过一遍模型，不合规直接拦下并给出修正建议。

仓库：<https://github.com/yunling-bionic/dsh-rule-guard>

## 解决什么问题

Agent 经常"顺手"做你没要求的事：改范围外的文件、顺手重构、把产物文件一起改了、跑偏目标。

`dsh-rule-guard` 在工具真正执行前插入一次复核，把"偏离"挡在落盘之前。

## 工作原理

挂在 Harness 的 `tools/pre-execute` 瀑布钩子上：

```
模型发起 write / edit / str_replace_editor / (pwsh|bash 写文件)
        │
        ▼
   rule-guard 复核（一次模型调用，temperature=0）
        │
   ┌────┴─────┐
   ▼          ▼
 allow      deny
   │          │
 正常执行   返回错误：违反了哪条规则 / 怎么改 → 模型修正后重试
```

复核输入三段：

1. **项目规则**：`<工作区>/AGENTS.md`、`<工作区>/.dsh/rules.md`（存在才读）
2. **当前目标**：本会话用户最近一条指令
3. **待执行调用**：工具名 + 参数（超长内容自动截断）

判定原则是**宁可放过、不可错杀**：证据不足、纯风格差异、无法判断 → 一律放行。

## 安装（从 GitHub）

```
git clone https://github.com/yunling-bionic/dsh-rule-guard.git
copy /Y dsh-rule-guard "<profile>\plugins\dsh-rule-guard"
```

之后照下面的「安装（DSH Desktop）」建链接、注册 bundles、重启。

## 安装（DSH Desktop）

以 `%APPDATA%\dsh-desktop\harness\profiles\web` 为例：

**1. 放包**

```
<profile>\plugins\dsh-rule-guard\      ← 本仓库内容
```

**2. 建链接**（管理员 cmd）

```bat
mklink /J "<profile>\node_modules\dsh-rule-guard" "<profile>\plugins\dsh-rule-guard"
```

**3. 注册到 profile**

编辑 `<profile>\package.json`：

```jsonc
{
  "dependencies": {
    "dsh-rule-guard": "link:./plugins/dsh-rule-guard"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...原有插件
        "dsh-rule-guard"
      ]
    }
  }
}
```

**4. 重启 DSH Desktop**

`bundles` 在启动时装配，热重载不会生效。

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

插件目录下 `rule-guard.log`：

| 记录 | 含义 |
|---|---|
| `plugin loaded` | 加载成功 |
| `DENY <tool>: <reason>` | 拦截了某次改动 |
| `FAIL-OPEN <tool>: <error>` | 复核环节异常，已放行（不阻塞工作） |

## 关闭 / 卸载

- **临时关闭**：把 `dsh-rule-guard` 从 profile 的 `bundles` 移除，重启
- **彻底卸载**：移除 `bundles` / `dependencies` 条目，删掉 `plugins\` 与 `node_modules\` 下的目录

## 兼容性

- DeepSeek Harness ≥ 0.2.x（依赖 `tools/pre-execute`、`ctx.llm`、`workingDirectory` 服务）
- 已在 DSH Desktop 0.11.1（Harness 0.2.1-rc.2）实测加载

## 成本与限制

- 每次改代码多一次模型调用：约 2–5 秒延迟 + 少量 token
- 复核使用**当前会话的模型**，模型越强判定越准
- 只看"改代码"类工具；纯读取、搜索不触发
- 这是**软约束**：模型仍可能改写措辞绕过判断，不要当成安全边界

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
