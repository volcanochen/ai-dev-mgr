# Gatekeeper 接口规范（gk.spec/1）

> 版本：1.1 · 生效日期：2026-11-13
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

| 接口 ID | 函数 | caller | 调用形式 | 行为 |
| --- | --- | --- | --- | --- |
| `gk.ai.submit` | `LOGIC.aiSubmit` | ai | `(state, 'ai')` | 提交当前阶段结构化产出：登记 artifact（含 `ref` 外部存储引用）+ 模拟评审文件；附「已自测全绿」自报声明（系统不采信）。G4 阶段不可用（走 task 接口） |
| `gk.ai.task.action` | `LOGIC.aiTaskAction` | ai | `(state, 'ai', which, taskId?)` | G4 内层：`which='test'` 先写测试；`which='impl'` 写实现 + Diff（需红证据就绪）；登记对应工件与越界记录 |
| `gk.toolchain.sign` | `LOGIC.toolSubmit` | toolchain | `(state, 'toolchain')` | 阶段机器验证后签名回传证据：登记 evidence，绑定 `signer / commitHash / diffHash / result`。G4 阶段不可用（走 task 接口） |
| `gk.toolchain.task` | `LOGIC.toolTaskAction` | toolchain | `(state, 'toolchain', which, taskId?)` | G4 内层：`which='red'` 红阶段证据（需测试已写）；`'green'` 绿测 + Lint（需实现已交）；`'oos'` 越界检测（需绿测就绪）。全部签名绑定该 Task 自己的 commit / diff hash |
| `gk.human.approve` | `LOGIC.approve` | human | `(state, 'human')` | 签署当前门禁：需 `autoCheck` 全通过；通过后 phaseIdx+1，并授权下一阶段自动执行 |
| `gk.human.reject` | `LOGIC.reject` | human | `(state, 'human', reason)` | 打回（意见必填）：清当前阶段产出与证据、生成候选记忆、授权自动重做；G4 打回时全部 Task 复位 |
| `gk.human.skip` | `LOGIC.skipPhase` | human | `(state, 'human', reason?)` | **精简流程**：经人确认跳过当前阶段（如普通任务不需要 G9 运维）。门禁记录 `{skipped:true, reason}` 留痕，事件 `PHASE_SKIPPED`，随后正常进入下一阶段。度量口径排除 skipped 门禁 |
| `gk.human.review` | `LOGIC.reviewTask` | human | `(state, 'human', 'ok'\|'no', note, taskId?)` | G4 逐 Task 独立评审：签字 / 打回（打回生成候选记忆并授权修订） |
| `gk.human.arbitrate` | `LOGIC.arbitrate` | human | `(state, 'human', taskId?)` | G4 失败熔断（同一 Task 连续失败超 FAIL_LIMIT=3 次）后的人裁决，解除冻结 |
| `gk.human.explain` | `LOGIC.explainOutOfScope` | human | `(state, 'human', text, taskId?)` | 越界改动人工说明（必填），审计留痕 |
| `gk.human.memory` | `LOGIC.confirmMemory / revokeMemory` | human | `(state, memoryId, 'human')` | G10 记忆确认：入库（active，下轮 G0 注入）或否决（revoked） |

### 2.1 模拟主体的接入边界

- 原型阶段 AI 与工具链由**模拟适配器**代跑（`ACTORS[*].simulated=true`），
  但必须且只能通过上述接口改变状态；模拟动作在执行凭证中标注「演示模拟执行」。
- 接入真实 AI / 真实 CI 时，只需把适配器实现替换为真实调用，接口与契约不变
  （与存储插件升级方式一致：换适配器，不动状态机）。

## 3. 数据契约（字段级说明）

所有引用字段格式统一为 `{uri, hash, sizeBytes}`：`uri` 指向外部存储位置
（如 `gk://<ns>/artifact/A-001.json`），`hash` 为内容 FNV 哈希（可校验篡改），
`sizeBytes` 为字节数。**内容本体一律不进状态机。**

### 3.1 工件 artifact（AI 经 `gk.ai.submit` / `gk.ai.task.action` 产出）

用途：AI 阶段产出的结构化数据本体（Context Brief、PRD、Plan、Task 清单、测试代码、Diff…），
是人评审门禁的对象；其 `hash` 用于跨轮校验「打回后重做是否真的变了」。

