/* Gatekeeper 原型自检：用 Node 直接跑纯逻辑层 + 极简 DOM 桩
   运行：node selftest.js
   覆盖：G0–G10 闭环、权限硬约束、TDD 顺序、越界/熔断、记忆回流、
        触发后自动执行过程与事件日志、多任务种子与实例隔离、
        总览页 / 进入 / 返回 / 三分区动作隔离、
        批准 = 授权下一步（无冗余触发）、执行授权单内容、异常恢复兜底、
        每步执行凭证（主体 / 时间 / 输入 / 加载方式 / 输出 / 关联）、模拟文件与评审跳转、事件日志全量 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const logicFile = path.join(__dirname, 'gatekeeper', 'js', 'logic.js');
const uiFile = path.join(__dirname, 'gatekeeper', 'js', 'ui.js');
const storeFile = path.join(__dirname, 'gatekeeper', 'js', 'storage.js');
const logicCode = fs.readFileSync(logicFile, 'utf8');
const storeCode = fs.readFileSync(storeFile, 'utf8');

// 语法检查：全部前端脚本 + 自检脚本本身
const uiCode = fs.readFileSync(uiFile, 'utf8');
[storeCode, logicCode, uiCode, fs.readFileSync(path.join(__dirname, 'selftest.js'), 'utf8')].forEach((code, i) =>
  new vm.Script(code, { filename: 'script-' + i + '.js' }));
console.log('[语法] storage.js / logic.js / ui.js / selftest.js 编译通过');

// storage.js 必须先于 logic.js 载入：logic 通过 GKSTORE 把内容本体写入外部存储
const L = vm.runInNewContext(storeCode + '\n;' + logicCode + '\n;LOGIC', { console });
let pass = 0;
function ok(cond, label) {
  if (!cond) { console.error('  ✗ 失败：' + label); process.exitCode = 1; throw new Error(label); }
  pass++; console.log('  ✓ ' + label);
}
/* 凭证 / 工件数据 / 文件内容均已外置：测试时按引用取回内容本体 */
const R = t => L.getReceipt(t);
function runPlan(s, label) {
  const plan = L.buildRunPlan(s);
  ok(plan.length > 0, label + ' 生成自动执行计划（' + plan.length + ' 步）');
  plan.forEach(st => L.runStep(s, st));
  return plan;
}
function phase(s, id) {
  ok(L.cur(s).id === id, '当前阶段 ' + id);
  runPlan(s, id);
  ok(L.autoCheck(s).passed, id + ' 自动执行后校验解锁');
  ok(L.approve(s, 'human').ok, id + ' 人签署放行');
}

console.log('\n--- A0. 多任务种子数据（真实推进生成，非写死状态） ---');
const seed = L.createSeedRoot();
ok(seed.version === 2 && seed.instances.length === 8, '种子含 8 个开发任务实例（7 个 + 1 个派生任务）');
ok(seed.instances.some(i => i.state.finishedAt), '含已闭环任务');
ok(seed.instances.filter(i => !i.state.finishedAt).length >= 4, '含多个进行中任务');
ok(new Set(seed.instances.map(i => i.state.phaseIdx)).size >= 4, '任务分布在不同阶段');
seed.instances.forEach(i => {
  ok(i.state.artifacts.length > 0 && i.state.evidences.length > 0 && i.state.events.length > 0,
    i.id + ' 状态由真实流程推进生成（工件 / 证据 / 事件齐备）');
  ok(i.state.approvals.length === i.state.phaseIdx, i.id + ' 已签门禁数与阶段位置一致');
});
ok(new Set(seed.instances.map(i => i.id)).size === 8, '实例 ID 唯一');
ok(new Set(seed.instances.map(i => i.state)).size === 8, '各实例持有相互独立的 state 对象');
ok(seed.instances.some(i => i.state.reviewNotes.length > 0), '含真实打回历史的任务');
ok(seed.instances.some(i => i.state.tasks && i.state.tasks.some(t => i.state.escalated[t.id])), '含失败熔断待裁决的任务');
ok(seed.instances.some(i => i.state.memories.some(m => m.status === 'candidate')), '含候选记忆待确认的任务');
ok(seed.instances.some(i => i.state.round === 2 && L.activeMemory(i.state).length > 0),
  '含第 2 轮派生任务：G10 确认记忆后新建任务，G0 加载了生效项目记忆');
// 派生任务与源任务是**两个独立实例**，不是同一个 ID 换 state
const derived=seed.instances.find(i => i.state.round === 2);
const source=seed.instances.find(i => i.id === 'TASK-0977');
ok(derived && derived.id !== source.id, '派生任务有独立的新 ID（不是同一任务重置）');
ok(derived.state.parentTaskId === 'TASK-0977', '派生任务记录了血缘：派生自 TASK-0977');
ok(source.state.finishedAt && source.state.phaseIdx === 11, '源任务保持已闭环留档（第 1 轮 11 道门禁完整）');
ok(source.state.artifacts.length > 0 && source.state.evidences.length > 0 && source.state.events.length > 0,
  '源任务的历史工件 / 证据 / 事件日志未被覆盖丢失');
ok(source.state.round === 1 && derived.state.round === 2, '轮次编号：源任务第 1 轮，派生任务第 2 轮');
ok(source.derivedTasks && source.derivedTasks.indexOf(derived.id) >= 0, '源任务记录了派生了谁（双向可反查）');
ok(derived.state.memories.length > 0 && derived.state.memories.every(m => m.status === 'active'),
  '派生任务继承的是已入库的生效记忆');

console.log('\n--- A1. 执行授权单数据源（只读预览，不改状态） ---');
ok(L.PHASES.length===11 && L.PHASES.every(p=>p.todo.length&&p.criteria.length),
  'G0–G10 每个阶段都有「要做的事」与「通过标准」');
{
  const a=L.createState(1,[]), before=JSON.stringify(a);
  const pv=L.previewNextRun(a);
  ok(pv.length>0, 'G0 签字前可预览 G1 的自动执行步骤（'+pv.length+' 步）');
  ok(pv.some(x=>x.actor==='ai')&&pv.some(x=>x.actor==='toolchain'), '预览区分 AI / 工具链主体');
  ok(JSON.stringify(a)===before, 'previewNextRun 绝不修改状态（含事件日志）');
  const last=L.createState(1,[]); last.phaseIdx=10;
  ok(L.previewNextRun(last).length===0, 'G10 最后一道门禁之后没有下一阶段计划');
  // G4 内层预览：批次语义下，签字后启动的是「下一个批次」。
  // TASK-1051 停在 T2 熔断态：T1 仍可开工（熔断一个 Task 不阻塞同批的另一个），T3 因依赖 T2 被阻塞。
  const g4=seed.instances.find(i=>i.id==='TASK-1051').state, keep=g4.taskIdx;
  const tp=L.previewNextTaskRun(g4);
  ok(L.cur(g4).id==='G4' && L.readyBatch(g4).map(t=>t.id).join(',')==='T1',
    'T2 熔断时同批的 T1 仍可开工（一个 Task 熔断不阻塞另一个）');
  ok(L.readyBatch(g4).map(t=>t.id).indexOf('T3')<0, '依赖 T2 的 T3 仍被阻塞');
  ok(tp.length>0, 'G4 签字前可预览下一批次的执行步骤（'+tp.length+' 步）');
  ok(g4.taskIdx===keep, 'previewNextTaskRun 不改动当前 Task 指针');
  // 用一个干净的 G4 状态验证：可预览下一批次的 TDD 步骤
  const g4b=L.createState(1,[]);
  for(let i=0;i<4;i++){ L.buildRunPlan(g4b).forEach(st=>L.runStep(g4b,st)); L.approve(g4b,'human'); }
  ok(L.cur(g4b).id==='G4', '干净状态推进到 G4');
  const tp2=L.previewNextTaskRun(g4b);
  ok(tp2.length>0 && tp2.some(x=>x.fn==='aiTest'), 'G4 签字前可预览下一批次的 TDD 步骤');
}

console.log('\n--- A2. 每一步执行凭证：谁 / 何时 / 输入 / 如何加载 / 输出 / 关联 ---');
let allTr = [];
seed.instances.forEach(i => allTr = allTr.concat(i.state.traces));
ok(allTr.length > 200, '种子共 ' + allTr.length + ' 步 AI / 工具链 / 系统自动执行');
ok(allTr.every(t => L.receiptOk(t)), '全部 ' + allTr.length + ' 步都带完整凭证，可追溯覆盖率 100%');
ok(allTr.every(t => t.receiptRef && t.receiptRef.uri && t.receiptRef.hash), '全部凭证都持有外部存储引用（uri / hash）');
ok(allTr.every(t => { const r = R(t); return r && r.who.id && r.who.name && r.when.startedAt &&
  r.where.phase && r.inputs.length && r.method.tool && r.refs.traceId === t.id; }),
  '凭证字段齐全：主体身份 / 起止时间 / 阶段 / 输入 / 执行方式 / 自引用 ID');
ok(allTr.every(t => R(t).who.simulated === (t.actor !== 'system')), '外部执行主体明确标注「演示模拟」，不冒充真实接入');
ok(allTr.every(t => Array.isArray(R(t).outputs)), '每步都显式记录输出（无产出时也留痕，不遗漏）');
seed.instances.forEach(i => {
  ok(i.state.traces.every(t => i.state.events.some(e => e.id === R(t).refs.eventId && e.traceId === t.id)),
    i.id + ' 每步凭证可反查到事件日志');
});
{
  // 第 2 轮现在是一个**派生任务**（独立 ID），不再是 TASK-0977 原地换 state
  const r2 = seed.instances.find(i => i.state.round === 2).state;
  const load = r2.traces.find(t => t.step === '加载上下文' &&
    R(t).inputs.some(x => x.kind === 'project_memory' && x.count > 0));
  ok(!!load, '第 2 轮 G0 存在真实的项目记忆加载步骤');
  const pm = R(load).inputs.find(x => x.kind === 'project_memory');
  ok(pm.items.length === L.activeMemory(r2).length, '凭证条目数 == 实际生效记忆数');
  ok(pm.items.every(m => m.id && m.text && m.category && m.source && m.scope && m.status !== undefined),
    '每条项目记忆可查：ID / 文本 / 分类 / 来源 / 范围 / 状态 / 命中 / 轮次');
  ok(JSON.stringify(pm.items.map(m => m.text)) ===
     JSON.stringify(L.artData(r2.artifacts.find(a => a.phase === 'G0'))['已加载项目记忆']),
    '凭证条目与 Context Brief 实际注入内容逐字一致（真实取证，非编造）');
  ok(!!(pm.selector && pm.orderBy && pm.injectedInto && R(load).method.basis),
    '如何加载可查：过滤条件 / 排序 / 注入目标 / 文档依据');
  ok(pm.categories.length === 3 && pm.categories.some(c => c.loaded === 0),
    '项目记忆分类按文档 2.3 G0 分三类，未接入的两类如实标 0 条，不伪造条目');
  ok(R(load).who.id === L.ACTORS.ai.id && R(load).when.durationMs > 0,
    '可查「什么 AI」（agent-ai-01）与「什么时候」（起止时间 + 耗时）');
}

