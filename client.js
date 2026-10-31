// dsh-rule-guard 客户端入口：首次安装提示（横幅，可关闭，只弹一次）
// 加载范式与 dsh-purge 的 client.js 一致：window.__ModuleLoader__.load + slot 注册
window.__ModuleLoader__.load({
  id: "dsh-rule-guard",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const h = react.createElement;

    const name = "dsh-rule-guard";
    const inject = ["slots"];
    const STORE_KEY = "dsh-rule-guard:first-run-notice:v1";

    function alreadySeen() {
      try {
        return localStorage.getItem(STORE_KEY) === "1";
      } catch {
        return false;
      }
    }

    function markSeen() {
      try {
        localStorage.setItem(STORE_KEY, "1");
      } catch {
        /* 忽略：隐私模式下 localStorage 可能不可用 */
      }
    }

    function NoticeBanner() {
      const [open, setOpen] = react.useState(() => !alreadySeen());
      if (!open) return null;

      const close = () => {
        markSeen();
        setOpen(false);
      };

      const wrap = {
        position: "fixed",
        left: "50%",
        top: 16,
        transform: "translateX(-50%)",
        zIndex: 2147483000,
        width: "calc(100% - 32px)",
        maxWidth: 640,
        boxSizing: "border-box",
        background: "var(--dsw-alias-bg-layer-2, #ffffff)",
        color: "var(--dsw-alias-text-primary, #111827)",
        border: "1px solid var(--dsw-alias-border-1, #d1d5db)",
        borderRadius: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
        padding: "14px 16px",
        fontSize: 13,
        lineHeight: 1.65,
        fontFamily: "inherit",
        textAlign: "left",
      };
      const title = { fontWeight: 600, marginBottom: 6, paddingRight: 24 };
      const btn = {
        position: "absolute",
        right: 10,
        top: 8,
        border: "none",
        background: "transparent",
        color: "inherit",
        opacity: 0.55,
        fontSize: 18,
        lineHeight: 1,
        cursor: "pointer",
        padding: 2,
      };
      const en = { marginTop: 8, opacity: 0.75 };
      const path = { marginTop: 8, opacity: 0.6, fontSize: 12 };
      const actions = { marginTop: 10, display: "flex", gap: 8 };

      return h(
        "div",
        { style: wrap, role: "status", "aria-live": "polite" },
        h("button", { style: btn, title: "关闭 / close", onClick: close }, "\u00d7"),
        h("div", { style: title }, "rule-guard 已安装 · 规则可以自己定"),
        h(
          "div",
          null,
          "可以自己定规则，方式两种：一是自己手动编辑规则文件；二是直接让 AI 按需要修改这个规则文件。两种方式效果相同 —— 规则文件是数据，插件只负责读取与执行。",
        ),
        h(
          "div",
          { style: en },
          "You can define your own rules. Two ways: edit the rule file by hand, or simply ask the AI to modify that rule file as needed.",
        ),
        h(
          "div",
          { style: path },
          "规则文件 / rules file：%APPDATA%\\dsh-desktop\\harness\\rule-guard\\RULES.md 或项目根目录 AGENTS.md",
        ),
        h(
          "div",
          { style: actions },
          h(
            "button",
            {
              onClick: close,
              style: {
                border: "1px solid var(--dsw-alias-border-1, #d1d5db)",
                background: "transparent",
                color: "inherit",
                borderRadius: 8,
                padding: "4px 12px",
                cursor: "pointer",
                fontSize: 12,
              },
            },
            "知道了 / Got it",
          ),
        ),
      );
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return;
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          {
            name: "shell.overlay",
            id: "dsh-rule-guard-notice",
            order: 60,
          },
          () => h(NoticeBanner),
        ),
      );
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
