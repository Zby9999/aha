# 怎么做任务

## 分工

| 模块 | 负责人 | 标签 |
|---|---|---|
| 1 Agent Host | Bingyi | `owner:Bingyi` |
| 2 App Shell | Zeng | `owner:Zeng` |
| 3 Decision Layer | He | `owner:He` |
| 4 Learner Model | Jingyi | `owner:Jingyi` |
| 5 Teaching & GenUI | Junchi | `owner:Junchi` |

总 spec 是 [#1](https://github.com/Zby9999/aha/issues/1)，骨架是 [#2](https://github.com/Zby9999/aha/issues/2)。每个模块的 ticket 都挂在 #1 下面，带编号的子 ticket（如 `7.1`）是实际要做的单位。

关键日期：**11/24** 五个模块用桩串通，**11/27** 联调完成，**11/30** 交期末报告。

## 第一次准备

1. 接受仓库邀请，clone 仓库。
2. 安装 Pi 并执行 `pi login`。
3. 需要 Jev 的人把 key 写进本地的 `.env.local`。**这个文件不提交。**
4. 先读 `GLOSSARY.md` 和 `docs/adr/`，代码和 issue 里统一用这些词。

仓库已经自带 `/implement`、`/tdd`、`/code-review` 等 skill（在 `.agents/skills/`），Claude Code、Codex 等 agent 打开仓库就能用，不用另外安装。

## 每个 ticket 的流程

1. **选**：在 Issues 里筛选 `label:owner:你的名字`，挑一个没有被阻塞（没有 Blocked 标记）的子 ticket，编号小的先做。
2. **认领**：把自己设为 Assignee。
3. **开分支**：从最新的 `main` 开一个分支，名字用 issue 编号开头，例如 `git switch -c 31-jev-client`。
4. **实现**：在 agent 里运行 `/implement #31`。它会读 issue，用 `/tdd` 在模块接口上先写测试再实现，跑类型检查和测试，最后用 `/code-review` 自查并 commit。
5. **核对**：逐条勾选 issue 里的验收标准，没满足的继续改。
6. **提 PR**：推送分支，开 PR，描述里写 `Closes #31`，至少请一位组员 review。合并后 issue 会自动关闭，被它阻塞的 ticket 随之解锁。

## 规则

- **界面统一用 shadcn/ui + Tailwind（ADR-0004）。** 颜色、圆角等只改 `packages/app/ui/globals.css` 里的变量，不写零散的颜色值。新增课程卡片：在 `packages/contracts/src/catalog.ts` 加 props，在 `packages/app/ui/cards/registry.tsx` 加渲染。缺 shadcn 组件时在 `packages/app` 下运行 `pnpm dlx shadcn@latest add <组件>`。风格是 `base-rhea`（Base UI）；聊天区按 shadcn 的 AI Elements 写法用 Message Scroller、Message、Bubble、Trace、Code Block。

- **只改自己模块的 package。** 需要改共享契约（`contracts`）时单独开一个 PR，并 @ 所有受影响模块的负责人。
- **测试只测接口行为，用共享的 fixture 数据**，不依赖别人模块的真实实现。
- **公开仓库：** 不提交任何 API key、学号、邮箱或试用参与者的数据。
- **卡住了**：在 issue 里留言说明卡在哪，加 `needs-info` 标签，并在群里说一声。