console.log('\n--- A3. 每份工件都登记了可点开的模拟文件 ---');
let allArt = [];
seed.instances.forEach(i => allArt = allArt.concat(i.state.artifacts));
ok(allArt.length > 0 && allArt.every(a => a.file && a.file.path && a.file.ref && a.file.ref.uri && L.fileContent(a) && a.file.hash),
  '全部 ' + allArt.length + ' 份工件均登记模拟文件（路径 / 外部引用 / 可取回内容 / 哈希）');
ok(allArt.every(a => a.file.simulated === true && a.file.generatedFrom === 'artifact:' + a.id),
  '文件明确标注「演示模拟」并登记生成来源，不冒充真实仓库文件');
const prdArt = allArt.find(a => a.phase === 'G1');
ok(prdArt && prdArt.file.path.indexOf('PRD') >= 0 && L.fileContent(prdArt).indexOf('验收标准') >= 0,
  'PRD 模拟文件路径可读，正文含评审所需章节');
ok(allArt.filter(a => a.producedBy).every(a => a.file.producedBy === a.producedBy),
  '文件与工件可反查到同一个产生步骤');
ok(typeof L.buildFile === 'function' && L.fileContent(prdArt).length > 100,
  '文件正文由工件结构化数据展开生成，经存储插件可重复取回');