| 字段 | 类型 | 必填 | 怎么填 | 干什么用 |
| --- | --- | --- | --- | --- |
| `id` | string | ✓ | 适配器生成，格式 `A-<三位序号>`（如 `A-004`），由 `state.seq` 递增保证唯一 | 全流程引用键，凭证 `refs.artifactIds` 指向它 |
| `phase` | string | ✓ | 当前阶段 ID，`G0`–`G10`（G4 内 Task 产出也记 `G4`） | 门禁引擎按阶段归类校验 |
| `kind` | string | ✓ | 恒为 `'ai'`（标识产出主体） | 审计矩阵校验：AI 工件只能来自 ai |
| `type` | string | ✓ | 阶段类型：`G0`=Context Brief、`G1`=PRD、`G2`=Plan、`G3`=Task 清单、`G4` 内=`test_code` / `diff` | 决定模拟文件模板与文件路径（FILE_META） |
| `title` | string | ✓ | 人可读标题；G4 内产出须含 Task ID（如「T2 测试」），文件路径据此替换 `__task__` | 展示与检索 |
| `version` | number | ✓ | 从 1 起；同阶段打回重做后 +1 | 区分重做版本 |
| `hash` | string | ✓ | 内容 FNV 哈希（`hash(JSON.stringify(data))`） | 打回重做对比、防篡改 |
| `producer` | string | ✓ | AI 身份 `agent-ai-01` | 审计追溯 |
| `ts` | number | ✓ | `Date.now()` 产出时间 | 时间线 |
| `selfReport` | string | ✓ | AI 自报声明，固定 `'自报：已自测全绿，待工具链签名验证'`。**系统不采信**，仅展示 | 提示人：门禁只认工具链证据 |
| `ref` | `{uri,hash,sizeBytes}` | ✓ | 经 `putRef(state,'artifact/<id>.json', data)` 生成 | 取回结构化数据本体 |
| `file` | object | ✓ | 由 `buildFile` 从 data 展开成 Markdown 模拟评审文件：`path`（FILE_META 映射）、`name`、`kind`、`encoding:'utf-8'`、`sizeBytes`、`lineCount`、`ref`（内容引用）、`simulated:true`、`generatedFrom:'artifact:<id>'`、`hash` | 人评审时「打开文件阅读 → 回审批台签字」 |
| `producedBy` | string | ✓ | `'aiSubmit'`（阶段产出）或 `'aiTaskAction'`（G4 内层产出） | 接口来源审计 |

示例（G1 阶段 PRD 工件）：

```json
{
  "id": "A-002", "phase": "G1", "kind": "ai", "type": "G1",
  "title": "结构化 PRD：短信验证码登录", "version": 1,
  "hash": "3f81a2b7", "producer": "agent-ai-01", "ts": 1762950000000,
  "selfReport": "自报：已自测全绿，待工具链签名验证",
  "ref": { "uri": "gk://inst-1101/artifact/A-002.json", "hash": "3f81a2b7", "sizeBytes": 2046 },
  "file": { "path": "docs/prd/PRD-短信验证码登录.md", "name": "PRD-短信验证码登录.md",
            "kind": "需求文档 PRD", "encoding": "utf-8", "sizeBytes": 1840, "lineCount": 42,
            "ref": { "uri": "gk://inst-1101/file/A-002.md", "hash": "a1c09e33" },
            "simulated": true, "generatedFrom": "artifact:A-002", "hash": "a1c09e33" },
  "producedBy": "aiSubmit"
}
```

### 3.2 证据 evidence（工具链经 `gk.toolchain.sign` / `gk.toolchain.task` 产出）

用途：机器验证结果，**门禁引擎解锁的唯一依据**。AI 自报不构成证据。

