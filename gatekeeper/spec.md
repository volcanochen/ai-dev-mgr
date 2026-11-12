# Gatekeeper 接口规范（gk.spec/1）

> 版本：1 · 生效日期：2026-11-13
> 适用范围：AI Agent、工具链（CI）、人与流程管控台（Gatekeeper）之间的**全部**交互。
> 机器可读登记表：`js/logic.js` 中的 `LOGIC.INTERFACES`；本规范与其一一对应。
> **发布门禁**：每次发布前必须运行 `node selftest.js`，其中「I. 接口规范测试套件」
> 全部通过方可发布。接口变更（新增 / 修改 / 废弃）必须同步更新本文件与 `INTERFACES` 表。

## 1. 主体与身份

| 主体 | actor 值 | 身份 | 职责 | 权限 |
| --- | --- | --- | --- | --- |
| AI Agent | `ai` | `agent-ai-01`（AI Agent 适配器） | 加载上下文 / 检索代码库 / 生成结构化产出 / 写测试与实现 | 仅 produce，**无**审批权 |
| 工具链 | `toolchain` | `ci-runner-01`（CI 验证与签名服务） | 执行测试 / Lint / 覆盖率 / 越界检测 / 签名回传证据 | 仅 sign，**无**审批权 |
| 人 | `human` | 审批人 | 批准 / 打回 / Review / 裁决 / 越界说明 / 记忆确认 / 精简跳过 | 唯一审批主体 |
| 系统编排 | `system` | `flow-engine-01` | 步骤移交 / 越界检出升级 / 状态机推进 | 内部编排，不属于外部执行者 |

身份由调用参数 `role` 显式声明；接口内部校验 `role === caller`，不匹配时返回
`{ok:false, msg:'权限拒绝：…'}` 并写入 `PERMISSION_DENIED` 事件。

## 2. 交互接口

所有接口同步调用，统一返回契约：`{ok:boolean, msg:string}`（`ok:false` 表示被拒绝或前置不满足，状态不变）。

### 2.1 AI 接口（caller = ai）

| 接口 ID | 函数 | 调用形式 | 行为 |
| --- | --- | --- | --- |
| `gk.ai.submit` | `LOGIC.aiSubmit` | `(state, 'ai')` | 提交当前阶段结构化产出：登记 artifact（含 `ref` 外部存储引用）+ 模拟评审文件；附「已自测全绿」自报声明（系统不采信）。G4 阶段不可用（走 task 接口） |
| `gk.ai.task.action` | `LOGIC.aiTaskAction` | `(state, 'ai', which, taskId?)` | G4 内层：`which='test'` 先写测试；`which='impl'` 写实现 + Diff（需红证据就绪）；登记对应工件与越界记录 |

### 2.2 工具链接口（caller = toolchain）

| 接口 ID | 函数 | 调用形式 | 行为 |
| --- | --- | --- | --- |
| `gk.toolchain.sign` | `LOGIC.toolSubmit` | `(state, 'toolchain')` | 阶段机器验证后签名回传证据：登记 evidence，绑定 `signer / commitHash / diffHash / result`。G4 阶段不可用（走 task 接口） |
| `gk.toolchain.task` | `LOGIC.toolTaskAction` | `(state, 'toolchain', which, taskId?)` | G4 内层：`which='red'` 红阶段证据（需测试已写）；`'green'` 绿测 + Lint（需实现已交）；`'oos'` 越界检测（需绿测就绪）。全部签名绑定该 Task 自己的 commit / diff hash |

### 2.3 人接口（caller = human，唯一审批主体）

| 接口 ID | 函数 | 调用形式 | 行为 |
| --- | --- | --- | --- |
| `gk.human.approve` | `LOGIC.approve` | `(state, 'human')` | 签署当前门禁：需 `autoCheck` 全通过；通过后 phaseIdx+1，并授权下一阶段自动执行 |
| `gk.human.reject` | `LOGIC.reject` | `(state, 'human', reason)` | 打回（意见必填）：清当前阶段产出与证据、生成候选记忆、授权自动重做；G4 打回时全部 Task 复位 |
| `gk.human.skip` | `LOGIC.skipPhase` | `(state, 'human', reason?)` | **精简流程**：经人确认跳过当前阶段（如普通任务不需要 G9 运维）。门禁记录 `{skipped:true, reason}` 留痕，事件 `PHASE_SKIPPED`，随后正常进入下一阶段。度量口径排除 skipped 门禁 |
| `gk.human.review` | `LOGIC.reviewTask` | `(state, 'human', 'ok'\|'no', note, taskId?)` | G4 逐 Task 独立评审：签字 / 打回（打回生成候选记忆并授权修订） |
| `gk.human.arbitrate` | `LOGIC.arbitrate` | `(state, 'human', taskId?)` | G4 失败熔断（超 FAIL_LIMIT 次）后的人裁决，解除冻结 |
| `gk.human.explain` | `LOGIC.explainOutOfScope` | `(state, 'human', text, taskId?)` | 越界改动人工说明（必填），审计留痕 |
| `gk.human.memory` | `LOGIC.confirmMemory / revokeMemory` | `(state, memoryId, 'human')` | G10 记忆确认：入库（active，下轮 G0 注入）或否决（revoked） |