console.log('\n--- A3+. 内容外置（引用化）：系统状态只放引用，本体在存储插件 ---');
{
  const rootJson = JSON.stringify(seed);
  ok(rootJson.indexOf('"data":') < 0 && rootJson.indexOf('"content":') < 0 && rootJson.indexOf('"receipt":') < 0,
    '整棵状态树里不存在 data / content / receipt 内容本体字段');
  ok(allArt.every(a => a.ref && /^gk:\/\/[^/]+\/artifact\//.test(a.ref.uri) && a.ref.hash), '工件数据以 gk://<实例>/artifact/ 引用登记（实例命名空间隔离）');
  ok(seed.instances.every(i => i.state.evidences.every(e => e.ref && /^gk:\/\/[^/]+\/evidence\//.test(e.ref.uri))), '证据载荷以 gk://<实例>/evidence/ 引用登记');
  ok(new Set(seed.instances.map(i => i.state.ns)).size === 8, '各实例使用独立命名空间，内容互不覆盖');
  const st = seed.instances[0].state;
  const a0 = st.artifacts[0], e0 = st.evidences[0], t0 = st.traces[0];
  ok(typeof L.artData(a0) === 'object' && L.artData(a0) !== null, '工件引用可同步取回结构化数据');
  ok(typeof L.evData(e0) === 'object', '证据引用可同步取回载荷');
  ok(R(t0).schema === 'gk.receipt/1', '凭证引用可同步取回完整凭证');
  ok(L.artData(a0).constructor === Object || typeof L.artData(a0) === 'object', '引用化后读取不影响流程逻辑');
  // 存储插件接口
  ok(typeof L.STORE.put === 'function' && typeof L.STORE.read === 'function' && typeof L.STORE.registerPlugin === 'function',
    'GKSTORE 插件层提供 put / read / registerPlugin 标准接口');
  ok(L.STORE.plugins().some(p => p.id === 'virtual-fs'), '默认虚拟内容仓插件已注册');
  const stats = L.STORE.stats();
  ok(stats.count > 0 && stats.bytes > 0, '外部存储已承载 ' + stats.count + ' 条内容 / ' + stats.bytes + ' bytes');
  // 第三方插件只需实现契约即可接入
  const custom = {id:'custom-test', name:'自定义外部仓', sync:true, status:()=>({ok:true,desc:'test'}),
    put:(p,c)=>{custom._d[p]=c; return {hash:'x', sizeBytes:c.length};},
    get:p=>custom._d[p]===undefined?null:custom._d[p],
    read:p=>Promise.resolve(custom._d[p]===undefined?null:custom._d[p]),
    remove:p=>{delete custom._d[p];}, list:()=>Object.keys(custom._d).map(k=>({path:k})), _d:{}};
  L.STORE.registerPlugin(custom);
  ok(L.STORE.plugins().some(p => p.id === 'custom-test'), '第三方插件实现契约即可注册接入');
  const r = L.STORE.put('test/hello.json', {hello:'world'});
  ok(r.uri === 'gk://test/hello.json' && r.hash && r.sizeBytes > 0, 'put 返回标准引用 {uri, hash, sizeBytes}');
  ok(JSON.parse(L.STORE.get(r.uri)).hello === 'world', 'get 按 uri 取回内容');
  L.STORE.setActive('virtual-fs');
  ok(L.STORE.active().id === 'virtual-fs', '可切换当前存储插件（升级只换插件，引用格式不变）');
  // 旧存档迁移：手工构造 v1 旧存档（内容内联）→ externalizeState 搬进外部存储换成引用
  const legacy = {artifacts:[{id:'A-TEST',phase:'G1',kind:'ai',title:'旧 PRD',version:1,hash:'old',
      data:{目标:'内联旧数据'}, file:{path:'docs/prd/PRD.md',content:'# 内联旧文件内容',hash:'f0'}}],
    evidences:[{id:'V-TEST',phase:'G1',kind:'stage',title:'旧证据',result:'PASS',data:{结果:'PASS'}}],
    traces:[{id:'TR-TEST',step:'s',actor:'ai',receipt:{schema:'gk.receipt/1',who:{id:'x'},when:{startedAt:1,endedAt:2},where:{phase:'G1'},what:{step:'s'},
      method:{tool:'t'},outputs:[],inputs:[{kind:'k',items:[1]}],refs:{traceId:'TR-TEST',eventId:'E-1'},result:{status:'done'}}}]};
  const fixed = L.externalizeState(legacy);
  ok(fixed.artifacts[0].data === undefined && fixed.artifacts[0].ref.uri.indexOf('gk://') === 0,
    'externalizeState 把旧存档工件数据搬进外部存储，状态里换成引用');
  ok(fixed.artifacts[0].file.content === undefined && /gk:\/\/[^/]*\/?file\//.test(fixed.artifacts[0].file.ref.uri),
    '旧存档模拟文件内容同样引用化');
  ok(fixed.evidences[0].data === undefined && /^gk:\/\/[^/]*\/?evidence\//.test(fixed.evidences[0].ref.uri), '旧存档证据载荷同样引用化');
  ok(fixed.traces[0].receipt === undefined && /gk:\/\/[^/]*\/?receipt\//.test(fixed.traces[0].receiptRef.uri), '旧存档凭证同样引用化');
  ok(JSON.stringify(L.artData(fixed.artifacts[0])) === '{"目标":"内联旧数据"}' && L.fileContent(fixed.artifacts[0]) === '# 内联旧文件内容',
    '迁移后经引用取回的内容与原内容逐字一致（不丢内容）');
  ok(L.receiptOk(fixed.traces[0]), '迁移后的凭证仍通过完整性校验');
  L.externalizeState(fixed);
  ok(fixed.artifacts[0].ref && fixed.artifacts[0].data === undefined, '迁移幂等，重复执行不产生副作用');
}

console.log('\n--- A. 权限与门禁硬约束 ---');
let s = L.createState(1, []);
ok(L.cur(s).id === 'G0', '初始停在 G0');
ok(!L.approve(s, 'ai').ok, 'AI Agent 调用 approve 被拒绝');
ok(!L.approve(s, 'toolchain').ok, '工具链调用 approve 被拒绝');
ok(!L.approve(s, 'human').ok, '校验未通过时人也无法批准');
ok(s.events.some(e => e.action === 'PERMISSION_DENIED'), '权限拒绝写入审计日志');
ok(!L.reject(s, 'ai', 'x').ok, 'AI 无权打回');
ok(!L.aiSubmit(s, 'human').ok, '人不能代 AI 提交阶段产出');
ok(!L.toolSubmit(s, 'ai').ok, 'AI 不能自己签发工具链证据');
ok(L.toolSubmit(s, 'toolchain').ok, '工具链签名回传 G0 证据');
ok(!L.autoCheck(s).passed, '只有证据、没有 AI 工件时门禁仍锁定');
ok(!L.aiTaskAction(s, 'human', 'test').ok, '人不能代 AI 写测试');
ok(!L.toolTaskAction(s, 'ai', 'red').ok, 'AI 不能代工具链回传测试');

console.log('\n--- B. 准备阶段 G0–G3 + G1 打回返工 ---');
s = L.createState(1, []);
phase(s, 'G0');
runPlan(s, 'G1');
ok(!L.reject(s, 'human', '').ok, '打回意见为空被拒绝');
ok(L.reject(s, 'human', '验收标准缺少可测试判据').ok, 'G1 被人工打回');
ok(s.reworks === 1 && s.reviewNotes.length === 1, '返工与修正意见已记录');
ok(s.memories.some(m => m.status === 'candidate'), '打回自动生成候选记忆');
ok(!L.autoCheck(s).passed, '打回后门禁重新锁定');
runPlan(s, 'G1（重做）');
ok(L.autoCheck(s).passed, 'G1 重新解锁');
ok(L.approve(s, 'human').ok, 'G1 第 2 次提交才通过');
ok(s.approvals[1].attempt === 2, '门禁提交次数被记录');
phase(s, 'G2');
phase(s, 'G3');
ok(s.tasks.length === 3, 'G3 产出 3 个可独立验证的 Task');

console.log('\n--- B2. G4 门禁整体打回：必须真的能重跑，而不是空操作 ---');
{
  const gs=L.createState(1,[]);
  let guard=0;
  while(L.cur(gs) && L.cur(gs).id!=='G4' && guard++<8){
    L.buildRunPlan(gs).forEach(x=>L.runStep(gs,x));
    ok(L.approve(gs,'human').ok, '构造：'+L.cur(gs).id+' 门禁签署并进入下一阶段');
  }
  ok(L.cur(gs).id==='G4' && gs.tasks.length===3, '构造完成：进入 G4，含 3 个 Task');
  let tg=0;
  while(L.currentTask(gs) && tg++<5){
    const t=L.currentTask(gs);
    L.buildRunPlan(gs).forEach(x=>L.runStep(gs,x));
    const o=gs.outOfScope[t.id];
    if(o&&o.files.length&&!o.explanation) L.explainOutOfScope(gs,'human','遗留耦合模块需同步修正错误码映射');
    L.reviewTask(gs,'human','ok','');
  }
  ok(L.autoCheck(gs).passed, '三个 Task 全部签字，G4 门禁解锁');
  ok(L.buildRunPlan(gs).length===0, '全部签字后确实没有待自动执行动作');
  ok(L.reject(gs,'human','整体方案与验收标准仍有偏差').ok, 'G4 门禁被整体打回');
  ok(gs.taskIdx===0 && gs.tasks.every(t=>gs.taskStep[t.id].review==='pending'), '打回后 3 个 Task 复位待重新实现与 Review');
  ok(!gs.evidences.some(e=>e.phase==='G4'&&e.kind==='task'), '打回后旧的工具链 Task 证据被清除');
  ok(L.buildRunPlan(gs).length>0, '打回后重新生成 TDD 执行计划，自动重跑不是空操作');
  ok(!L.autoCheck(gs).passed, '打回后 G4 门禁重新锁定');
}

console.log('\n--- C. G4 自动执行：批次并发 + TDD 顺序 / 越界 / 熔断 / 独立评审 ---');
ok(L.cur(s).id === 'G4', '进入 G4 实现循环');
// 批次并发：T1 与 T2 依赖为空且文件不重叠 → 同批并行；T3 依赖 T2 → 被阻塞
ok(L.readyBatch(s).map(t=>t.id).join(',') === 'T1,T2',
  '可并行批次 = T1,T2（依赖已满足 + 文件范围不重叠）');
ok(L.depsSatisfied(s, L.taskById(s,'T3')) === false, 'T3 依赖 T2，依赖未满足时被阻塞');
const planT1 = L.buildRunPlan(s);
const t1steps = planT1.filter(st => st.taskId === 'T1');
const t2steps = planT1.filter(st => st.taskId === 'T2');
ok(t1steps.length > 0 && t2steps.length > 0, '同一批次内 T1 与 T2 都有执行步骤（真并发，非串行）');
const idx = (arr,k) => arr.findIndex(st => st.fn === k);
ok(idx(t1steps,'aiTest') >= 0 && idx(t1steps,'aiTest') < idx(t1steps,'toolRed'), 'T1 链内：AI 先写测试早于工具链回红');
ok(idx(t1steps,'toolRed') < idx(t1steps,'aiImpl'), 'T1 链内：红阶段证据早于 AI 写实现');
ok(idx(t1steps,'aiImpl') < idx(t1steps,'toolGreen'), 'T1 链内：AI 写实现早于工具链回绿');
ok(idx(t2steps,'aiTest') >= 0 && idx(t2steps,'aiTest') < idx(t2steps,'toolRed'), 'T2 链内 TDD 顺序同样成立');
// 交错证明：两条链交替出现，而不是一整条跑完再跑另一条
const ids = planT1.map(st => st.taskId);
ok(ids.indexOf('T2') < ids.lastIndexOf('T1'), '批次内两链交错推进（并行而非串行）');
ok(planT1.some(st => st.actor === 'ai') && planT1.some(st => st.actor === 'toolchain'), '计划明确区分 AI 与工具链主体');
const HUMAN_ACTS = ['approve','reject','review','arbitrate','confirmMemory','revokeMemory','explainOutOfScope','nextRound'];
ok(planT1.every(st => !HUMAN_ACTS.includes(st.fn)), '自动执行计划不含任何人的审批 / 裁决动作');
planT1.forEach(st => L.runStep(s, st));
ok(s.artifacts.some(a => a.type === 'test_code'), '先写测试的工件存在');
ok(s.evidences.some(e => e.type === 'verify_red' && e.result.indexOf('FAIL') === 0), '存在「红」阶段证据');
ok(s.evidences.some(e => e.type === 'verify_green'), '存在「绿」阶段工具链签名证据');
// 每个 Task 的证据各自绑定自己的 diffHash（并行下证据仍可归属）
const t1green = s.evidences.find(e => e.taskId === 'T1' && e.type === 'verify_green');
const t2green = s.evidences.find(e => e.taskId === 'T2' && e.type === 'verify_green');
ok(t1green && t2green && t1green.diffHash !== t2green.diffHash,
  '并发 Task 的绿测证据分别绑定各自的 diffHash（可归属到具体 Task）');
ok(!L.reviewTask(s, 'ai', 'ok', '').ok, 'AI 无权 Review Diff');
ok(L.reviewTask(s, 'ai', 'ok', '', 'T2').ok === false, 'AI 无权 Review 指定 Task');

// 独立评审：可以先签 T2，不必等 T1 —— 评审单位是单个 Task
// （T2 有越界改动，按门禁设计必须先人工说明才能签字 —— 该约束在独立评审下依然生效）
ok(s.outOfScope.T2.files.length === 1, 'T2 越界检测命中 src/legacy/bridge.js');
ok(!L.reviewTask(s, 'human', 'ok', '', 'T2').ok, '越界未说明时 Review 被阻断');
ok(!L.explainOutOfScope(s, 'human', '', 'T2').ok, '空说明被拒绝');
ok(!L.explainOutOfScope(s, 'ai', 'x', 'T2').ok, 'AI 无权填写越界说明');
ok(L.explainOutOfScope(s, 'human', '遗留耦合模块需同步修正错误码映射', 'T2').ok, '人填写越界说明并留痕');
ok(L.reviewTask(s, 'human', 'ok', '', 'T2').ok, 'T2 Diff 由人独立签字（不必等 T1）');
ok(s.taskStep.T2.review === 'ok' && s.taskStep.T1.review === 'pending',
  'T2 已签字而 T1 仍待签 —— 评审互不阻塞');
ok(L.reviewTask(s, 'human', 'ok', '', 'T1').ok, 'T1 Review 通过');
ok(L.allTasksReviewed(s) === false, 'T3 未签字时 G4 门禁仍未解锁');

// T3 依赖 T2 —— T2 已签字后 T3 才可开工
ok(L.readyBatch(s).map(t=>t.id).join(',') === 'T3', 'T2 签字后 T3 依赖满足，进入下一批次');
L.simulateFail(s, 'toolchain', 'T3'); L.simulateFail(s, 'toolchain', 'T3'); L.simulateFail(s, 'toolchain', 'T3');
ok(s.escalated.T3 === true, '自测失败 3 次触发失败即停熔断');
ok(L.buildRunPlan(s).length === 0, '熔断后系统不再自动生成执行计划');
ok(!L.arbitrate(s, 'ai', 'T3').ok, 'AI 无权裁决异常');
ok(L.arbitrate(s, 'human', 'T3').ok && !s.escalated.T3, '人裁决后熔断解除');
runPlan(s, 'T3');
ok(L.reviewTask(s, 'human', 'ok', '', 'T3').ok, 'T3 Diff 由人签字');
ok(L.allTasksReviewed(s), '三个 Task 全部签字');
ok(L.autoCheck(s).passed, 'G4 四项自动校验全部通过');
ok(L.approve(s, 'human').ok, 'G4 门禁放行');

console.log('\n--- D. 交付与复盘 G5–G10 ---');
['G5', 'G6', 'G7', 'G8', 'G9'].forEach(p => phase(s, p));
runPlan(s, 'G10');
ok(!L.autoCheck(s).passed, 'G10 候选记忆未确认时门禁锁定');
const pending = s.memories.filter(m => m.status === 'candidate');
ok(pending.length >= 1, '待确认候选规则 ' + pending.length + ' 条');
ok(new Set(pending.map(m=>m.text)).size===pending.length, '打回生成的规则与 G10 归纳按文本去重，不再重复沉淀');
ok(!L.confirmMemory(s, pending[0].id, 'ai').ok, 'AI 无权确认记忆入库');
pending.forEach(m => L.confirmMemory(s, m.id, 'human'));
ok(L.autoCheck(s).passed, '全部候选规则经人确认后 G10 解锁');
ok(L.approve(s, 'human').ok, 'G10 门禁放行，闭环完成');
ok(!!s.finishedAt && s.approvals.length === 11, '11 道门禁全部签署');

console.log('\n--- E. 自动执行过程与事件日志 ---');
ok(s.traces.length > 20, '生成 ' + s.traces.length + ' 条 AI 执行过程记录');
ok(s.traces.some(t => t.actor === 'ai') && s.traces.some(t => t.actor === 'toolchain'), '执行过程区分 AI 与工具链主体');
ok(s.traces.every(t => t.step && t.detail && t.durationMs > 0), '每条过程含步骤名、描述与模拟耗时');
const autoEvents = s.events.filter(e => e.action === 'AUTO_STEP').length;
ok(autoEvents === s.traces.length, '每一步执行都写入事件日志（' + autoEvents + ' 条）');

console.log('\n--- E2. 打回后自动重跑 G10 不产生重复候选记忆 ---');
{
  const g=L.createState(1,[]); g.phaseIdx=10;
  L.buildRunPlan(g).forEach(x=>L.runStep(g,x));
  ok(g.memories.filter(m=>m.status==='candidate').length>0, 'G10 归纳生成候选记忆');
  ok(L.reject(g,'human','复盘结论缺少可追溯证据').ok, 'G10 门禁被打回（新链路会自动重跑）');
  L.buildRunPlan(g).forEach(x=>L.runStep(g,x));
  const texts=g.memories.filter(m=>m.status==='candidate').map(m=>m.text);
  ok(new Set(texts).size===texts.length, '重跑 G10 后候选记忆按文本去重，无重复条目');
}

console.log('\n--- F. 闭环后新建下一轮任务（不是重置当前任务）+ 经验回流 ---');
// 核心语义：下一轮是**一个新任务实例**，源任务原样留档。
// 《输出文档》2.1「项目记忆持久化，跨任务复用」—— 记忆跨任务，载体也该跨任务。
const active = L.activeMemory(s).length;
const srcSnapshot = JSON.stringify(s);
const rootF = { version:2, nextId:9001, instances:[], activeId:null };
const srcInst = { id:'TASK-9000', name:'源任务', desc:'', owner:'我', createdAt:Date.now(), state:s };
rootF.instances.push(srcInst);
const rF = L.createNextTask(rootF, srcInst, 'human');
ok(rF.ok, '闭环后可新建下一轮任务');
ok(rF.instance.id === 'TASK-9001', '新任务分配了独立的新 ID（TASK-9001）');
ok(rF.instance.id !== srcInst.id, '新任务与源任务是两个不同任务，不是同一个 ID 换状态');
ok(rootF.instances.length === 1, 'createNextTask 只返回新实例，不自动塞进列表（由调用方决定是否加入）');
ok(rF.instance.state.round === 2 && L.cur(rF.instance.state).id === 'G0', '新任务从 G0 开始');
ok(L.activeMemory(rF.instance.state).length === active && active > 0, active + ' 条生效记忆跨任务继承');
ok(rF.instance.state.parentTaskId === 'TASK-9000', '新任务记录血缘：派生自 TASK-9000');
ok(srcInst.derivedTasks && srcInst.derivedTasks.indexOf('TASK-9001') >= 0, '源任务记录了派生了谁（双向可反查）');
ok(rF.instance.state.events.some(e => e.action === 'MEMORY_INJECTED'), '记忆注入已写入新任务的事件日志');
ok(rF.instance.state.events.some(e => e.action === 'TASK_DERIVED'), '派生关系写入事件日志');
// 源任务必须原样不动：历史工件 / 证据 / 审批 / 事件都不能被覆盖
ok(JSON.stringify(s) === srcSnapshot, '源任务状态完全未被修改（历史工件 / 证据 / 审批 / 事件全部留档）');
// 新任务 G0 真实加载继承的记忆
const s2 = rF.instance.state;
runPlan(s2, '新任务 G0');
const brief = s2.artifacts.find(a => a.title.indexOf('Context Brief') === 0);
ok(brief && L.artData(brief)['已加载项目记忆'].length === active, '新任务 Context Brief 携带了源任务沉淀的约束');
const loadTr = s2.traces.find(t => t.step === '加载上下文' &&
  L.getReceipt(t).inputs.some(x => x.kind === 'project_memory' && x.count > 0));
ok(!!loadTr, '新任务 G0 有真实的项目记忆加载步骤（凭证可查）');
// 默认命名规则：源任务名已带「· 第 N 轮」时不再叠加，否则出现「第 1 轮 · 第 2 轮」
ok(rF.instance.name.indexOf('第 1 轮 · 第 2 轮')<0, '默认任务名不重复叠加轮次标记');
const rootF2={version:2,nextId:9101,instances:[],activeId:null};
const src2={id:'TASK-9100',name:'优惠券核销接口改造',desc:'',owner:'我',createdAt:Date.now(),state:s};
const rF2=L.createNextTask(rootF2,src2,'human');
ok(rF2.instance.name === '优惠券核销接口改造 · 第 2 轮', '源任务名无轮次标记时补上轮次：'+rF2.instance.name);
const rF3=L.createNextTask(rootF2,src2,'human',{name:'自定义任务名'});
ok(rF3.instance.name === '自定义任务名', '人可自定义新任务名称');
ok(!L.createNextTask(rootF, srcInst, 'ai').ok, 'AI 无权开启下一轮');
ok(!L.createNextTask(rootF, null, 'human').ok, '源任务不存在时明确报错');

console.log('\n--- G. 度量输出 ---');
const ms = L.metrics(s);
ms.forEach(m => console.log('  · ' + m.key + ' = ' + m.value + '  [' + (m.na ? '留空/待接入' : '有值') + ']'));
ok(ms.some(m => m.key === '缺陷逃逸率' && m.na === true), '边界外指标诚实留空');
ok(ms.find(m => m.key === '门禁一次通过率').value !== '—', '门禁一次通过率可由事件日志算出');
ok(ms.find(m => m.key === 'AI 建议采纳率').value !== '100%', '发生打回后采纳率下降，指标具备信息量');
ok(ms.find(m => m.key === '执行可追溯率').value === '100%', '新增「执行可追溯率」= 100%，由 traces 凭证直接算出');

console.log('\n--- H. 总览页 / 实例切换 / 动作隔离（极简 DOM 桩） ---');
const store = {}, els = {};
function stub(id){
  return {id, value:'', textContent:'', className:'', style:{}, dataset:{}, _html:'',
    set innerHTML(v){this._html=String(v);}, get innerHTML(){return this._html;},
    classList:{toggle(){},add(){},remove(){},contains(){return false;}},
    querySelectorAll(){return [];}, closest(){return null;},
    addEventListener(){}};
}
let clickHandler = null, changeHandler = null;
const doc = {
  getElementById(id){ return els[id] || (els[id]=stub(id)); },
  querySelectorAll(){ return []; },
  addEventListener(type,fn){
    if(type==='click') clickHandler=fn;
    if(type==='change') changeHandler=fn;
  },
};
const ctx = vm.createContext({
  document:doc, console,
  localStorage:{ getItem:k=>store[k]||null, setItem:(k,v)=>{store[k]=String(v);}, removeItem:k=>{delete store[k];} },
  setTimeout:fn=>{ if(typeof fn==='function') fn(); return 0; },
  clearTimeout:()=>{}, confirm:()=>false,
});
vm.runInContext(storeCode, ctx);
vm.runInContext(logicCode, ctx);
vm.runInContext(uiCode, ctx);
ok(typeof clickHandler==='function', 'UI 层完成初始化并注册点击处理');
ok(els['main']._html.indexOf('开发任务总览')>=0, '默认进入总览页');
ok(els['main']._html.indexOf('TASK-1042')>=0 && els['main']._html.indexOf('TASK-0998')>=0, '总览展示多个任务');
ok((els['main']._html.match(/data-act="open"/g)||[]).length>=6, '每个任务都有「进入流程」入口');
ok(els['main']._html.indexOf('平均门禁一次通过率')>=0, '总览展示跨任务汇总指标');
ok(els['main']._html.indexOf('待我处理')>=0, '总览展示待我处理队列');
ok(els['side'].style.display==='none', '总览页隐藏单任务侧栏');
function fire(attrs){
  clickHandler({target:{closest:sel=>{
    if(sel==='[data-nav]'&&attrs.nav) return {dataset:Object.assign({nav:attrs.nav},attrs.dataset||{})};
    if(sel==='[data-view]'&&attrs.view) return {dataset:{view:attrs.view}};
    if(sel==='[data-tab]'&&attrs.tab) return {dataset:{tab:attrs.tab}};
    if(sel==='[data-act]'&&attrs.act) return {dataset:{act:attrs.act,id:attrs.id}};
    return null;
  }}});
}
function fireChange(value){ if(changeHandler) changeHandler({target:{id:'rcp-q',value:String(value)}}); }
const KEY='gatekeeper-v1';
fire({act:'open',id:'TASK-1042'});
ok(els['main']._html.indexOf('审批台')>=0, '点击进入后显示单任务流程页');
ok(els['crumb'].textContent.indexOf('TASK-1042')>=0, '面包屑显示当前任务');
ok(JSON.parse(store[KEY]).activeId==='TASK-1042', '当前实例已切换并持久化');
fire({act:'back'});
ok(els['main']._html.indexOf('开发任务总览')>=0, '可返回总览');

function stateOf(id){return JSON.parse(store[KEY]).instances.find(i=>i.id===id).state;}

console.log('\n--- H2. 新建任务即授权 G0：不再需要单独触发 ---');
els['new-task-name'].value='自检任务';
fire({act:'new-task'});
let saved=JSON.parse(store[KEY]);
ok(saved.instances.length===9, '新建任务后实例数 +1（种子 8 个 → 9 个）');
const newId=saved.activeId;
ok(newId!=='TASK-1042' && saved.instances[0].id===newId, '新任务创建并成为当前实例');
ok(els['main']._html.indexOf('审批台')>=0, '新建后自动进入该任务流程页');
let st=stateOf(newId);
ok(st.artifacts.length===1 && st.evidences.length===1, '创建任务即自动完成 G0：1 份 AI 工件 + 1 份签名证据，无需点触发');
ok(st.traces.length>=5, '自动生成 ' + st.traces.length + ' 条执行过程');
ok(st.events.some(e=>e.action==='TASK_AUTHORIZED_G0'), '「新建即授权」写入事件日志');
ok(st.events.some(e=>e.action==='AUTO_STEP'&&e.actor==='ai') && st.events.some(e=>e.action==='AUTO_STEP'&&e.actor==='toolchain'),
  'AI 与工具链步骤都写入事件日志');
ok(!st.events.some(e=>e.action==='RUN_TRIGGERED'), '正常流转不产生手动触发事件');

console.log('\n--- H3. 执行授权单：批准前就列出要做的事与通过标准 ---');
const desk=els['main']._html;
ok(desk.indexOf('执行授权单')>=0, '审批台展示执行授权单');
ok(desk.indexOf('批准放行 = 确认本阶段达标 + 授权下一阶段自动执行')>=0, '授权单写明批准与触发已合并');
ok(desk.indexOf('批准后自动启动 · G1 需求')>=0, '授权单明确下一阶段是 G1');
ok(desk.indexOf('把验收标准写成可测试的判据')>=0, '授权单列出下一阶段「将要做的事」');
ok(desk.indexOf('每条验收标准逐条可验证且有明确判据')>=0, '授权单列出下一阶段「什么标准才能通过」');
ok(desk.indexOf('本阶段通过标准 · 系统自动校验结果')>=0, '授权单列出本阶段自动校验结果');
ok(/系统实际会执行的 \d+ 步/.test(desk) && desk.indexOf('runlist')>=0, '授权单列出批准后实际会跑的每一步及执行主体');
ok(desk.indexOf('data-act="manual-run"')>=0, '保留「手动触发」兜底入口');
ok(/data-act="manual-run"[^>]*disabled/.test(desk), '正常流转下手动触发按钮禁用（已无待执行动作）');
ok(desk.indexOf('data-act="trigger"')<0, '正常流转不再渲染独立的「触发执行」按钮');

console.log('\n--- H4. 三分区动作隔离（不因合并而回退） ---');
const FORBIDDEN=['ai-submit','tool-submit','ai-task','tool-task','sim-fail','trigger'];
FORBIDDEN.forEach(a=>ok(desk.indexOf('data-act="'+a+'"')<0, '人工作台不展示后台动作 / 独立触发 '+a));
['receipt','state','artifacts','evidences','metrics','log','review','memory'].forEach(t=>{
  fire({tab:t});
  FORBIDDEN.forEach(a=>ok(els['main']._html.indexOf('data-act="'+a+'"')<0, '人页面 '+t+' 不展示 '+a));
});
fire({tab:'desk'});
['ai','toolchain'].forEach(v=>{
  fire({view:v});
  const tabs=v==='ai'?['trace','receipt','artifacts','memory','state']:['trace','receipt','evidences','state'];
  tabs.forEach(t=>{ fire({tab:t}); ok(!/data-act=/.test(els['main']._html), '只读观测区 '+v+'/'+t+' 零动作按钮'); });
});
fire({view:'human'}); fire({tab:'desk'});

console.log('\n--- H5. 一次批准 = 放行 + 授权下一阶段自动执行 ---');
const beforeArt=stateOf(newId).artifacts.length;
fire({act:'approve'});
st=stateOf(newId);
ok(st.phaseIdx===1, '人一次点击：G0 门禁放行并进入 G1');
ok(st.artifacts.length===beforeArt+1 && st.evidences.length===2, '批准后 G1 的 AI 工件与工具链证据自动产出，无需第二次点击');
ok(st.events.some(e=>e.action==='GATE_AUTHORIZED_NEXT_RUN'), '门禁授权下一阶段执行写入事件日志');
ok(!st.events.some(e=>e.action==='RUN_TRIGGERED'), '整个正常流转从未出现手动触发事件');
ok(st.traces.length>=10, '两阶段执行过程累计 '+st.traces.length+' 条');
const doneInst=stateOf('TASK-0998');
ok(doneInst.phaseIdx===11 && doneInst.approvals.length===11, '其他任务状态不受影响（实例隔离）');

console.log('\n--- H6. 打回同样是「一次判断 + 自动重做」 ---');
els['reject-reason'].value='验收标准缺少异常场景判据';
fire({act:'reject'});
st=stateOf(newId);
ok(st.phaseIdx===1 && st.reviewNotes.length===1, 'G1 被人工打回');
ok(st.artifacts.some(a=>a.phase==='G1'&&a.kind==='ai') && st.evidences.some(e=>e.phase==='G1'&&e.kind==='stage'),
  '打回后 AI 按意见自动重做，产出与证据重新齐备');
ok(st.events.some(e=>e.action==='REWORK_AUTHORIZED'), '打回授权重做写入事件日志');

console.log('\n--- H7. G4 Review / 裁决授权单与连带自动执行（按 Task 独立） ---');
fire({act:'open',id:'TASK-1051'});
let g4=stateOf('TASK-1051');
ok(g4.escalated.T2===true, '种子任务处于 T2 失败熔断待人裁决');
ok(g4.taskStep.T1.test===true && g4.taskStep.T2.test===true,
  'T1 与 T2 同批并行，都已写完测试（并发执行留下痕迹）');
fire({tab:'review'});
ok(els['main']._html.indexOf('本次签字授权什么')>=0, 'Review 页也展示「要做的事 / 通过标准」授权单');
ok(els['main']._html.indexOf('先写测试（对齐验收标准），产生红阶段证据')>=0,
  'Review 授权单列出 G4 要做的事（验收标准为 PRD 内容，保持纯文本不建链接）');
// 熔断的 Task 有独立的裁决入口（带 Task ID）
ok(/data-act="arbitrate" data-id="T2"/.test(els['main']._html), '熔断 Task 有独立的裁决按钮（带 Task ID）');
const tr0=g4.traces.length;
fire({act:'arbitrate',id:'T2'});
g4=stateOf('TASK-1051');
ok(g4.escalated.T2===false, '人一次裁决解除熔断');
ok(g4.events.some(e=>e.action==='ARBITRATION_AUTHORIZED'), '裁决连带授权恢复执行');
ok(g4.traces.length>tr0, '裁决后自动执行过程继续产生 '+(g4.traces.length-tr0)+' 条');
// 越界说明按 Task 绑定
els['scope-note-T2'].value='遗留耦合模块需同步修正错误码映射';
fire({act:'explain',id:'T2'});
g4=stateOf('TASK-1051');
ok(!!g4.outOfScope.T2.explanation, 'T2 越界说明已留痕');
const tr1=g4.traces.length;
fire({act:'review-ok',id:'T2'});
g4=stateOf('TASK-1051');
ok(g4.taskStep.T2.review==='ok', 'T2 Review 签字通过');
ok(g4.events.some(e=>e.action==='REVIEW_AUTHORIZED_NEXT_TASK'), '签字即授权后续自动执行');
ok(g4.traces.length>tr1, '签字后自动执行过程继续产生 '+(g4.traces.length-tr1)+' 条');
// 独立评审：T1 仍未签字，但 T3 依赖 T2 —— T2 签字后 T3 才解锁
ok(g4.taskStep.T1.review!=='ok', 'T1 尚未签字，评审互不阻塞');
ok(L.depsSatisfied(g4, L.taskById(g4,'T3')), 'T2 签字后 T3 依赖满足，可进入下一批次');
ok(g4.taskStep.T3.test===true || L.readyBatch(g4).map(t=>t.id).indexOf('T3')>=0,
  'T3 已解锁：签字连带授权后自动开工（或已在批次中）');

console.log('\n--- H7b. 并发批次的评审板：逐 Task 独立、横幅与授权单按批次 ---');
// 状态：T2 已签字，T1 待签（T1 尚未签字），T3 因依赖 T2 未签字而解锁
g4=stateOf('TASK-1051');
fire({tab:'review'});
const rh7=els['main']._html;
// 每个待评审 Task 各有一组独立按钮，且都带自己的 Task ID
ok(/data-act="review-ok" data-id="T1"/.test(rh7), 'T1 有独立的 Review 通过按钮（带 Task ID）');
ok(g4.taskStep.T2.review==='ok' && !/data-act="review-ok" data-id="T2"/.test(rh7),
  'T2 已签字后其 Review 按钮消失（不重复提供签字动作）');
// T2 签字连带授权后 T3 已自动跑完 TDD 并产出 Diff —— 它同样有独立的 Review 入口
ok(g4.taskStep.T3.test===true && g4.taskStep.T3.green===true, 'T3 在 T2 签字后自动跑完了 TDD 链');
ok(/data-act="review-ok" data-id="T3"/.test(rh7), 'T3 产出 Diff 后有独立的 Review 通过按钮（带 Task ID）');
ok(g4.taskStep.T1.review!=='ok' && g4.taskStep.T3.review!=='ok',
  'T1 与 T3 各自待签 —— 评审互不阻塞，可任意顺序签字');
ok(rh7.indexOf('评审单位是单个 Task')>=0 || rh7.indexOf('评审单位：单个 Task')>=0,
  'Review 页明示「评审单位是单个 Task」');
// 此刻 T1/T3 都已产出 Diff 待签，readyBatch 为空（待评审不算「可开工」），批次说明卡不出现 —— 这是正确行为
ok(L.readyBatch(g4).length===0, '全部待签 Task 不再算「可开工」，批次已空');
ok(rh7.indexOf('并行执行：')<0 && rh7.indexOf('当前批次：')<0,
  '批次已空时不显示「本批 N 个 Task 并行执行」提示（那是在讲可开工的批次）');
ok(rh7.indexOf('并行待签')>=0, '但授权单明确列出当前并行待签的 Task 集合');
// 审批台的 G4 授权单也要能看清逐 Task 签字情况与依赖关系（批准前必须看全貌）
fire({tab:'desk'});
const dh7=els['main']._html;
ok(dh7.indexOf('G4 逐 Task 签字情况')>=0, '审批台授权单列出 G4 逐 Task 签字情况');
ok(dh7.indexOf('依赖关系（前置 Task 签字后才开工）')>=0, '审批台授权单列出 Task 依赖关系');
ok(dh7.indexOf('T3 依赖 T2')>=0, '审批台明示 T3 依赖 T2（前置签字后才开工）');
ok(dh7.indexOf('已签字：')>=0 && dh7.indexOf('待独立评审：')>=0,
  '审批台区分「已签字」与「待独立评审」的 Task');
fire({tab:'review'});
// 授权单在并行批次下逐 Task 列出各自验证方式（不能只显示其中一个）
ok(rh7.indexOf('各 Task 的验证方式')>=0, '并行批次的授权单逐 Task 列出验证方式');
ok(rh7.indexOf('单测：60s 内重复请求被拒')>=0 && rh7.indexOf('单测：错码 401 / 重放 409')>=0,
  '授权单同时给出 T1 与 T2 各自的验证判据');
// 横幅提示按实际待办集合判断，不受全局游标影响
ok(!/待你处理[^<]*T2/.test(rh7), '横幅不会把已签字的 T2 说成待处理');
ok(rh7.indexOf('T1')>=0, '待评审的 T1 在页面上可见');

console.log('\n--- H8. 手动触发只在异常恢复时生效 ---');fire({act:'back'});
const broken=JSON.parse(store[KEY]);
const t38=broken.instances.find(i=>i.id==='TASK-1038');
t38.state.artifacts=t38.state.artifacts.filter(a=>!(a.phase==='G3'&&a.kind==='ai'));
t38.state.evidences=t38.state.evidences.filter(e=>!(e.phase==='G3'&&e.kind==='stage'));
store[KEY]=JSON.stringify(broken);
vm.runInContext(uiCode, ctx);  // 模拟刷新中断后重新载入 UI
fire({act:'open',id:'TASK-1038'});
ok(!/data-act="manual-run"[^>]*disabled/.test(els['main']._html), '中断状态下手动触发按钮变为可用');
fire({act:'manual-run'});
const rec=stateOf('TASK-1038');
ok(rec.artifacts.some(a=>a.phase==='G3'&&a.kind==='ai') && rec.evidences.some(e=>e.phase==='G3'&&e.kind==='stage'),
  '异常恢复：手动触发补齐中断的阶段产出与证据');
ok(rec.events.some(e=>e.action==='RUN_TRIGGERED'), '手动恢复写入 RUN_TRIGGERED，与正常授权事件区分');

fire({act:'back'});
ok(els['main']._html.indexOf('开发任务总览')>=0, '可返回总览查看全局');
fire({view:'ai'}); fire({tab:'trace'});
ok(els['main']._html.indexOf('执行过程')>=0, 'AI 执行观测页可回看自动执行过程');

console.log('\n--- H9. 随时可查：执行追溯 / 全量事件日志 / 模拟文件评审 ---');
// 第 2 轮现在是**派生任务**（独立 ID）：G0 真实加载了从源任务继承的项目记忆
const derivedId=seed.instances.find(i=>i.state.round===2).id;
fire({act:'open',id:derivedId});
fire({tab:'receipt'});
let rh=els['main']._html;
ok(rh.indexOf('执行追溯')>=0 && rh.indexOf('可追溯覆盖率')>=0, '人工作台可随时进入执行追溯页');
ok(rh.indexOf('① 谁做的')>=0 && rh.indexOf('② 什么时候')>=0 && rh.indexOf('④ 如何加载')>=0,
  '凭证按「谁 / 何时 / 输入 / 如何加载 / 输出」分区展示');
ok(rh.indexOf('data-act=')<0, '追溯页只有查看导航，没有流程动作按钮');
ok(rh.indexOf('data-nav="filter"')>=0, '提供按执行主体筛选的入口');
ok(rh.indexOf('project_memory')>=0 && rh.indexOf('历史教训')>=0, '可查项目记忆的输入分组与分类');
ok(rh.indexOf('agent-ai-01')>=0 && rh.indexOf('演示模拟执行')>=0, '可查「什么 AI」并明确标注模拟执行');
ok(rh.indexOf('原始凭证 JSON')>=0, '每步可展开完整原始凭证 JSON');

fire({nav:'filter',dataset:{actor:'ai'}});
ok(/命中 \d+ \/ \d+ 步/.test(els['main']._html), '按主体筛选后重新渲染命中数');
ok(els['main']._html.indexOf('data-nav="receipt"')>=0, '筛选结果仍保留逐条凭证入口');
fire({nav:'filter',dataset:{actor:'all'}});
fireChange('加载上下文');
ok(els['main']._html.indexOf('加载上下文')>=0, '关键字检索可查到指定步骤');
fire({nav:'clear-q'});
fire({nav:'quick-memory'});
ok(/命中 1 \/ \d+ 步/.test(els['main']._html), '「项目记忆加载凭证」精确筛出真正加载了记忆的步骤');
ok(els['main']._html.indexOf('已精确筛选')>=0, '精确筛选状态对用户可见且可一键清除');
ok(els['main']._html.indexOf('M-')>=0, '筛选结果直接展示项目记忆的具体条目 ID');
fire({nav:'filter',dataset:{actor:'all'}});

const st9=stateOf(derivedId);
fire({tab:'log'});
const lh=els['main']._html;
ok(lh.indexOf('事件日志（本任务全部')>=0, '事件日志标题明确标注「本任务全部 N 条」');
ok(!/最近 \d+ 条/.test(lh), '不再出现「最近 N 条」截断');
const rendered=(lh.match(/id="ev-/g)||[]).length;
ok(rendered===st9.events.length, '事件日志全量渲染 '+rendered+' 条 == 状态中 '+st9.events.length+' 条');
ok(lh.indexOf('data-nav="receipt"')>=0, '事件日志中的自动步骤可一键跳到执行凭证');
fire({act:'open',id:'TASK-0998'}); fire({tab:'log'});
const bigState=stateOf('TASK-0998');
ok(bigState.events.length>50 && (els['main']._html.match(/id="ev-/g)||[]).length===bigState.events.length,
  '已闭环任务（'+bigState.events.length+' 条事件）也全量渲染，无截断');
fire({act:'open',id:derivedId});

const lastTr=st9.traces[st9.traces.length-1];
fire({nav:'receipt',dataset:{id:lastTr.id}});
ok(els['main']._html.indexOf('原始凭证 JSON')>=0, '从任意入口可跳到指定步骤的完整凭证');
ok(els['main']._html.indexOf(lastTr.id)>=0, '详情页正确定位到该凭证 ID');

const fileArt=st9.artifacts.find(a=>a.file);
fire({nav:'file',dataset:{id:fileArt.id}});
const fh=els['main']._html;
ok(fh.indexOf('文件预览')>=0 && fh.indexOf(fileArt.file.path)>=0, '工件可跳转到模拟文件预览页');
ok(fh.indexOf('演示模拟文件')>=0, '文件页明确标注模拟、非真实仓库文件');
ok(fh.indexOf(fileArt.file.name)>=0 && fh.indexOf('文件元信息')>=0, '文件页展示文件名与元信息');
ok(fh.indexOf('文件内容')>=0 && fh.indexOf('评审')>=0, '文件正文全量展示并提供评审动作/状态');

console.log('\n--- H9+. 内容存储设置（插件化）与引用化 UI ---');
fire({act:'store-settings'});
const sh=els['modal-box']._html;
ok(sh.indexOf('内容存储（插件化）')>=0 && sh.indexOf('只保存引用')>=0, '内容存储弹窗说明「状态只保存引用」');
ok(sh.indexOf('virtual-fs')>=0 || sh.indexOf('虚拟内容仓')>=0, '弹窗展示已注册的存储插件');
ok(sh.indexOf('data-act="store-export-manifest"')>=0, '提供引用清单导出入口');
// 结构化内容/载荷/凭证在 UI 中经引用取回展示
fire({act:'open',id:'TASK-1042'});
fire({tab:'desk'});
const dh9=els['main']._html;
ok(dh9.indexOf('查看结构化内容')>=0 && dh9.indexOf('目标')>=0, '审批台工件经外部存储引用取回并展示结构化内容');
ok(!/"data":/.test(dh9) || dh9.indexOf('查看结构化内容')>=0, '工件内容在 UI 中可见（经引用 hydrate）');
fire({tab:'receipt'});
const rh9=els['main']._html;
ok(rh9.indexOf('原始凭证 JSON')>=0, '凭证页经引用取回完整凭证并可展开');

fire({view:'ai'}); fire({tab:'receipt'});
ok(els['main']._html.indexOf('执行凭证（只读）')>=0, 'AI 只读观测区也能随时查每步完整凭证');
ok(!/data-act=/.test(els['main']._html), 'AI 只读区仍零流程动作按钮');
fire({view:'toolchain'}); fire({tab:'receipt'});
ok(els['main']._html.indexOf('执行凭证（只读）')>=0, '工具链只读观测区也能随时查每步完整凭证');
ok(!/data-act=/.test(els['main']._html), '工具链只读区仍零流程动作按钮');

fire({act:'back'});
ok(els['main']._html.indexOf('data-nav="open-receipt"')>=0, '总览每张任务卡片提供「执行凭证 N 步」直达入口');
fire({nav:'open-receipt',dataset:{task:'TASK-0977'}});
ok(els['main']._html.indexOf('执行追溯')>=0, '从总览一键进入该任务的执行追溯页');

console.log('\n--- H13. 闭环后新建下一轮任务（UI 层实测：新建而非重置） ---');
// 打开一个已闭环任务（源任务），在「记忆确认」页点「新建下一轮任务」
const closedSrc='TASK-0977';
const before=JSON.parse(store[KEY]);
const instBefore=before.instances.length;
const srcBefore=JSON.stringify(before.instances.find(i=>i.id===closedSrc).state);
fire({act:'open',id:closedSrc});
fire({tab:'memory'});
const mh=els['main']._html;
ok(mh.indexOf('开启下一轮 = 新建一个任务，不是把当前任务重置重跑')>=0, '记忆确认页写明「新建任务」而非「重置当前任务」');
ok(mh.indexOf('《输出文档》2.1「项目记忆持久化，跨任务复用」')>=0, '给出文档依据（记忆跨任务复用）');
ok(mh.indexOf('data-act="next-round"')>=0, '提供「新建下一轮任务」动作入口');
ok(mh.indexOf('id="next-task-name"')>=0, '可填写新任务名称');
fire({act:'next-round'});
const after=JSON.parse(store[KEY]);
ok(after.instances.length === instBefore + 1, '新建后实例数 +1（'+instBefore+' → '+after.instances.length+'）');
const newInst=after.instances[0];
ok(newInst.id !== closedSrc, '新任务是新 ID，不是复用源任务 ID');
ok(after.activeId === newInst.id, '自动切换到新建的任务');
ok(JSON.stringify(after.instances.find(i=>i.id===closedSrc).state) === srcBefore,
  '源任务状态逐字未变（工件 / 证据 / 审批 / 事件全部留档）');
ok(newInst.state.parentTaskId === closedSrc, '新任务记录派生来源');
ok(newInst.state.round === 2 && newInst.state.phaseIdx >= 0, '新任务第 2 轮，从 G0 开始');
ok(newInst.state.memories.length > 0, '新任务继承了已入库的生效记忆');
// 总览页应展示血缘
fire({act:'back'});
const ovh=els['main']._html;
ok(ovh.indexOf('派生自 '+closedSrc)>=0, '总览任务卡片展示「派生自 TASK-xxxx」血缘');
ok(ovh.indexOf('data-nav="open-task"')>=0, '提供跳转回源任务的入口');
// 源任务仍可进入，历史完整可查
fire({act:'open',id:closedSrc});
const srcState=stateOf(closedSrc);
ok(srcState.finishedAt && srcState.artifacts.length>0 && srcState.events.length>0,
  '源任务仍可进入，工件与事件日志完整保留可查');
// 派生任务的横幅能一键回到源任务
fire({act:'open',id:newInst.id});
const nh=els['main']._html;
ok(nh.indexOf('data-nav="open-task" data-task="'+closedSrc+'"')>=0, '派生任务横幅提供「派生自 TASK-xxxx」回跳入口');
fire({nav:'open-task',dataset:{task:closedSrc}});
ok(JSON.parse(store[KEY]).activeId === closedSrc, '点血缘入口能跳回源任务');

console.log('\n--- H10. 产出物名称可跳文件 + 评审依据上移 + 链接不带箭头 ---');
fire({act:'open',id:'TASK-1042'});
fire({tab:'desk'});
const dh=els['main']._html;
ok(dh.indexOf('data-nav="file"')>=0, '审批台里产出物名称是可跳文件的链接');
ok(/data-nav="file" data-id="[^"]+">PRD<\/button>/.test(dh), '「PRD」字样渲染为跳转链接');
ok(dh.indexOf('验收标准')>=0, '「验收标准」字样仍出现在审批台（它是 PRD 的内容，不是独立产物）');
ok(!/data-nav="file"[^>]*>验收标准/.test(dh), '「验收标准」不建链接（它不是独立产物，跳过去是错的）');
const iBasis=dh.indexOf('审批依据 · AI 产出'), iAct=dh.indexOf('我的动作 · 一次批准即授权下一阶段');
ok(iBasis>0 && iAct>0 && iBasis<iAct, '评审依据已上移，紧邻审批动作之前');
const ids10=(dh.match(/data-nav="file" data-id="[^"]+"/g)||[]).map(x=>x.match(/data-id="([^"]+)"/)[1]);
const st10=stateOf('TASK-1042');
ok(ids10.length>0 && ids10.every(id=>st10.artifacts.some(a=>a.id===id&&a.file)),
  '全部 '+ids10.length+' 个跳文件链接都指向真实存在的工件文件（无死链）');
ok(!/<(?:button|a)[^>]*>[^<]*→[^<]*<\/(?:button|a)>/.test(dh), '审批台内所有链接按钮都不带箭头字符');
els['new-task-name'].value='链接测试任务';
fire({act:'new-task'});
const newId2=JSON.parse(store[KEY]).activeId;
const st10b=stateOf(newId2);
fire({tab:'desk'});
const dhNew=els['main']._html;
ok(dhNew.indexOf('验收标准')>=0, '新任务 G0 的授权单里也出现「验收标准」字样');
ok(!/data-nav="file"[^>]*>验收标准/.test(dhNew), '「验收标准」在任何阶段都不建链接');
const ids10b=(dhNew.match(/data-nav="file" data-id="[^"]+"/g)||[]).map(x=>x.match(/data-id="([^"]+)"/)[1]);
ok(ids10b.every(id=>st10b.artifacts.some(a=>a.id===id&&a.file)),
  '新任务的跳文件链接也全部指向已产出的真实文件（'+ids10b.length+' 条）');

console.log('\n--- H11. 全站链接按钮统一不带箭头 ---');
const linkHtml=[];
['human','ai','toolchain'].forEach(v=>{
  fire({view:v});
  linkHtml.push(els['main']._html);
});
fire({act:'open',id:'TASK-0977'});
['desk','receipt','review','memory','state','artifacts','evidences','metrics','log'].forEach(v=>{
  fire({tab:v}); linkHtml.push(els['main']._html);
});
const allHtml=linkHtml.join('\n');
const arrowsInLinks=(allHtml.match(/<(?:button|a)[^>]*>[^<]*→[^<]*<\/(?:button|a)>/g)||[]);
ok(arrowsInLinks.length===0, '全部 '+linkHtml.length+' 个页面视图里没有带箭头的链接按钮（剩余 '+arrowsInLinks.length+' 条）');
ok(/data-nav="receipt"/.test(allHtml), '追溯类链接仍然存在（去箭头没有误伤链接本身）');
ok(/data-nav="file"/.test(allHtml), '跳文件类链接仍然存在');
ok(/追溯链 · AC → Plan → Task → 用例/.test(allHtml), '流程语义箭头（如追溯链 AC → Plan → Task → 用例）未被误删');

console.log('\n--- H12. 旧存档迁移：补齐 Task 依赖图，不丢进度 ---');
// 用独立的新种子状态模拟 v0.7 存档：tasks[].deps 字段不存在（串行游标时代的结构）
// 注意不能复用 UI 交互后的存档 —— 那份里 T2 已被签字，T3 依赖本来就已满足，测不出迁移效果
const freshRoot = L.createSeedRoot();
const legacy = JSON.parse(JSON.stringify(freshRoot.instances.find(x=>x.id==='TASK-1051').state));
ok(legacy.tasks.length === 3, '取到一个已产出 Task 清单的存档作为迁移样本（'+legacy.tasks.length+' 个 Task）');
legacy.tasks.forEach(t => { delete t.deps; });
ok(legacy.tasks.every(t => t.deps === undefined), '构造出旧结构存档（Task 上无 deps 字段）');
L.migrateState(legacy);
ok(legacy.tasks.every(t => Array.isArray(t.deps)), '迁移后所有 Task 都有 deps 数组');
const legacyT3 = legacy.tasks.find(t => t.id === 'T3');
ok(legacyT3 && legacyT3.deps.join(',') === 'T2', '迁移按 TASK_TEMPLATE 回填依赖：T3 ← T2');
ok(legacy.tasks.find(t=>t.id==='T1').deps.length === 0, '迁移后 T1 仍无依赖（可与同批 Task 并行）');
// 关键回归：没有 deps 时 depsSatisfied 会误判为「无依赖」，导致本该阻塞的 T3 被并发拉起
const legacyG4 = JSON.parse(JSON.stringify(freshRoot.instances.find(x=>x.id==='TASK-1051').state));
legacyG4.tasks.forEach(t => { delete t.deps; });
const beforeMigrate = L.depsSatisfied(legacyG4, legacyG4.tasks.find(t=>t.id==='T3'));
L.migrateState(legacyG4);
const afterMigrate = L.depsSatisfied(legacyG4, legacyG4.tasks.find(t=>t.id==='T3'));
ok(beforeMigrate === true, '未迁移时 T3 被误判为无依赖（这正是要修的缺陷）');
ok(afterMigrate === false, '迁移后 T3 依赖未满足即被阻塞，不会被并发提前拉起');
ok(L.migrateState(legacyG4) === legacyG4, '迁移函数幂等，重复调用安全');
ok(legacyG4.tasks.every(t=>Array.isArray(t.deps)&&Array.isArray(t.scope)&&Array.isArray(t.diff)),
  '迁移后 Task 的 scope / diff / deps 结构齐备');
ok(legacyG4.taskStep.T1 && legacyG4.taskStep.T1.review, '迁移保留原有 Task 步骤状态（不丢进度）');

console.log('\n--- H14. 多任务管理与数据安全（v1.0 新增能力） ---');
fire({act:'back'});
// 归档 → 总览出现已归档区 → 恢复
fire({act:'archive-task',id:'TASK-1038'});
ok(JSON.parse(store[KEY]).instances.find(i=>i.id==='TASK-1038').archived===true,'任务可归档（archived 标记持久化）');
ok(els['main']._html.indexOf('已归档（')>=0,'总览展示已归档区');
ok(els['main']._html.indexOf('data-act="unarchive-task" data-id="TASK-1038"')>=0,'归档任务提供恢复入口');
fire({act:'unarchive-task',id:'TASK-1038'});
ok(JSON.parse(store[KEY]).instances.find(i=>i.id==='TASK-1038').archived===false,'归档任务可恢复');
// 删除需要确认：默认 confirm=false 时不删
const countBefore=JSON.parse(store[KEY]).instances.length;
fire({act:'del-task',id:'TASK-1038'});
ok(JSON.parse(store[KEY]).instances.length===countBefore,'删除未确认时不执行（防误删）');
// 导出备份：下载文件名与内容可解析
let lastDownload=null; const blobCaptor=[];
doc.createElement=tag=>({tag,click(){lastDownload=this;},set href(v){},set download(v){this._dl=v;},get download(){return this._dl;}});
ctx.Blob=class{constructor(parts){blobCaptor.push(String(parts[0]));}};
ctx.URL={createObjectURL:()=>'blob:x',revokeObjectURL:()=>{}};
fire({act:'export-data'});
ok(lastDownload && /gatekeeper-backup-\d{4}-\d{2}-\d{2}\.json/.test(lastDownload._dl),'导出备份生成带日期的下载文件名');
const exported=JSON.parse(blobCaptor[blobCaptor.length-1]);
ok(exported.app==='gatekeeper' && exported.data.version===2 && Array.isArray(exported.data.instances),'导出内容为可解析的完整备份 JSON');
// 总览搜索：change 事件按 ov-q 输入过滤
changeHandler({target:{id:'ov-q',value:'短信'}});
ok(els['main']._html.indexOf('TASK-1042')>=0 && els['main']._html.indexOf('TASK-0998')<0,'总览搜索框按关键字过滤任务');
fire({act:'clear-ov-q'});
ok(els['main']._html.indexOf('TASK-0998')>=0,'清除搜索后恢复全量列表');
// 空白工作区：全部任务删除后总览给出引导而非报错
ctx.confirm=()=>true; // 临时允许删除
JSON.parse(store[KEY]).instances.map(i=>i.id).forEach(id=>fire({act:'del-task',id}));
ok(els['main']._html.indexOf('还没有任务')>=0,'空工作区总览展示新建引导');
ok(JSON.parse(store[KEY]).instances.length===0,'全部任务删除后数据为空且可持久化');
ctx.confirm=()=>false;

console.log('\n--- H15. 快捷入口 / 依赖图 / 回放收起 / 精简跳过（UI 层实测） ---');
ctx.confirm=()=>true; fire({act:'reset'}); ctx.confirm=()=>false;   // 恢复种子数据供 UI 实测
fire({act:'open',id:'TASK-1051'});   // G4 阶段任务
let dh15=els['main']._html;
ok(dh15.indexOf('快捷入口')>=0 && dh15.indexOf('data-nav="goto-review"')>=0,
  '审批台快捷入口可一键进入 G4 循环 Review 页');
ok(dh15.indexOf('data-act="skip-phase"')>=0 && dh15.indexOf('跳过本阶段（精简流程）')>=0,
  '审批台提供「跳过本阶段（精简流程）」动作');
ok(dh15.indexOf('data-nav="trace-toggle"')>=0 && dh15.indexOf('展开')>=0 && dh15.indexOf('已收起')>=0,
  '「自动执行过程（模拟）」回放卡默认收起，可展开');
fire({tab:'review'});
let rh15=els['main']._html;
ok(rh15.indexOf('Task 依赖关系图')>=0 && rh15.indexOf('<svg')>=0 && rh15.indexOf('dep-arrow')>=0,
  '循环 Review 页用 SVG 图形展示 Task 依赖关系');
ok(rh15.indexOf('>T1<')>=0 && rh15.indexOf('>T3<')>=0, '依赖图包含全部 Task 节点');
ok(rh15.indexOf('前置签字后才开工')>=0, '依赖图附图例说明');
fire({nav:'trace-toggle'});
ok(els['main']._html.indexOf('已收起')<0 && els['main']._html.indexOf('data-nav="receipt-all"')>=0,
  '点「展开」后回放卡展示执行过程与凭证入口');
// G10 任务：审批台快捷入口直达记忆确认页
fire({act:'open',id:'TASK-1060'});
dh15=els['main']._html;
ok(dh15.indexOf('data-nav="goto-memory"')>=0 && dh15.indexOf('进入记忆确认页')>=0,
  'G10 阶段快捷入口可一键进入记忆确认页');
// 精简跳过：确认后跳过当前阶段并留痕
const skipSt=stateOf('TASK-1042');
const skipIdx=skipSt.phaseIdx;
fire({act:'open',id:'TASK-1042'});
ctx.confirm=()=>true;
fire({act:'skip-phase'});
ctx.confirm=()=>false;
const afterSkip=stateOf('TASK-1042');
ok(afterSkip.phaseIdx===skipIdx+1, '确认后阶段被跳过，推进到下一阶段');
ok(afterSkip.skipped[(L.PHASES[skipIdx]||{}).id]===true, '跳过在状态中留痕');
ok(afterSkip.events.some(e=>e.action==='PHASE_SKIPPED'), '精简跳过写入 PHASE_SKIPPED 事件');
ok(afterSkip.approvals[skipIdx] && afterSkip.approvals[skipIdx].skipped===true, '门禁记录记为 skipped');

console.log('\n--- I. 接口规范测试套件（spec.md，每次发布必须全过） ---');
// I1. 规范文档与机器可读登记表存在且一致
{
  const spec = fs.readFileSync(path.join(__dirname, 'gatekeeper', 'spec.md'), 'utf8');
  ok(spec.indexOf('gk.spec/1') >= 0 && spec.indexOf('发布门禁') >= 0, '接口规范文档 spec.md 存在并声明发布门禁');
  ok(Array.isArray(L.INTERFACES) && L.INTERFACES.length >= 10, '机器可读接口登记表 LOGIC.INTERFACES 已注册（' + L.INTERFACES.length + ' 个接口）');
  const ids = new Set(L.INTERFACES.map(i => i.id));
  ok(ids.size === L.INTERFACES.length, '接口 ID 唯一，无重复登记');
  L.INTERFACES.forEach(i => {
    ok(typeof i.id === 'string' && i.id.indexOf('gk.') === 0, '接口 ' + i.id + ' 使用 gk. 命名空间');
    ok(i.caller === 'ai' || i.caller === 'toolchain' || i.caller === 'human', '接口 ' + i.id + ' 声明了合法主体 ' + i.caller);
    // 登记表里的每个函数都必须真实存在于 LOGIC 导出（confirmMemory / revokeMemory 复合登记拆开校验）
    String(i.fn).split(' / ').forEach(fn => ok(typeof L[fn] === 'function', '接口 ' + i.id + ' 的函数 ' + fn + ' 已在 LOGIC 导出且可调用'));
    ok(spec.indexOf(i.id) >= 0, '接口 ' + i.id + ' 已同步写入 spec.md（文档与登记表一致）');
  });
  ok(L.RECEIPT_SCHEMA === 'gk.receipt/1' && spec.indexOf('gk.receipt/1') >= 0, '凭证 schema 版本 gk.receipt/1 双侧一致');
}
// I2. 越权调用全部被拒绝：每个接口用错误主体调用必须 {ok:false} 且留 PERMISSION_DENIED 痕
{
  const t = L.createState(1, []);
  const denyCheck = (label, fn) => {
    const before = JSON.stringify(t);
    const r = fn();
    ok(r && r.ok === false, '越权拒绝：' + label);
    ok(JSON.stringify(t) === before || t.events.some(e => e.action === 'PERMISSION_DENIED'), '越权调用留痕或状态不变：' + label);
  };
  denyCheck('AI 冒充工具链签名（toolSubmit as ai）', () => L.toolSubmit(t, 'ai'));
  denyCheck('工具链冒充 AI 提交（aiSubmit as toolchain）', () => L.aiSubmit(t, 'toolchain'));
  denyCheck('AI 尝试审批（approve as ai）', () => L.approve(t, 'ai'));
  denyCheck('工具链尝试审批（approve as toolchain）', () => L.approve(t, 'toolchain'));
  denyCheck('AI 尝试打回（reject as ai）', () => L.reject(t, 'ai', 'x'));
  denyCheck('AI 尝试精简跳过（skipPhase as ai）', () => L.skipPhase(t, 'ai'));
  denyCheck('工具链尝试精简跳过（skipPhase as toolchain）', () => L.skipPhase(t, 'toolchain'));
  denyCheck('AI 尝试人工 Review（reviewTask as ai）', () => L.reviewTask(t, 'ai', 'ok', '', null));
  denyCheck('工具链尝试裁决（arbitrate as toolchain）', () => L.arbitrate(t, 'toolchain', null));
  denyCheck('AI 尝试越界说明（explainOutOfScope as ai）', () => L.explainOutOfScope(t, 'ai', 'x', null));
  denyCheck('AI 尝试记忆确认（confirmMemory as ai）', () => L.confirmMemory(t, 'M-001', 'ai'));
  denyCheck('AI 尝试否决记忆（revokeMemory as ai）', () => L.revokeMemory(t, 'M-001', 'ai'));
  ok(t.events.some(e => e.action === 'PERMISSION_DENIED'), '权限拒绝事件已写入不可变日志');
}
// I3. 数据契约：工件 / 证据 / 凭证字段齐备且引用化
{
  let arts = [], evs = [];
  seed.instances.forEach(i => { arts = arts.concat(i.state.artifacts); evs = evs.concat(i.state.evidences); });
  ok(arts.every(a => a.id && a.phase && a.kind === 'ai' && a.hash && a.producer && a.ref && a.ref.uri && a.ref.hash && a.file && a.file.path),
    '工件契约：' + arts.length + ' 份全部带 id/phase/kind/hash/producer/引用/模拟文件');
  ok(arts.every(a => a.ref.uri.indexOf('gk://') === 0), '工件内容全部外置（gk:// 引用，状态机不存本体）');
  ok(evs.every(e => e.id && e.phase && e.title && e.source === 'toolchain' && e.signer === 'ci-runner-01' && e.commitHash && e.diffHash && e.result && e.ref),
    '证据契约：' + evs.length + ' 份全部由工具链签名并绑定 commit/diff hash');
  const humanEvs = evs.filter(e => e.source !== 'toolchain');
  ok(humanEvs.length === 0, '不存在非工具链来源的证据（AI 自报不算证据）');
}
// I4. 权限事件矩阵：spec.md §3.4 的 action → actor 约束在全部种子事件上成立
{
  const MATRIX = {
    ARTIFACT_SUBMITTED: 'ai', TEST_WRITTEN: 'ai', DIFF_SUBMITTED: 'ai',
    EVIDENCE_SIGNED: 'toolchain', SELFTEST_FAILED: 'toolchain',
    GATE_APPROVED: 'human', GATE_REJECTED: 'human', DIFF_REVIEWED: 'human', DIFF_REJECTED: 'human',
    HUMAN_ARBITRATION: 'human', OUT_OF_SCOPE_EXPLAINED: 'human',
    MEMORY_CONFIRMED: 'human', MEMORY_REVOKED: 'human',
  };
  let checked = 0, bad = 0;
  seed.instances.forEach(i => i.state.events.forEach(e => {
    if (MATRIX[e.action]) { checked++; if (e.actor !== MATRIX[e.action]) bad++; }
  }));
  ok(checked > 100, '权限事件矩阵覆盖 ' + checked + ' 条事件');
  ok(bad === 0, '全部 ' + checked + ' 条事件的 actor 与规范矩阵一致（违例 ' + bad + ' 条）');
  // 模拟标注：外部主体步骤必须标 simulated，系统编排不算模拟
  let simBad = 0;
  seed.instances.forEach(i => i.state.traces.forEach(t => {
    const r = R(t);
    if (r && !!r.simulated !== (t.actor !== 'system')) simBad++;
  }));
  ok(simBad === 0, '全部凭证的 simulated 标注正确（外部主体=模拟，系统编排=非模拟）');
}
// I5. 精简跳过接口（gk.human.skip）行为与留痕
{
  const t = L.createState(1, []);
  // 推进到 G9（发布）：G4 内层需人 Review，G10 前的候选记忆需人确认 —— 全部走规范接口
  let guard = 0;
  while (L.cur(t) && L.cur(t).id !== 'G9' && guard++ < 20) {
    L.buildRunPlan(t).forEach(st => L.runStep(t, st));
    if (L.cur(t).id === 'G4') {
      L.tasksAwaitingReview(t).forEach(x => {
        const o = t.outOfScope[x.id];
        if (o && o.files.length && !o.explanation) L.explainOutOfScope(t, 'human', '遗留耦合需同步修正错误码映射', x.id);
        L.reviewTask(t, 'human', 'ok', '', x.id);
      });
    }
    t.memories.filter(m => m.status === 'candidate').forEach(m => L.confirmMemory(t, m.id, 'human'));
    L.approve(t, 'human');
  }
  ok(L.cur(t).id === 'G9', '已推进到 G9 运维（普通改代码任务不需要的阶段）');
  const apBefore = t.approvals.length;
  const r = L.skipPhase(t, 'human', '普通改代码任务，不需要运维动作');
  ok(r.ok === true, '人调用 gk.human.skip 成功');
  ok(L.cur(t).id === 'G10', '跳过后进入 G10 复盘');
  ok(t.skipped.G9 === true, '状态记 skipped.G9 留痕');
  const skipAp = t.approvals[apBefore];
  ok(skipAp && skipAp.phase === 'G9' && skipAp.skipped === true && skipAp.reason, '门禁记录 {skipped:true, reason} 留痕');
  ok(t.events.some(e => e.action === 'PHASE_SKIPPED' && e.actor === 'human' && e.target === 'G9'), 'PHASE_SKIPPED 事件由 human 写入日志');
  // 跳过后流程照常闭环，门禁总数不变（11 道，其中 G9 为 skipped）
  for (let i = 0; i < 3; i++) {
    L.buildRunPlan(t).forEach(st => L.runStep(t, st));
    // G10 门禁要求候选记忆先经人确认
    t.memories.filter(m => m.status === 'candidate').forEach(m => L.confirmMemory(t, m.id, 'human'));
    ok(L.approve(t, 'human').ok, '跳过 G9 后后续门禁照常签署（当前 ' + (L.cur(t) ? L.cur(t).id : '闭环') + '）');
    if (t.finishedAt) break;
  }
  ok(t.finishedAt && t.approvals.length === 11, '含 skipped 的流程同样 11 道门禁记录闭环');
  // 度量口径：skipped 门禁不参与通过率 / 耗时
  ok(t.approvals.some(a => a.skipped) && t.approvals.every(a => typeof a.durationMs === 'number'), '门禁记录完整，skipped 带原因');
  // 迁移兼容：旧存档缺 skipped 字段时自动补齐
  const old = L.createState(1, []); delete old.skipped;
  L.migrateState(old);
  ok(old.skipped && typeof old.skipped === 'object', 'migrateState 为旧存档补齐 skipped 字段');
}

console.log('\n============================================');
console.log('自检通过：' + pass + ' 项断言，0 失败');
console.log('============================================');