| 字段 | 类型 | 必填 | 怎么填 | 干什么用 |
| --- | --- | --- | --- | --- |
| `id` | string | ✓ | 适配器生成，格式 `EV-<三位序号>` | 凭证 `refs.evidenceIds` 指向它 |
| `phase` | string | ✓ | 当前阶段 ID；G4 内层证据记 `G4` | 归类 |
| `kind` | string | ✓ | `'stage'`（阶段级验证）或 `'task'`（G4 逐 Task 验证，需同时填 `taskId`） | 区分校验范围 |
| `taskId` | string | kind=task 时必填 | 该证据所属 Task ID（如 `T2`），且必须与 Task 的 diff hash 对应 | 逐 Task 签字依据 |
| `type` | string | ✓ | `'consistency'` 需求一致性扫描 / `'red'` 红测 / `'green'` 绿测 / `'lint'` 静态检查 / `'oos'` 越界检测 / `'coverage'` 覆盖率 / `'build'` 构建校验 | 决定该证据解锁哪个门禁校验项 |
| `title` | string | ✓ | 人可读标题（如「T2 绿测：登录接口校验」） | 展示 |
| `source` | string | ✓ | 恒为 `'toolchain'` | 契约校验：非 toolchain 来源的证据非法 |
| `signer` | string | ✓ | 工具链身份 `ci-runner-01` | 签名者追溯 |
| `commitHash` | string | ✓ | 被验证代码的 commit 哈希（模拟环境由流程逻辑生成并标注 simulated） | 证据绑定代码版本 |
| `diffHash` | string | ✓ | 被验证 Diff 的哈希；G4 内必须等于该 Task 自己的 diff hash | 防「拿别的 Task 的绿证据解锁」 |
| `result` | string | ✓ | `'pass'` 或 `'fail'`（fail 时 `note` 给根因） | 门禁判定 |
| `ts` | number | ✓ | `Date.now()` | 时间线 |
| `ref` | `{uri,hash,sizeBytes}` | ✓ | 经 `putRef(state,'evidence/<id>.json', payload)` | 取回完整验证载荷 |
| `producedBy` | string | ✓ | `'toolSubmit'` 或 `'toolTaskAction'` | 接口来源审计 |

示例（G4 内 T2 的绿测证据）：

```json
{
  "id": "EV-007", "phase": "G4", "kind": "task", "taskId": "T2",
  "type": "green", "title": "T2 绿测：登录接口校验",
  "source": "toolchain", "signer": "ci-runner-01",
  "commitHash": "c4f19e2", "diffHash": "9bd3018", "result": "pass",
  "ts": 1762950120000,
  "ref": { "uri": "gk://inst-1101/evidence/EV-007.json", "hash": "77cc01af", "sizeBytes": 980 },
  "producedBy": "toolTaskAction"
}
```

### 3.3 执行凭证 receipt（schema：`gk.receipt/1`）

用途：每一步自动执行（含模拟）的完整凭证——人「执行追溯」页看到的下钻对象。
生成逻辑：`runStep` 执行步骤时构造，本体经 `putRef('receipt/<TR-id>.json', receipt)`
外置，trace 只留引用 + `receiptLite{who,step,outputs,result}` 摘要。`refs.traceId`
必须等于所属 trace 的 `id`（自引用校验）。

| 字段 | 怎么填 | 干什么用 |
| --- | --- | --- |
| `schema` | 恒 `'gk.receipt/1'` | 版本兼容 |
| `who` | `{id,name,kind,runtime,duty,simulated,stepSeq}`，取自该步 actor 的 ACTORS 登记；`simulated = actor!=='system'`；`stepSeq` 为该主体第几步 | 证明「谁干的」，模拟身份显式标注不冒充 |
| `when` | `{startedAt,endedAt,durationMs}`（毫秒时间戳） | 耗时度量 |
| `where` | `{round,phase,phaseName,taskId?,acIds?}` | 定位到哪轮哪阶段哪 Task |
| `what` | `{step,detail,fn}`：步骤名、说明、内部函数名 | 语义描述 |
| `method` | `{tool,operation,params,basis}`：用的什么工具、什么操作、参数、依据（如「依赖 T2 已签字」） | 可复现的执行方式 |
| `inputs` | 数组，每项 `{kind,label,source,count,items}`：如注入的记忆、加载的工件、读取的文件（source 标注来自外部存储） | 输入证据链 |
| `outputs` | 数组：本步产出的工件 / 证据 ID 摘要 | 输出证据链 |
| `note` | 额外说明（如越界警告） | 补充上下文 |
| `refs` | `{traceId,eventId,artifactIds,evidenceIds,memoryIds,filePaths,commitHash?,diffHash?}`：全部关联对象的 ID | 与事件日志 / 工件 / 证据互链 |
| `result` | `{status:'pass'\|'fail',message}` | 步骤结论 |
| `simulated` | `actor!=='system'` | 区分模拟执行与系统编排 |

### 3.4 其他留痕对象