### 2.4 模拟主体的接入边界

- 原型阶段 AI 与工具链由**模拟适配器**代跑（`ACTORS[*].simulated=true`），
  但必须且只能通过上述接口改变状态；模拟动作在执行凭证中标注「演示模拟执行」。
- 接入真实 AI / 真实 CI 时，只需把适配器实现替换为真实调用，接口与契约不变
  （与存储插件升级方式一致：换适配器，不动状态机）。

## 3. 数据契约

### 3.1 工件 artifact（AI 经 `gk.ai.submit` / `gk.ai.task.action` 产出）

必填：`id / phase / kind('ai') / type / title / version / hash / producer / ts /
selfReport / ref{uri,hash,sizeBytes} / file{path,name,kind,ref{uri,hash},…} / producedBy`。
内容本体不进状态机，只存 `{uri,hash,sizeBytes}` 引用（GKSTORE 插件写入外部存储）。

### 3.2 证据 evidence（工具链经 `gk.toolchain.sign` / `gk.toolchain.task` 产出）

必填：`id / phase / kind('stage'|'task') / taskId? / type / title /
source:'toolchain' / signer / commitHash / diffHash / result / ts /
ref{uri,hash,sizeBytes} / producedBy`。
**AI 自报不构成证据**；门禁引擎只认工具链签名并绑定 commit / diff hash 的证据。

### 3.3 执行凭证 receipt（schema：`gk.receipt/1`）

每步自动执行（含模拟）必须生成，字段：
`schema / who{id,name,kind,runtime,duty,simulated,stepSeq} / when{startedAt,endedAt,durationMs} /
where{round,phase,phaseName,taskId,acIds} / what{step,detail,fn} / method{tool,operation,params,basis} /
inputs[{kind,label,source,count,items}] / outputs[] / note / refs{traceId,eventId,artifactIds,evidenceIds,memoryIds,filePaths,commitHash,diffHash} /
result{status,message} / simulated`。
凭证本体经 `putRef('receipt/<TR-id>.json', …)` 外置，trace 只留引用 + `receiptLite` 摘要。
`refs.traceId` 必须等于所属 trace 的 `id`（自引用校验）。

### 3.4 权限事件矩阵（审计校验点）

| 事件 action | 只允许的 actor |
| --- | --- |
| `ARTIFACT_SUBMITTED` / `TEST_WRITTEN` / `DIFF_SUBMITTED` | ai |
| `EVIDENCE_SIGNED` / `SELFTEST_FAILED` | toolchain |
| `GATE_APPROVED` / `GATE_REJECTED` / `DIFF_REVIEWED` / `DIFF_REJECTED` / `HUMAN_ARBITRATION` / `OUT_OF_SCOPE_EXPLAINED` / `MEMORY_CONFIRMED` / `MEMORY_REVOKED` / `PHASE_SKIPPED` | human |
| `PERMISSION_DENIED` / `ESCALATED` / `ROUND_STARTED` / `ROUND_FINISHED` / `AUTO_STEP` 等 | system / 各自主体（见事件日志） |

## 4. 发布验证

1. `node selftest.js` —— 全部断言通过；其中 **I 段 = 接口规范测试套件**，覆盖：
   - `INTERFACES` 登记表与 `spec.md` 一致（接口 ID / 函数名 / caller 逐条存在且可调用）；
   - 越权调用被拒绝并留痕（每个接口用错误主体调用必须 `{ok:false}` + `PERMISSION_DENIED`）；
   - 数据契约：全部工件 / 证据 / 凭证字段齐备，凭证 schema = `gk.receipt/1`，`simulated` 标注正确；
   - 权限事件矩阵：事件日志中各 action 的 actor 与 §3.4 一致；
   - 精简跳过（`gk.human.skip`）行为与留痕正确。
2. 接口或契约变更时：先改 `INTERFACES` 表 → 同步改本文件 → 跑 selftest → 再发布。