- **事件 event**：`{id:'E-xxx', ts, actor, action, target, detail, extra?}`，只追加不修改（不可变审计轨迹）。
- **审批记录 approval**：`{phase, attempt, ok, skipped?, reason?, ts, durationMs}`。
  `attempt` 为该阶段第几次尝试（打回后 +1）；`skipped:true` 表示精简跳过（带 reason），
  度量口径（通过率 / 耗时）排除 skipped 记录。
- **项目记忆 memory**：`{id:'M-xxx', phase, category('约束'|'编码规范'|'历史教训'), text, status}`。
  生成：人打回 / 越界说明 / Review 意见时自动提炼为 `status:'candidate'`；
  人经 `gk.human.memory` 确认 → `'active'`（下轮 G0 注入执行凭证 inputs）或否决 → `'revoked'`。

### 3.5 权限事件矩阵（审计校验点）

| 事件 action | 只允许的 actor |
| --- | --- |
| `ARTIFACT_SUBMITTED` / `TEST_WRITTEN` / `DIFF_SUBMITTED` | ai |
| `EVIDENCE_SIGNED` / `SELFTEST_FAILED` | toolchain |
| `GATE_APPROVED` / `GATE_REJECTED` / `DIFF_REVIEWED` / `DIFF_REJECTED` / `HUMAN_ARBITRATION` / `OUT_OF_SCOPE_EXPLAINED` / `MEMORY_CONFIRMED` / `MEMORY_REVOKED` / `PHASE_SKIPPED` | human |
| `PERMISSION_DENIED` / `ESCALATED` / `ROUND_STARTED` / `ROUND_FINISHED` / `AUTO_STEP` 等 | system / 各自主体（见事件日志） |

## 4. 接口使用案例（逐接口实例）

以下按一次真实任务的推进顺序演示。`t` 为某任务流程实例状态（`LOGIC.createState` 的返回值），
所有调用都返回 `{ok, msg}`，`ok:false` 时不产生副作用。

### 4.1 准备阶段：G0 上下文 → G1 需求 → G2 方案 → G3 拆解

```js
// 系统开启一轮流程（ROUND_STARTED）后，授权 AI 提交 G0 产出：
L.aiSubmit(t, 'ai');            // → {ok:true} 登记 A-001 Context Brief（工件 + 模拟文件）
L.toolSubmit(t, 'toolchain');   // → {ok:true} 登记 EV-001 代码库索引快照（一致性扫描）
L.approve(t, 'human');          // → {ok:true} 人签署 G0 门禁，phaseIdx→G1 并自动授权后续

// 越权示例：AI 想替人签字 —— 被拒并留痕
L.approve(t, 'ai');             // → {ok:false, msg:'权限拒绝…'}，事件 PERMISSION_DENIED

// G1：AI 交 PRD → 工具链做需求一致性扫描 → 人批准
L.aiSubmit(t, 'ai');            // A-002 PRD
L.toolSubmit(t, 'toolchain');   // EV-002 需求一致性扫描 pass
L.approve(t, 'human');

// G2：现状分析 + 多方案 + Plan；人若不满意可打回（意见会成为候选记忆）
L.aiSubmit(t, 'ai'); L.toolSubmit(t, 'toolchain');
L.reject(t, 'human', '方案B成本更高，但更符合后续扩展，请按方案B重出Plan');
// → 清空 G2 产出，生成 M-001 候选记忆「历史教训」，授权自动重做；AI 重新 aiSubmit 后再批准

// G3：Task 清单（T1、T2 无依赖，T3 依赖 T2），人确认
L.aiSubmit(t, 'ai'); L.toolSubmit(t, 'toolchain'); L.approve(t, 'human');
```

### 4.2 实现循环 G4：红 → 绿 → 越界 → 逐 Task Review

```js
// T1 与 T2 依赖已满足（deps:[]）进入第一批；T3 依赖 T2，需等 T2 签字后才开工。
// —— AI 按 TDD 写测试（先红后实现）：
L.aiTaskAction(t, 'ai', 'test',  'T1');   // T1 测试代码工件
L.aiTaskAction(t, 'ai', 'impl',  'T1');   // T1 实现 + Diff（前置：红证据未就绪则 {ok:false}）
// —— 工具链按序验证，全部签名绑定 T1 自己的 commit/diff hash：
L.toolTaskAction(t, 'toolchain', 'red', 'T1');  // 红测证据（证明测试有效）
L.toolTaskAction(t, 'toolchain', 'green','T1'); // 绿测 + Lint（前置：红证据 + 实现已交）
L.toolTaskAction(t, 'toolchain', 'oos', 'T1');  // 越界检测：发现 diff 含 Plan 外文件 → 升级
// —— 越界改动必须人说明（不说明则门禁不通过）：
L.explainOutOfScope(t, 'human', 'src/legacy/bridge.js 是老接口适配，必须同步修改错误码', 'T1');
// —— 逐 Task 独立评审（签字 / 打回）：
L.reviewTask(t, 'human', 'ok', '', 'T1');       // T1 签字，解锁 T3 的依赖
L.reviewTask(t, 'human', 'no', '错误码映射有遗漏，重写', 'T2');  // T2 打回 → 复位重跑，生成候选记忆

// T2 连续失败 3 次（FAIL_LIMIT）→ 熔断 ESCALATED，人裁决放行重试：
L.arbitrate(t, 'human', 'T2');            // 解冻，授权按打回意见重做

// 全部 Task 签完后批准 G4 门禁（autoCheck 要求：全签 + 无未说明越界 + 无熔断）
L.approve(t, 'human');
```

### 4.3 交付阶段：G5 验证 → G6 评审 → G7 测试 → G8 发布

```js
// G5：全量回归 + 覆盖率；G6：AI 预审清单 + 人批准合入；G7：AC 用例矩阵；G8：发布签署
for (const _ of [5, 6, 7]) {            // 每阶段都是同一节奏：
  L.aiSubmit(t, 'ai');                  //   AI 交阶段产出（验证报告草稿 / 预审清单 / 用例矩阵）
  L.toolSubmit(t, 'toolchain');         //   工具链签名（回归 / 静态复核 / 用例执行）
  L.approve(t, 'human');                //   人批准
}
// G8 发布门禁后工具链做构建产物校验（build），人签署发布单
L.toolSubmit(t, 'toolchain'); L.approve(t, 'human');
```

### 4.4 运行改进：G9 精简跳过 → G10 记忆回流

```js
// 普通改代码任务不需要运维 —— 人确认精简跳过（留痕，不影响 11 道门禁口径）：
L.skipPhase(t, 'human', '普通改代码任务，不需要运维动作');
// → G9 门禁记 {skipped:true, reason}，事件 PHASE_SKIPPED，直接进入 G10

// G10：AI 归纳本轮人的修正意见为候选记忆，人逐条确认 / 否决：
L.aiSubmit(t, 'ai');   // 候选记忆 M-001「约束」、M-002「历史教训」…
L.confirmMemory(t, 'M-001', 'human');   // 入库 active：下一轮 G0 自动注入
L.revokeMemory(t, 'M-002', 'human');    // 否决 revoked：留痕但不生效
L.approve(t, 'human');                  // G0–G10 闭环（ROUND_FINISHED），可开启下一轮
```

### 4.5 防御性校验（接口测试套件持续验证）

```js
// 每个接口用错误主体调用必须 {ok:false} 并写 PERMISSION_DENIED：
L.toolSubmit(t, 'ai');                       // AI 冒充工具链签名 → 拒绝
L.aiSubmit(t, 'toolchain');                  // 工具链冒充 AI 提交 → 拒绝
L.skipPhase(t, 'ai');                        // AI 想精简跳过 → 拒绝（跳过是人的判断）
L.reviewTask(t, 'ai', 'ok', '', 'T1');       // AI 想给自己签字 → 拒绝
// 门禁引擎只认工具链签名证据：AI 的 selfReport 不解锁任何校验项
```

## 5. 发布验证

1. `node selftest.js` —— 全部断言通过；其中 **I 段 = 接口规范测试套件**，覆盖：
   - `INTERFACES` 登记表与 `spec.md` 一致（接口 ID / 函数名 / caller 逐条存在且可调用）；
   - 越权调用被拒绝并留痕（每个接口用错误主体调用必须 `{ok:false}` + `PERMISSION_DENIED`）；
   - 数据契约：全部工件 / 证据 / 凭证字段齐备，凭证 schema = `gk.receipt/1`，`simulated` 标注正确；
   - 权限事件矩阵：事件日志中各 action 的 actor 与 §3.5 一致；
   - 精简跳过（`gk.human.skip`）行为与留痕正确。
2. 接口或契约变更时：先改 `INTERFACES` 表 → 同步改本文件 → 跑 selftest → 再发布。
