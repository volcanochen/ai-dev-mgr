/* ============================================================
   纯逻辑层：不依赖 DOM，可被 Node 自检脚本直接加载执行
   职责边界：只管 状态 / 工件 / 证据 / 审批 / 记忆 / 度量
   主体边界：AI 仅 produce，工具链仅 sign，仅人可 approve / reject / 裁决 / 触发
   多实例：createSeedRoot 用同一套流程逻辑真实推进出多个开发任务，不写死状态
   ============================================================ */
const LOGIC = (() => {
  /* todo / criteria 逐条摘自《AI开发流程设计》2.3 各阶段的「AI 职责 / 产出物 / 门禁」，
     用于生成执行授权单：批准前让人知道下一阶段要做什么、按什么标准才算通过 */
  const PHASES = [
    {id:'G0', name:'上下文准备', seg:'准备', gate:'人确认上下文摘要', ai:'Context Brief 上下文摘要', ev:'代码库索引快照',
      todo:['加载项目记忆：约束、编码规范、历史教训','检索相关代码与文档，输出现状分析','汇总成本次任务的代码位置、既有约定、风险点'],
      criteria:['上下文摘要无遗漏、无误解','人补充的任务背景、动机、边界条件已记录']},
    {id:'G1', name:'需求', seg:'准备', gate:'人批准 PRD · 验收标准逐条可验证', ai:'结构化 PRD + 验收标准', ev:'需求一致性扫描',
      todo:['对模糊需求主动追问澄清','将碎片化描述结构化为 PRD','标注矛盾项与缺失项','把验收标准写成可测试的判据'],
      criteria:['每条验收标准逐条可验证且有明确判据','PRD 经人批准','矛盾项与缺失项已显式标注']},
    {id:'G2', name:'方案', seg:'准备', gate:'人批准 Plan · 与 AC 一一对应', ai:'现状分析 + 多方案 + Plan', ev:'依赖影响分析',
      todo:['先探索代码库，输出现状分析','提出 2~3 个可行方案，含改动面 / 风险 / 工作量对比','给出推荐方案与理由','输出改动文件清单、分步说明、风险清单'],
      criteria:['Plan 与每条验收标准一一对应','改动文件清单与风险清单齐备','方案经人取舍后批准']},
    {id:'G3', name:'任务拆解', seg:'准备', gate:'人确认 Task 清单', ai:'可独立验证的 Task 清单', ev:'拆解粒度检查',
      todo:['把 Plan 拆成有序 Task 清单','每个 Task 写明目标、涉及文件、验证方式','标注 Task 间依赖关系'],
      criteria:['每个 Task 可独立验证，有明确完成判据','Task 覆盖全部验收标准','范围经人确认，剔除过度工程']},
    {id:'G4', name:'实现（逐 Task）', seg:'实现循环', gate:'全部 Diff 通过人 Review', ai:'逐 Task 测试 / 实现 / 变更说明', ev:'红绿测试 · Lint · 越界检测',
      todo:['先写测试（对齐验收标准），产生红阶段证据','再写实现让测试通过','自查编译、Lint、单测全绿','输出 Diff + 变更说明'],
      criteria:['每个 Task 的 Diff 通过人 Review','测试全绿，Lint 无错误','Plan 之外的改动已人工说明','自测失败未超过 N 次上限']},
    {id:'G5', name:'验证', seg:'实现循环', gate:'全量测试通过 · 覆盖率未下降', ai:'验证报告草稿', ev:'全量回归 + 覆盖率 + 静态检查',
      todo:['跑全量回归与静态分析','检查测试覆盖率变化','失败时给出根因诊断与修复建议'],
      criteria:['全量测试通过','无未说明的覆盖率下降','遗留问题已列入验证报告']},
    {id:'G6', name:'评审', seg:'交付', gate:'人批准合入', ai:'AI 预审清单（风格 / bug / 安全）', ev:'静态分析复核',
      todo:['AI 预审风格一致性、命名、潜在 bug、安全问题','输出审查清单，过滤机械性问题'],
      criteria:['人终审业务正确性与架构合理性','审查意见与修订记录齐备后批准合入']},
    {id:'G7', name:'测试', seg:'交付', gate:'验收标准全覆盖且通过', ai:'对齐 AC 的用例矩阵', ev:'用例执行结果',
      todo:['从验收标准生成测试用例矩阵','执行测试并给出结果','区分缺陷 / 环境问题 / 用例错误并附证据'],
      criteria:['验收标准全覆盖且全部通过','关键路径用例充分性经人审查','发布标准经人确认']},
    {id:'G8', name:'发布', seg:'交付', gate:'人签署发布', ai:'Changelog + 发布单', ev:'构建产物校验',
      todo:['生成变更日志 Changelog','预填发布单','监控发布过程指标'],
      criteria:['发布单与 Changelog 齐备','回滚方案明确','人签署发布后才可上线']},
    {id:'G9', name:'运维', seg:'运行改进', gate:'重大操作人批准', ai:'诊断报告 + 处置建议', ev:'告警聚类 + 变更关联',
      todo:['告警聚类与降噪','关联日志、变更记录、代码位置做初步定位','给出修复 / 回滚 / 降级建议'],
      criteria:['重大操作需人批准执行','处置方式由人决策','诊断报告与处置建议已归档']},
    {id:'G10', name:'复盘 · 经验回流', seg:'运行改进', gate:'人确认记忆条目', ai:'候选记忆规则', ev:'本轮事件汇总',
      todo:['归纳本轮人的修正意见与方案调整原因','提炼为规则 / 偏好，生成候选记忆条目'],
      criteria:['人确认哪些教训固化为长期约束','候选条目已确认入库或被否决','下一轮 G0 可加载生效记忆']},
  ];
  const AC_TEMPLATE = [
    {id:'AC-01', text:'用户输入合法手机号后可获取验证码', testable:'调用 /sms/send 返回 200，且 60s 内重复请求仅发送一次'},
    {id:'AC-02', text:'验证码错误时拒绝登录', testable:'提交错误验证码返回 401，且不产生会话记录'},
    {id:'AC-03', text:'同一验证码不可重复使用', testable:'二次提交同一验证码返回 409，首次会话保持有效'},
  ];
  /* Task 清单：每个 Task 粒度 = 可独立验证（《AI开发流程设计》2.3 G3），并显式标注依赖关系。
     deps 声明「必须等哪些 Task 被人 Review 通过后才能开工」的前置依赖。
     同批并发的判据：依赖已满足 + 文件范围互不重叠（否则 Diff 会互相污染）。 */
  const TASK_TEMPLATE = [
    {id:'T1', title:'实现验证码发送与限流', scope:['src/auth/SmsCode.ts','tests/auth/sms.test.ts'], acs:['AC-01'], deps:[],
      verify:'单测：60s 内重复请求被拒', diff:['src/auth/SmsCode.ts','tests/auth/sms.test.ts']},
    {id:'T2', title:'登录接口接入验证码校验', scope:['src/api/login.ts','tests/auth/login.test.ts'], acs:['AC-02','AC-03'], deps:[],
      verify:'单测：错码 401 / 重放 409', diff:['src/api/login.ts','tests/auth/login.test.ts','src/legacy/bridge.js']},
    {id:'T3', title:'会话与错误码统一', scope:['src/auth/AuthService.ts','tests/auth/session.test.ts'], acs:['AC-02'], deps:['T2'],
      verify:'集成测试：失败不产生会话', diff:['src/auth/AuthService.ts','tests/auth/session.test.ts']},
  ];
  const FAIL_LIMIT = 3;

  /* 执行主体登记：原型用模拟适配器代替真实 AI 与 CI。身份必须显式标注「模拟」，不冒充真实接入。 */
  const ACTORS = {
    ai:{id:'agent-ai-01', kind:'ai', name:'AI 编码智能体', runtime:'AI Agent 适配器',
      duty:'加载上下文 / 检索代码库 / 生成结构化产出 / 写测试与实现',
      simulated:true, note:'演示模拟主体：原型不调用真实模型，步骤与结果由流程逻辑模拟生成'},
    toolchain:{id:'ci-runner-01', kind:'toolchain', name:'CI 验证与签名服务', runtime:'ci-runner-01',
      duty:'执行测试 / Lint / 覆盖率 / 一致性扫描 / 越界检测 / 签名回传证据',
      simulated:true, note:'演示模拟主体：签名者与 commit/diff hash 由流程逻辑生成，未接入真实 CI'},
    system:{id:'flow-engine-01', kind:'system', name:'流程管控台编排器', runtime:'本系统状态机',
      duty:'按执行计划移交步骤 / 检出越界并升级人裁决',
      simulated:false, note:'本系统内部编排动作，不属于外部执行者'},
  };
  /* 《AI开发流程设计》2.3 G0：项目记忆 = 约束、编码规范、历史教训 */
  const MEMORY_CATEGORIES = ['约束','编码规范','历史教训'];
  /* 模拟文件：用于演示「人打开 PRD 阅读后再签门禁」的评审动作，不落真实仓库 */
  const FILE_META = {
    G0:{path:'docs/context/Context-Brief.md', kind:'上下文摘要', reviewer:'发起人 / 架构负责人'},
    G1:{path:'docs/prd/PRD-短信验证码登录.md', kind:'需求文档 PRD', reviewer:'产品 / 发起人'},
    G2:{path:'docs/design/Plan-短信验证码登录.md', kind:'实现计划 Plan', reviewer:'架构负责人'},
    G3:{path:'docs/plan/Task-Breakdown.md', kind:'Task 拆解清单', reviewer:'研发负责人'},
    G4:{path:'docs/review/Diff-变更说明.md', kind:'Diff / 变更说明', reviewer:'Reviewer'},
    G5:{path:'docs/qa/验证报告草稿.md', kind:'验证报告', reviewer:'测试负责人'},
    G6:{path:'docs/review/AI预审清单.md', kind:'AI 预审清单', reviewer:'Reviewer'},
    G7:{path:'docs/qa/AC用例矩阵.md', kind:'用例矩阵', reviewer:'测试负责人'},
    G8:{path:'docs/release/CHANGELOG.md', kind:'Changelog / 发布单', reviewer:'发布负责人'},
    G9:{path:'docs/ops/告警诊断报告.md', kind:'运维诊断报告', reviewer:'值班负责人'},
    G10:{path:'docs/retro/候选记忆规则.md', kind:'复盘记录', reviewer:'记忆确认人'},
    test_code:{path:'tests/auth/__task__.test.ts', kind:'测试代码', reviewer:'Reviewer'},
  };
  function byteLen(str){
    let n=0; for(let i=0;i<str.length;i++) n += str.charCodeAt(i)>255?3:1;
    return n;
  }
  /* 由工件的真实结构化数据展开成一份可读的模拟文件；内容不造假来源，明确标注演示 */
  function buildFile(s,a){
    const meta=FILE_META[a.type]||FILE_META[a.phase]||{path:'docs/产出物.md',kind:'文档',reviewer:'人'};
    const tm=a.title.match(/T\d+/)||['task'];
    const path=meta.path.replace('__task__',tm[0]);
    const ph=PHASES.find(x=>x.id===a.phase)||{name:a.phase,todo:[],criteria:[],gate:''};
    const L=[
      '# '+a.title,'',
      '> 演示模拟文件：由 AI Agent 在本流程中产出，用于模拟人评审时「打开文件阅读 → 回到审批台签字」的动作。',
      '> 非真实仓库文件；正文由该工件的结构化数据展开生成，元信息取自流程状态。','',
      '## 1. 文档元信息','',
      '| 项 | 值 |','| --- | --- |',
      '| 文件路径 | `'+path+'` |',
      '| 文档类型 | '+meta.kind+' |',
      '| 所属阶段 | '+a.phase+' '+ph.name+' |',
      '| 工件 ID | '+a.id+' |',
      '| 版本 | v'+a.version+' |',
      '| 内容哈希 | `'+a.hash+'` |',
      '| 产出者 | '+a.producer+' |',
      '| 建议评审人 | '+meta.reviewer+' |',
      '| 生成时间 | '+new Date(a.ts).toLocaleString('zh-CN')+' |',
      '| 门禁 | '+ph.gate+' |','',
      '## 2. 正文（结构化产出展开）','',
      '```json', JSON.stringify(a.data,null,2), '```','',
      '## 3. 本阶段要做的事','',
    ].concat(ph.todo.length?ph.todo.map(x=>'- '+x):['- （阶段定义未提供）'],[
      '', '## 4. 通过标准 / 评审清单','',
    ]).concat(ph.criteria.length?ph.criteria.map((x,i)=>'- [ ] '+x):['- （阶段定义未提供）'],[
      '', '## 5. 签署','',
      '- 当前状态：等待人在「审批台」签署门禁。',
      '- AI 附带的「已自测全绿」属于自报声明，系统不采信；只有工具链签名并绑定 commit / diff hash 的证据才解锁门禁。',
      '- 本文件为演示模拟产物，不代表真实 Git 仓库内容。','',
    ]);
    const content=L.join('\n');
    // 文件内容本体经存储插件外置，file 只保留引用与元信息
    const fref=putRef(s,'file/'+a.id+'.md', content);
    return {path, name:path.split('/').pop(), kind:meta.kind, reviewer:meta.reviewer,
      encoding:'utf-8', sizeBytes:fref.sizeBytes, lineCount:L.length,
      ref:{uri:fref.uri, hash:fref.hash},
      simulated:true, generatedFrom:'artifact:'+a.id, hash:fref.hash};
  }

  function hash(str){
    let h = 2166136261;
    for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h,16777619); }
    return (h>>>0).toString(16).padStart(8,'0').slice(0,8) + 'a3';
  }
  /* ---- 内容外置（引用化）：系统状态里只放 {uri,hash,sizeBytes}，内容本体经 GKSTORE 插件写入外部存储 ----
     四类内容本体一律外置：工件结构化数据 / 模拟文件内容 / 证据载荷 / 执行凭证。
     读取：同会话内可同步 hydrate（写缓存命中）；跨会话且插件为异步时由 UI 走 read() 拉取。 */
  const STORE = (typeof GKSTORE!=='undefined') ? GKSTORE : null;
  let NSC = 0;                                   // 外部存储路径命名空间计数器（各实例内容互不覆盖）
  function putRef(s, path, content){
    const p = ((s && s.ns) ? s.ns + '/' : '') + path;
    if(STORE) return STORE.put(p, typeof content==='string'?content:JSON.stringify(content,null,1));
    const str = typeof content==='string'?content:JSON.stringify(content,null,1);
    return {uri:'gk://'+p, hash:hash(str), sizeBytes:str.length};
  }
  function fromRef(ref){ // {uri,hash} → 解析后的内容对象；同步取不到时返回 null（由 UI 异步 read）
    if(!ref||!ref.uri) return null;
    const c = STORE ? STORE.hydrate(ref) : null;
    if(c===null||c===undefined) return null;
    try{ return JSON.parse(c); }catch(e){ return c; }
  }
  function artData(a){ return a.data!==undefined ? a.data : fromRef(a.ref); }        // 工件结构化数据
  function evData(e){ return e.data!==undefined ? e.data : fromRef(e.ref); }         // 证据载荷
  function fileContent(a){ return a.file ? (a.file.content!==undefined?a.file.content:(STORE?STORE.hydrate(a.file.ref):null)) : null; }
  function getReceipt(t){ return t.receipt!==undefined ? t.receipt : fromRef(t.receiptRef); }
  function nid(s,prefix){ return prefix + '-' + String(s.seq++).padStart(3,'0'); }
  function log(s,actor,action,target,detail,extra){
    const e={id:nid(s,'E'), ts:Date.now(), actor, action, target, detail:String(detail||'')};
    if(extra) Object.assign(e,extra);
    s.events.push(e);
    return e.id;
  }
  function deny(s,actor,action,pid){
    log(s,'system','PERMISSION_DENIED',pid,'身份 '+actor+' 尝试 '+action+' 被拒绝：不属于该主体');
    return {ok:false,msg:'权限拒绝：'+action+' 不属于该主体的动作'};
  }
  function createState(round, carried){
    const s = {
      version:1, round:round||1, seq:1, phaseIdx:0, ns:'t'+(++NSC),
      artifacts:[], evidences:[], traces:[], acs:[], plan:null, tasks:[], taskIdx:0,
      taskStep:{}, reviewNotes:[], failCount:{}, escalated:{}, outOfScope:{},
      memories:(carried||[]).map(m=>Object.assign({},m)),
      events:[], approvals:[], gateAttempts:{}, gateStatus:{}, skipped:{},
      aiSuggestions:0, reworks:0, coverageDrop:false,
      lastAiSubmitAt:null, startedAt:Date.now(), finishedAt:null,
    };
    log(s,'system','ROUND_STARTED','R'+s.round,'第 '+s.round+' 轮流程启动；已继承 '+s.memories.length+' 条生效项目记忆');
    return s;
  }
  function cur(s){ return PHASES[s.phaseIdx] || null; }
  function activeMemory(s){ return s.memories.filter(m=>m.status==='active'); }
  function currentTask(s){ return s.tasks[s.taskIdx] || null; }

  /* ---- G4 内层循环：依赖图 + 批次并发 + 独立评审 ----
     依据《AI开发流程设计》2.3 G3「每个 Task 粒度 = 可独立验证；标注依赖关系」与 G4「Review 每个 Task 的 Diff」。
     并发判据（两条同时成立才可同批并行）：
       ① 依赖已满足：t.deps 里的前置 Task 都已被 Review 通过；
       ② 文件范围不重叠：scope / diff 没有公共文件，否则两个 Task 的 Diff 会互相污染，越界检测也无法归属。
     工具链侧仍按 Task 串行签名：绿测与越界检测都绑定该 Task 自己的 commit / diff hash，
     同一时刻只能有一个 Task 在树上，否则无法判定「是谁的改动让测试变绿」。跨 Task 集成由 G5 全量回归兜底。 */
  function taskById(s,id){ return s.tasks.filter(t=>t.id===id)[0]||null; }
  function taskStepOf(s,t){ return s.taskStep[t.id]||{test:false,red:false,impl:false,green:false,review:'pending',verify:false}; }
  function depsSatisfied(s,t){
    return (t.deps||[]).every(d=>{ const p=taskById(s,d); return !p || (s.taskStep[d]&&s.taskStep[d].review==='ok'); });
  }
  function filesOverlap(a,b){
    const fa=(a.scope||[]).concat(a.diff||[]), fb=(b.scope||[]).concat(b.diff||[]);
    return fa.some(f=>fb.indexOf(f)>=0);
  }
  /* 当前批次：依赖已满足 + 文件互不重叠、且**仍有待执行步骤**的 Task，可并行执行。
     「已产出 Diff 待签字」不等于「执行中」—— 那种 Task 还需要人独立评审，
     若把它排除在批次外，一旦该 Task 熔断被裁决、或需要重跑，就再也生成不出执行计划。 */
  function taskNeedsWork(s,t){
    const st=s.taskStep[t.id];
    if(!st) return true;                                  // 未开工
    if(st.review==='ok') return false;                     // 已签字
    if(st.review==='rejected') return true;                // 被打回，需按意见重做
    if(st.test&&st.red&&st.impl&&st.green) return false;   // 证据齐备，只等人签字
    return true;                                           // 链上还有步骤没跑
  }
  function readyBatch(s){
    const pend=s.tasks.filter(t=>{
      if(s.escalated[t.id]) return false;                   // 已熔断冻结
      if(!taskNeedsWork(s,t)) return false;
      return depsSatisfied(s,t);
    });
    const batch=[];
    pend.forEach(t=>{ if(batch.every(b=>!filesOverlap(b,t))) batch.push(t); });
    return batch;
  }
  /* 批次内所有待执行 Task 的 ID 集合 */
  function batchIds(s){ return readyBatch(s).map(t=>t.id); }
  /* 全部 Task 是否都已签字 —— G4 门禁判据 */
  function allTasksReviewed(s){
    return s.tasks.length>0 && s.tasks.every(t=>s.taskStep[t.id]&&s.taskStep[t.id].review==='ok');
  }
  /* 待人 Review 的 Task（已出 Diff + 绿测 + 越界检测齐备），按依赖顺序返回 */
  function tasksAwaitingReview(s){
    return s.tasks.filter(t=>{
      const st=s.taskStep[t.id]; if(!st) return false;
      if(st.review==='ok') return false;
      if(s.escalated[t.id]) return false;
      if(!st.green||!st.impl) return false;
      return s.evidences.some(e=>e.taskId===t.id&&e.type==='out_of_scope');
    });
  }

  function buildArtifact(s,pid){
    const mem = activeMemory(s);
    switch(pid){
      case 'G0': return {
        title:'Context Brief · 登录验证码改造',
        data:{代码位置:['src/auth/AuthService.ts','src/api/login.ts'], 既有约定:'错误码统一走 ApiError，禁止直接抛字符串',
          风险点:'历史模块 src/legacy/bridge.js 与登录链路耦合，改动需评审',
          已加载项目记忆:mem.map(m=>m.text), 任务背景:'新增短信验证码登录，需兼容原密码登录', 上下文完整性:'人待确认'}
      };
      case 'G1': s.acs = AC_TEMPLATE.map(a=>Object.assign({},a)); return {
        title:'PRD · 短信验证码登录',
        data:{目标:'支持手机号 + 验证码登录', 验收标准:s.acs, 标注缺失项:['未定义海外手机号'], 标注矛盾项:[]}
      };
      case 'G2': s.plan = {
        chosen:'方案 B：复用 AuthService，新增验证码校验层',
        alternatives:[{方案:'A · 重写认证模块', 改动面:'大', 风险:'高', 工作量:'5d'},{方案:'B · 增量校验层', 改动面:'中', 风险:'低', 工作量:'2d'},{方案:'C · 网关侧拦截', 改动面:'小', 风险:'中', 工作量:'3d'}],
        files:['src/auth/AuthService.ts','src/auth/SmsCode.ts','src/api/login.ts'],
        acMap:{'AC-01':'src/auth/SmsCode.ts','AC-02':'src/api/login.ts','AC-03':'src/auth/SmsCode.ts'},
        risks:['限流依赖 Redis 可用性','legacy/bridge.js 为遗留耦合，本次不改']
      }; return {title:'实现计划 Plan · 方案 B', data:s.plan};
      case 'G3': s.tasks = TASK_TEMPLATE.map(t=>Object.assign({},t,{scope:t.scope.slice(),acs:t.acs.slice(),diff:t.diff.slice(),deps:(t.deps||[]).slice()}));
        s.tasks.forEach(t=>{ s.taskStep[t.id]={test:false,red:false,impl:false,green:false,review:'pending',verify:false}; s.failCount[t.id]=0; s.escalated[t.id]=false; });
        return {title:'Task 清单（'+s.tasks.length+' 项，均可独立验证）',
          data:{tasks:s.tasks.map(t=>({id:t.id,目标:t.title,涉及文件:t.scope,验证方式:t.verify,覆盖AC:t.acs,依赖前置:t.deps||[]})),
            依赖关系:s.tasks.map(t=>t.id+(t.deps&&t.deps.length?'←'+t.deps.join('/'):'（无依赖）')).join('，'),
            并发说明:'依赖已满足且改动文件互不重叠的 Task 可同批并行；评审单位是单个 Task，各自独立签字'}};
      case 'G5': return {title:'验证报告草稿', data:{结论:'待工具链证据确认', 范围:'全量回归 + 静态检查 + 覆盖率', 遗留问题:[]}};
      case 'G6': return {title:'AI 预审清单', data:{风格一致性:'通过', 命名:'通过', 潜在bug:'2 处待人工确认', 安全:'未发现高危', 需人终审:['业务正确性','架构合理性']}};
      case 'G7': return {title:'验收标准用例矩阵', data:{matrix:s.acs.map(a=>({AC:a.id, 用例:['正向','边界','异常'], 判据:a.testable})), 覆盖:s.acs.length+'/'+s.acs.length}};
      case 'G8': return {title:'Changelog + 发布单（预填）', data:{版本:'v1.4.0-rc.1', 变更:['新增短信验证码登录','补充限流与重放保护'], 发布单:'待人签署', 回滚方案:'切回 v1.3.9'}};
      case 'G9': return {title:'告警诊断报告 + 处置建议', data:{告警聚类:'/sms/send 超时 12 条 → 1 个事件', 初步定位:'关联本次发布 diff 与 Redis 连接池日志', 建议:['扩容连接池','必要时回滚'], 重大操作:'需人批准'}};
      case 'G10': {
        const notes = s.reviewNotes;
        const texts = notes.length
          ? notes.map(n=>'约束：'+n.pid+' 阶段出现「'+n.reason+'」时，AI 提交前须自行检查并规避')
          : ['约束：本轮无 Review 打回，保留现有 AC 结构化模板与 Plan 文件清单粒度'];
        // 打回后重跑 G10 时按文本去重，避免同一条教训重复生成候选记忆
        const exists=new Set(s.memories.filter(m=>m.round===s.round).map(m=>m.text));
        texts.filter(text=>!exists.has(text)).forEach((text,i)=>s.memories.push({
          id:nid(s,'M'), text,       status:'candidate', source:notes.length?notes[Math.min(i,notes.length-1)].pid+' 打回':'G10 归纳（本轮无打回）',
          category:'历史教训', scope:'全局', hits:0, round:s.round, ts:Date.now()
        }));
        return {title:'候选记忆规则（'+texts.length+' 条）', data:{候选规则:texts, 来源:notes.length?notes.map(n=>n.reason):['本轮事件日志'], 待办:'需人在「记忆确认」页确认入库或撤销'}};
      }
      default: return {title:pid+' 阶段产出', data:{}};
    }
  }
  function buildEvidence(s,pid){
    switch(pid){
      case 'G0': return {代码库文件数:1428, 索引版本:'idx-'+hash(pid+s.round), 结果:'OK'};
      case 'G1': return {验收标准数:s.acs.length, 可测试:s.acs.filter(a=>a.testable).length, 矛盾项:0, 缺失项:1, 结果:'PASS'};
      case 'G2': return {改动面文件:s.plan?s.plan.files.length:0, 方案数:3, 依赖影响:'无新增外部依赖', 结果:'PASS'};
      case 'G3': return {Task数:s.tasks.length, 全部含验证方式:s.tasks.every(t=>t.verify), AC覆盖:['AC-01','AC-02','AC-03'], 结果:'PASS'};
      case 'G5': s.coverageDrop=false; return {全量回归:'1286 passed / 0 failed', 静态检查:'0 error / 0 warning', 覆盖率:'82.1% → 84.3%（未下降）', 结果:'PASS'};
      case 'G6': return {静态分析复核:'0 high / 1 medium', 结果:'PASS'};
      case 'G7': return {用例总数:s.acs.length*3, 通过:s.acs.length*3, 失败:0, AC覆盖:s.acs.length+'/'+s.acs.length, 结果:'PASS'};
      case 'G8': return {产物校验:'sha256 一致', 预发冒烟:'PASS', 结果:'PASS'};
      case 'G9': return {告警聚类:'12 → 1', 变更关联:'v1.4.0-rc.1', 结果:'PASS'};
      case 'G10': return {事件总数:s.events.length, 门禁审批数:s.approvals.length, 打回数:s.reviewNotes.length, 结果:'PASS'};
      default: return {结果:'PASS'};
    }
  }

  function aiSubmit(s,role){
    const p = cur(s);
    if(!p) return {ok:false,msg:'本轮流程已结束，可开启下一轮'};
    if(role!=='ai') return deny(s,role,'提交 AI 产出',p.id);
    if(p.id==='G4') return {ok:false,msg:'G4 是逐 Task 实现循环，由自动执行按 Task 推进'};
    if(s.artifacts.some(a=>a.phase===p.id && a.kind==='ai')) return {ok:false,msg:'该阶段 AI 产出已提交，等待工具链签名与人工审批'};
    const built = buildArtifact(s,p.id);
    const art = {id:nid(s,'A'), phase:p.id, kind:'ai', type:p.ai, title:built.title, version:1,
      hash:hash(p.id+JSON.stringify(built.data)+s.round), producer:'AI Agent', ts:Date.now(),
      selfReport:'已自测全绿（不构成证据）'};
    // 工件结构化数据外置：状态里只留引用
    const dref=putRef(s,'artifact/'+art.id+'.json', built.data);
    art.ref={uri:dref.uri, hash:dref.hash, sizeBytes:dref.sizeBytes};
    art.file=buildFile(s,art);   // 每份产出都登记一份可点开的模拟文件，用于模拟人评审
    s.artifacts.push(art);
    s.aiSuggestions++;
    s.lastAiSubmitAt = Date.now();
    log(s,'ai','ARTIFACT_SUBMITTED',p.id,built.title+' · 附自报声明「已自测全绿」，系统不采信');
    if(p.id==='G10') log(s,'ai','MEMORY_CANDIDATE',p.id,'已生成候选记忆规则，等待人确认');
    return {ok:true,msg:'AI 已提交 '+p.id+' 产出：'+built.title};
  }
  function toolSubmit(s,role){
    const p = cur(s);
    if(!p) return {ok:false,msg:'本轮流程已结束'};
    if(role!=='toolchain') return deny(s,role,'签名回传证据',p.id);
    if(p.id==='G4') return {ok:false,msg:'G4 的证据由实现循环逐 Task 产生'};
    if(s.evidences.some(e=>e.phase===p.id && e.kind==='stage')) return {ok:false,msg:'该阶段证据已由工具链签名回传'};
    const data = buildEvidence(s,p.id);
    const ev = {id:nid(s,'V'), phase:p.id, kind:'stage', type:'stage_evidence', title:p.ev,
      source:'toolchain', signer:'ci-runner-01', commitHash:hash(p.id+s.round+'commit'),
      diffHash:hash(p.id+s.round+'diff'), result:'PASS', ts:Date.now()};
    const eref=putRef(s,'evidence/'+ev.id+'.json', data);   // 证据载荷外置，只留引用
    ev.ref={uri:eref.uri, hash:eref.hash, sizeBytes:eref.sizeBytes};
    s.evidences.push(ev);
    log(s,'toolchain','EVIDENCE_SIGNED',p.id,p.ev+' · 签名 ci-runner-01 · 绑定 diff '+ev.diffHash);
    return {ok:true,msg:'工具链已签名回传 '+p.id+' 证据：'+p.ev};
  }

  function autoCheck(s){
    const p = cur(s);
    if(!p) return {items:[{label:'本轮流程已完成',ok:true,why:''}],passed:true};
    const hasArt = s.artifacts.some(a=>a.phase===p.id && a.kind==='ai');
    const hasEv = s.evidences.some(e=>e.phase===p.id && e.kind==='stage');
    const items = [];
    if(p.id==='G4'){
      const n=s.tasks.length;
      const ready=allTasksReviewed(s);
      items.push({label:n+' 个 Task 的 Diff 均通过人 Review（可独立评审，不必等前一个）',ok:ready,why:ready?'':'由人在「循环 Review」页逐 Task 签字'});
      const unexplained=s.tasks.some(t=>{const o=s.outOfScope[t.id]; return o && o.files.length && !o.explanation;});
      items.push({label:'无未说明的越界改动',ok:!unexplained,why:unexplained?'Plan 之外的文件改动必须人工填写理由':'自动比对 Diff 文件集 − Plan 改动清单'});
      const frozen=s.tasks.some(t=>s.escalated[t.id]);
      items.push({label:'无未裁决的失败熔断',ok:!frozen,why:frozen?'自测失败超过 '+FAIL_LIMIT+' 次，需人裁决':'失败即停计数正常'});
      const signed=s.tasks.length>0 && s.tasks.every(t=>
        s.evidences.some(e=>e.taskId===t.id && e.type==='verify_green') &&
        s.evidences.some(e=>e.taskId===t.id && e.type==='out_of_scope'));
      items.push({label:'每个 Task 均有工具链签名的绿测与越界检测证据',ok:signed,why:signed?'':'证据只能由工具链签名，AI 自报无效'});
    } else {
      items.push({label:'AI 已提交阶段产出：'+p.ai,ok:hasArt,why:hasArt?'':'由上一道人工授权自动执行完成'});
      items.push({label:'工具链已签名回传证据：'+p.ev,ok:hasEv,why:hasEv?'':'由人工授权后的自动执行完成；AI 自报「全绿」不构成证据'});
    }
    switch(p.id){
      case 'G0': {
        const n = activeMemory(s).length;
        items.push({label:'项目记忆已加载进上下文（当前 '+n+' 条生效）',ok:true,why:n?'G10 回流规则已注入本轮 G0':'首轮暂无历史记忆，G10 后将产生'});
        break;
      }
      case 'G1': items.push({label:'验收标准逐条可测试（≥3 条且含判据）',ok:s.acs.length>=3 && s.acs.every(a=>a.testable),why:'Spec 先行：AC 是后续全部验证的锚点'}); break;
      case 'G2': items.push({label:'Plan 与全部验收标准一一对应',ok:!!s.plan && s.acs.every(a=>!!(s.plan.acMap||{})[a.id]),why:'防止方案偏离需求'}); break;
      case 'G3': {
        const covered = s.acs.length>0 && s.acs.every(a=>s.tasks.some(t=>t.acs.indexOf(a.id)>=0));
        items.push({label:'Task 覆盖全部 AC，且每项有验证方式与文件范围',ok:s.tasks.length>=3 && covered && s.tasks.every(t=>t.verify&&t.scope.length),why:'粒度 = 可独立验证'});
        break;
      }
      case 'G5': items.push({label:'覆盖率未出现未说明的下降',ok:hasEv && !s.coverageDrop,why:'G5 门禁要求全绿且覆盖率不降'}); break;
      case 'G7': items.push({label:'用例矩阵覆盖全部验收标准',ok:hasEv && s.acs.length>0,why:'从 G1 的 AC 自动生成'}); break;
      case 'G10': {
        const pending = s.memories.filter(m=>m.round===s.round && m.status==='candidate').length;
        items.push({label:'候选记忆条目已由人确认（入库或撤销），剩 '+pending+' 条待处理',ok:hasArt && pending===0,why:'由人在「记忆确认」页完成'});
        break;
      }
    }
    return {items,passed:items.every(i=>i.ok)};
  }

  function approve(s,role){
    if(role!=='human'){
      log(s,'system','PERMISSION_DENIED',(cur(s)||{id:'GATE'}).id,'身份 '+role+' 尝试调用 approve 被拒绝：仅人有审批权');
      return {ok:false,msg:'权限拒绝：AI Agent / 工具链不具备 approve 权限（门禁制）'};
    }
    const c = autoCheck(s);
    if(!c.passed) return {ok:false,msg:'门禁未解锁：自动校验仍有 '+c.items.filter(i=>!i.ok).length+' 项未通过，不能审批'};
    const p = cur(s);
    if(!p) return {ok:false,msg:'本轮流程已结束'};
    const attempt = s.gateAttempts[p.id] || 1;
    const dur = s.lastAiSubmitAt ? Date.now()-s.lastAiSubmitAt : 0;
    s.approvals.push({phase:p.id,attempt,ok:true,ts:Date.now(),durationMs:dur});
    s.gateStatus[p.id]='approved';
    log(s,'human','GATE_APPROVED',p.id,p.gate+' · 第 '+attempt+' 次提交即通过 · 审批停留 '+Math.round(dur/1000)+'s');
    s.phaseIdx++;
    if(s.phaseIdx>=PHASES.length){
      s.finishedAt=Date.now();
      log(s,'system','ROUND_FINISHED','R'+s.round,'G0–G10 闭环完成，共 '+s.approvals.length+' 道门禁');
    }
    return {ok:true,msg:p.id+' 已由人签署放行'+(s.finishedAt?' · 本轮闭环完成，可开启下一轮验证记忆回流':'')};
  }
  function reject(s,role,reason){
    if(role!=='human'){
      log(s,'system','PERMISSION_DENIED',(cur(s)||{id:'GATE'}).id,'身份 '+role+' 尝试 reject 被拒绝');
      return {ok:false,msg:'权限拒绝：只有人能打回并裁决'};
    }
    const p = cur(s);
    if(!p) return {ok:false,msg:'本轮流程已结束'};
    const text = String(reason||'').trim();
    if(!text) return {ok:false,msg:'请填写打回意见：它会成为 G10 提炼项目记忆的输入'};
    s.gateAttempts[p.id]=(s.gateAttempts[p.id]||1)+1;
    if(p.id==='G1'||p.id==='G2') s.reworks++;
    s.reviewNotes.push({pid:p.id,reason:text,ts:Date.now()});
    s.artifacts=s.artifacts.filter(a=>!(a.phase===p.id&&a.kind==='ai'));
    s.evidences=s.evidences.filter(e=>!(e.phase===p.id&&e.kind==='stage'));
    if(p.id==='G4'){
      // 打回 G4 门禁 = 全部 Diff 需重新实现并重新 Review，否则重跑计划为空、打回没有实际效果
      s.taskIdx=0;
      s.tasks.forEach(t=>{
        s.taskStep[t.id]={test:false,red:false,impl:false,green:false,review:'pending',verify:false};
        s.failCount[t.id]=0; s.escalated[t.id]=false; delete s.outOfScope[t.id];
      });
      s.evidences=s.evidences.filter(e=>!(e.phase==='G4'&&e.kind==='task'));
      log(s,'system','G4_ROLLED_BACK','G4','门禁整体打回：'+s.tasks.length+' 个 Task 复位，需重新 TDD 与逐 Task Review');
    }
    s.memories.push({id:nid(s,'M'),text:'约束：'+p.id+' 阶段出现「'+text+'」时，AI 提交前须自行检查并规避',
      status:'candidate',source:p.id+' 打回',category:'历史教训',scope:p.id,hits:0,round:s.round,ts:Date.now()});
    log(s,'human','GATE_REJECTED',p.id,'打回意见：'+text+' · 已生成 1 条候选记忆');
    return {ok:true,msg:'已打回 '+p.id+'，意见已记录为候选记忆，已授权 AI 按意见自动重做'};
  }

  /* ---- 精简流程：普通任务可经人确认跳过个别阶段（例如不需要 G9 运维） ----
     跳过是一次正式的人工判断，不是漏做：门禁记录里记为 skipped 留痕，
     事件日志写入 PHASE_SKIPPED，度量与「x/11 门禁」口径不受影响。 */
  function skipPhase(s,role,reason){
    if(role!=='human') return deny(s,role,'精简跳过阶段',(cur(s)||{id:'GATE'}).id);
    const p=cur(s);
    if(!p) return {ok:false,msg:'本轮流程已结束，没有可跳过的阶段'};
    if(s.finishedAt) return {ok:false,msg:'本轮已闭环'};
    const attempt=s.gateAttempts[p.id]||1;
    s.approvals.push({phase:p.id,attempt,ok:true,skipped:true,ts:Date.now(),durationMs:0,
      reason:String(reason||'人工选择精简流程')});
    s.gateStatus[p.id]='skipped';
    s.skipped[p.id]=true;
    log(s,'human','PHASE_SKIPPED',p.id,'精简流程：经人确认跳过 '+p.id+' '+p.name+'（'+p.gate+'）· 留痕原因：'+(reason||'人工选择精简流程'));
    s.phaseIdx++;
    if(s.phaseIdx>=PHASES.length){
      s.finishedAt=Date.now();
      log(s,'system','ROUND_FINISHED','R'+s.round,'G0–G10 闭环完成（含精简跳过），共 '+s.approvals.length+' 道门禁记录');
    }
    return {ok:true,msg:'已跳过 '+p.id+' '+p.name+'（精简留痕），进入下一阶段'};
  }

  /* ---- G4 内层循环：AI 与工具链动作严格按主体拆开 ---- */
  function aiTaskAction(s,role,which,taskId){
    const p=cur(s);
    if(!p||p.id!=='G4') return {ok:false,msg:'仅 G4 实现循环可写测试与实现'};
    if(role!=='ai') return deny(s,role,'产出测试 / 实现代码',p.id);
    const t=taskId?taskById(s,taskId):currentTask(s);
    if(!t) return {ok:false,msg:'所有 Task 已完成'};
    if(s.escalated[t.id]) return {ok:false,msg:'该 Task 已熔断冻结，请人先裁决'};
    const st=s.taskStep[t.id];
    let n=0;
    if((which==='test'||which==='all') && !st.test){
      st.test=true;
      const ta_={id:nid(s,'A'),phase:'G4',kind:'ai',type:'test_code',title:t.id+' 测试代码（先写测试）',version:1,
        hash:hash(t.id+'test'+s.round),producer:'AI Agent',ts:Date.now(),selfReport:'测试已编写'};
      const tref=putRef(s,'artifact/'+ta_.id+'.json',{对齐AC:t.acs,验证方式:t.verify});
      ta_.ref={uri:tref.uri,hash:tref.hash,sizeBytes:tref.sizeBytes};
      ta_.file=buildFile(s,ta_);
      s.artifacts.push(ta_);
      s.aiSuggestions++;
      log(s,'ai','TEST_WRITTEN',t.id,'先写测试 · 对齐 '+t.acs.join(','));
      n++;
      if(which==='test') return {ok:true,msg:t.id+' 已提交测试代码 · 下一步：工具链回传红阶段结果'};
    }
    if(which==='impl'||which==='all'){
      if(!st.red) return {ok:false,msg:'TDD 顺序：需先由工具链回传「红」阶段测试证据，AI 才能写实现'};
      if(!st.impl){
        st.impl=true;
        const out=t.diff.filter(f=>t.scope.indexOf(f)<0);
        s.outOfScope[t.id]={files:out,explanation:''};
        const da_={id:nid(s,'A'),phase:'G4',kind:'ai',type:'diff',title:t.id+' 实现 Diff + 变更说明',version:1,
          hash:hash(t.id+JSON.stringify(t.diff)+s.round),producer:'AI Agent',ts:Date.now(),
          selfReport:'已自测全绿（不构成证据）'};
        const dref=putRef(s,'artifact/'+da_.id+'.json',{目标:t.title,改动文件:t.diff,计划内文件:t.scope,越界文件:out,变更说明:'按 Task 实现'});
        da_.ref={uri:dref.uri,hash:dref.hash,sizeBytes:dref.sizeBytes};
        da_.file=buildFile(s,da_);
        s.artifacts.push(da_);
        s.aiSuggestions++;
        log(s,'ai','DIFF_SUBMITTED',t.id,'提交 Diff · 文件 '+t.diff.length+' 个'+(out.length?' · 检出越界 '+out.join(','):''));
        n++;
      }
    }
    return n?{ok:true,msg:t.id+' 完成 '+n+' 项 AI 动作 · 下一步：工具链回传绿测与越界检测'}
            :{ok:false,msg:'本 Task 的 AI 动作已全部完成，等待其他主体'};
  }
  function toolTaskAction(s,role,which,taskId){
    const p=cur(s);
    if(!p||p.id!=='G4') return {ok:false,msg:'仅 G4 实现循环可回传测试与检测证据'};
    if(role!=='toolchain') return deny(s,role,'签名回传测试 / 检测结果',p.id);
    const t=taskId?taskById(s,taskId):currentTask(s);
    if(!t) return {ok:false,msg:'所有 Task 已完成'};
    if(s.escalated[t.id]) return {ok:false,msg:'该 Task 已熔断冻结，请人先裁决'};
    const st=s.taskStep[t.id],tid=t.id;
    let n=0;
    if((which==='red'||which==='all') && !st.red){
      if(!st.test) return {ok:false,msg:'等待 AI Agent 先写测试'};
      st.red=true;
      const ev1={id:nid(s,'V'),phase:'G4',kind:'task',taskId:tid,type:'verify_red',title:'单测结果：红（预期失败）',
        source:'toolchain',signer:'ci-runner-01',commitHash:hash(tid+'red'+s.round),diffHash:hash(tid+'diff'+s.round),
        result:'FAIL(EXPECTED)',ts:Date.now()};
      const r1=putRef(s,'evidence/'+ev1.id+'.json',{阶段:'TDD 红',失败:'实现尚未存在'});
      ev1.ref={uri:r1.uri,hash:r1.hash,sizeBytes:r1.sizeBytes};
      s.evidences.push(ev1);
      log(s,'toolchain','EVIDENCE_SIGNED',tid,'TDD 红阶段：测试失败（预期）');
      n++;
      if(which==='red') return {ok:true,msg:tid+' 红阶段证据已签名 · 下一步：AI Agent 写实现'};
    }
    if((which==='green'||which==='all') && !st.green){
      if(!st.impl) return {ok:false,msg:'等待 AI Agent 提交实现 Diff'};
      st.green=true;
      const ev2={id:nid(s,'V'),phase:'G4',kind:'task',taskId:tid,type:'verify_green',title:'单测 + Lint：绿',
        source:'toolchain',signer:'ci-runner-01',commitHash:hash(tid+'green'+s.round),diffHash:hash(tid+'diff'+s.round),
        result:'PASS',ts:Date.now()};
      const r2=putRef(s,'evidence/'+ev2.id+'.json',{单测:'通过',Lint:'0 error',耗时:'12.4s'});
      ev2.ref={uri:r2.uri,hash:r2.hash,sizeBytes:r2.sizeBytes};
      s.evidences.push(ev2);
      log(s,'toolchain','EVIDENCE_SIGNED',tid,'TDD 绿阶段：单测与 Lint 全绿');
      n++;
      if(which==='green') return {ok:true,msg:tid+' 绿测证据已签名 · 下一步：越界检测'};
    }
    if(which==='oos'||which==='all'){
      if(!s.evidences.some(e=>e.taskId===tid&&e.type==='out_of_scope')){
        if(!st.green) return {ok:false,msg:'等待绿测证据回传'};
        const out=(s.outOfScope[tid]||{files:[]}).files;
        const ev3={id:nid(s,'V'),phase:'G4',kind:'task',taskId:tid,type:'out_of_scope',title:'越界改动检测报告',
          source:'toolchain',signer:'ci-runner-01',commitHash:hash(tid+'oos'+s.round),diffHash:hash(tid+'diff'+s.round),
          result:out.length?'WARN':'PASS',ts:Date.now()};
        const r3=putRef(s,'evidence/'+ev3.id+'.json',{比对:'Diff 文件集 − Plan 改动清单',越界文件:out,处理:out.length?'需人工填写说明':'无需说明'});
        ev3.ref={uri:r3.uri,hash:r3.hash,sizeBytes:r3.sizeBytes};
        s.evidences.push(ev3);
        log(s,'toolchain','EVIDENCE_SIGNED',tid,out.length?'越界检测：发现 '+out.join(',')+'，需人工说明':'越界检测：无越界改动');
        n++;
      }
    }
    return n?{ok:true,msg:tid+' 完成 '+n+' 项工具链签名 · 下一步：人 Review Diff'}
            :{ok:false,msg:'当前可签名的证据已齐备，等待人 Review'};
  }
  function simulateFail(s,role,taskId){
    const p=cur(s);
    if(!p||p.id!=='G4') return {ok:false,msg:'失败熔断仅作用于 G4 实现循环'};
    if(role!=='toolchain') return deny(s,role,'模拟自测失败',p.id);
    const t=taskId?taskById(s,taskId):currentTask(s);
    if(!t) return {ok:false,msg:'没有进行中的 Task'};
    s.failCount[t.id]=(s.failCount[t.id]||0)+1;
    log(s,'toolchain','SELFTEST_FAILED',t.id,'自测失败第 '+s.failCount[t.id]+' 次（上限 '+FAIL_LIMIT+'）');
    if(s.failCount[t.id]>=FAIL_LIMIT){
      s.escalated[t.id]=true;
      log(s,'system','ESCALATED',t.id,'失败即停：超过 '+FAIL_LIMIT+' 次，Task 冻结，升级人裁决');
      return {ok:true,msg:'失败已达 '+FAIL_LIMIT+' 次，Task 已熔断冻结，请人裁决'};
    }
    return {ok:true,msg:'模拟自测失败 '+s.failCount[t.id]+'/'+FAIL_LIMIT+' 次'};
  }
  function arbitrate(s,role,taskId){
    if(role!=='human') return deny(s,role,'裁决熔断异常','G4');
    const t=taskId?taskById(s,taskId):currentTask(s);
    if(!t) return {ok:false,msg:'没有进行中的 Task'};
    s.escalated[t.id]=false; s.failCount[t.id]=0;
    log(s,'human','HUMAN_ARBITRATION',t.id,'人裁决：重置失败计数，允许继续实现');
    return {ok:true,msg:'人已裁决 '+t.id+'，熔断解除'};
  }
  function explainOutOfScope(s,role,text,taskId){
    if(role!=='human') return deny(s,role,'填写越界改动说明','G4');
    const t=taskId?taskById(s,taskId):currentTask(s);
    if(!t) return {ok:false,msg:'没有进行中的 Task'};
    const o=s.outOfScope[t.id];
    if(!o||!o.files.length) return {ok:false,msg:'当前 Task 没有越界改动'};
    const v=String(text||'').trim();
    if(!v) return {ok:false,msg:'必须填写越界改动的理由'};
    o.explanation=v;
    log(s,'human','OUT_OF_SCOPE_EXPLAINED',t.id,'越界文件 '+o.files.join(',')+' · 人工说明：'+v);
    return {ok:true,msg:t.id+' 越界说明已留痕'};
  }
  /* 独立评审：人可以对**任意**已产出 Diff 的 Task 签字，不必等前一个 Task 走完。
     taskId 缺省时退回当前游标（兼容旧调用），有值时以它为准。
     签字只影响该 Task 自身；G4 门禁要求所有 Task 都签完才解锁。 */
  function reviewTask(s,role,decision,note,taskId){
    if(role!=='human') return deny(s,role,'Review Diff',(cur(s)||{id:'G4'}).id);
    const t=taskId?taskById(s,taskId):currentTask(s);
    if(!t) return {ok:false,msg:'所有 Task 已完成'};
    const st=s.taskStep[t.id];
    if(!st.green||!st.impl) return {ok:false,msg:t.id+' 尚未完成 TDD 与证据回传，请先恢复自动执行'};
    if(s.escalated[t.id]) return {ok:false,msg:t.id+' 已熔断，请先由人裁决'};
    const o=s.outOfScope[t.id];
    if(o&&o.files.length&&!o.explanation&&decision==='ok')
      return {ok:false,msg:t.id+' 越界改动未说明：'+o.files.join(',')+' · 请先填写理由'};
    if(decision==='ok'){
      st.review='ok';
      // 游标只在签字后推进到下一个未签字的 Task；已签字的 Task 记录在 st.review 上，不再依赖游标
      while(s.taskIdx<s.tasks.length&&s.taskStep[s.tasks[s.taskIdx].id]&&s.taskStep[s.tasks[s.taskIdx].id].review==='ok') s.taskIdx++;
      const left=s.tasks.filter(x=>!(s.taskStep[x.id]&&s.taskStep[x.id].review==='ok'));
      log(s,'human','DIFF_REVIEWED',t.id,'Review 通过 · 已签字'+(left.length?' · 另有 '+left.length+' 个 Task 独立待审':''));
      return {ok:true,msg:t.id+' Diff 通过人 Review'+(left.length
        ?' · 还有 '+left.length+' 个 Task 待独立评审（'+left.map(x=>x.id).join('、')+'）'
        :' · 全部 '+s.tasks.length+' 个 Task 已签字，可审批 G4 门禁')};
    }
    const text=String(note||'').trim()||'实现超出 Task 范围';
    st.review='rejected'; st.impl=false; st.green=false;
    s.evidences=s.evidences.filter(e=>!(e.taskId===t.id&&e.type==='out_of_scope'));
    const o2=s.outOfScope[t.id]; if(o2)o2.explanation='';
    s.reviewNotes.push({pid:'G4/'+t.id,reason:text,ts:Date.now()});
    s.memories.push({id:nid(s,'M'),text:'约束：'+t.id+' 出现「'+text+'」时，AI 修订前须自查并规避',status:'candidate',source:'G4/'+t.id+' 打回',category:'历史教训',scope:t.id,hits:0,round:s.round,ts:Date.now()});
    log(s,'human','DIFF_REJECTED',t.id,'打回意见：'+text+' · 已生成候选记忆');
    return {ok:true,msg:t.id+' 已打回，已授权 AI 按意见自动修订'};
  }
  function confirmMemory(s,id,role){
    if(role!=='human') return deny(s,role,'确认记忆入库','G10');
    const m=s.memories.find(x=>x.id===id);
    if(!m) return {ok:false,msg:'未找到该记忆条目'};
    m.status='active';
    log(s,'human','MEMORY_CONFIRMED',m.id,'规则已入库：'+m.text);
    return {ok:true,msg:'已确认入库，下轮 G0 将注入该约束'};
  }
  function revokeMemory(s,id,role){
    if(role!=='human') return deny(s,role,'否决记忆条目','G10');
    const m=s.memories.find(x=>x.id===id);
    if(!m) return {ok:false,msg:'未找到该记忆条目'};
    m.status='revoked';
    log(s,'human','MEMORY_REVOKED',m.id,'规则被否决，不进入项目记忆');
    return {ok:true,msg:'已否决该候选规则'};
  }

  /* ---- 触发后自动执行：生成执行计划并逐步回放 ---- */
  /* G4 批次并发：一个 Task 一条独立的 TDD 链，链内顺序恒定（先测 → 红 → 实现 → 绿 → 越界 → 变更说明）。
     批次内各 Task 的链**交错**执行 = 并行推进：它们改的是互不重叠的文件，互不阻塞。
     每个 Task 的工具链证据独立绑定自己的 commit / diff hash，所以「谁的改动让测试变绿」始终可归属；
     跨 Task 的集成回归由 G5 的全量回归兜底。 */
  function g4TaskChain(s,t){
    const st=s.taskStep[t.id]||{test:false,red:false,impl:false,green:false,review:'pending'};
    const chain=[];
    const add=(actor,step,detail,dur,fn)=>chain.push({actor,step,detail,dur:dur||200,fn:fn||null,taskId:t.id});
    if(!st.test){
      add('ai','分析 Task','读取 '+t.id+' 目标、文件范围与验收标准 '+t.acs.join(',')+'；加载项目记忆 '+activeMemory(s).length+' 条',260);
      add('ai','检索代码库','定位相关实现与既有约定，标记风险点',340);
      add('ai','先写测试','按「'+t.verify+'」生成测试代码',520,'aiTest');
    }
    if(!st.red){
      add('system','移交工具链',t.id+' 测试代码已提交，交由工具链执行',160);
      add('toolchain','执行测试（红）','运行单测：预期失败，确认测试有效',640,'toolRed');
    }
    if(!st.impl){
      // 被打回过 = 按人的意见修订；否则是 TDD 正常流程里的「红已就绪，该写实现」
      if(st.review==='rejected') add('ai','按意见修订实现','读取人打回原因，重新生成实现代码与 Diff',760,'aiImpl');
      else add('ai','写实现并提交 Diff','生成实现代码，输出 '+t.diff.length+' 个改动文件',880,'aiImpl');
    }
    if(!st.green) add('toolchain','单测 + Lint（绿）','单测与 Lint 全绿',680,'toolGreen');
    if(!s.evidences.some(e=>e.taskId===t.id&&e.type==='out_of_scope'))
      add('toolchain','越界改动检测','比对 Diff 文件集 − Plan 改动清单',330,'toolOos');
    if(st.impl||st.green) add('ai','整理变更说明','汇总 Diff、覆盖的验收标准与自报结论（自报不采信）',220);
    const out=(s.outOfScope[t.id]||{files:[]}).files;
    if(out.length&&!s.outOfScope[t.id].explanation) add('system','检出越界改动','需人填写说明：'+out.join(','),140);
    return chain;
  }
  function buildRunPlan(s){
    const p=cur(s);
    if(!p) return [];
    const plan=[];
    const add=(actor,step,detail,dur,fn,taskId)=>plan.push({actor,step,detail,dur:dur||200,fn:fn||null,taskId:taskId||null});
    if(p.id==='G4'){
      const batch=readyBatch(s);
      if(!batch.length) return [];
      // round-robin 交错：批次内各 Task 的链并行推进，但每条链内部顺序不变
      const chains=batch.map(t=>g4TaskChain(s,t));
      const maxLen=Math.max.apply(null,chains.map(c=>c.length).concat([0]));
      for(let i=0;i<maxLen;i++) chains.forEach(c=>{ if(c[i]) plan.push(c[i]); });
      return plan;
    }
    const mem=activeMemory(s).length;
    if(!s.artifacts.some(a=>a.phase===p.id&&a.kind==='ai')){
      add('ai','加载上下文','读取项目记忆 '+mem+' 条 · 加载代码库索引 · 应用既有约定',340);
      add('ai','检索代码库','定位相关文件与历史约束，标记风险点',480);
      add('ai','生成结构化产出','输出 '+p.ai,760,'aiSubmit');
      add('ai','自我检查','对照验收标准逐条自查，附自报「已自测全绿」（系统不采信）',300);
    }
    if(!s.evidences.some(e=>e.phase===p.id&&e.kind==='stage')){
      add('toolchain','执行机器验证','运行测试 / 静态检查 / 覆盖率 / 一致性扫描',700);
      add('toolchain','签名回传证据','ci-runner-01 签名，绑定 commit / diff hash',280,'toolSubmit');
    }
    return plan;
  }
  /* 授权单预览：算出「批准后实际会跑哪几步」，只读，不改状态。
     临时推进 phaseIdx 生成计划后立即还原，供审批人在签字前看清授权范围。 */
  function previewNextRun(s){
    const nx=PHASES[s.phaseIdx+1];
    if(!nx) return [];
    const keep=s.phaseIdx;
    let plan=[];
    try{ s.phaseIdx++; plan=buildRunPlan(s); }
    catch(e){ plan=[]; }
    finally{ s.phaseIdx=keep; }
    return plan;
  }
  /* G4 内层：预览「人签字后将自动跑哪几步」，只读，不改状态。
     批次语义：把**当前待评审**的 Task 临时视为已签字，再算下一批计划，然后还原。
     若当前没有待评审的 Task，则预览的就是仍在执行中的批次的剩余步骤。 */
  function previewNextTaskRun(s){
    if(!cur(s)||cur(s).id!=='G4') return [];
    const sign=tasksAwaitingReview(s).map(t=>t.id);
    const keep=JSON.parse(JSON.stringify(s.taskStep));
    let plan=[];
    try{
      sign.forEach(id=>{ if(s.taskStep[id]) s.taskStep[id].review='ok'; });
      plan=buildRunPlan(s);
    }
    catch(e){ plan=[]; }
    finally{ s.taskStep=keep; }
    return plan;
  }
  /* ---- 执行凭证：AI / 工具链每一步的「谁 / 何时 / 输入 / 怎么加载 / 输出 / 关联」 ----
     所有输入都在执行那一刻从真实状态读取，不硬编码内容；未接入的数据显式标注，不伪造。 */
  function inp(kind,label,source,items,extra){
    return Object.assign({kind,label,source,count:items.length,items},extra||{});
  }
  function memItems(s){
    return activeMemory(s).map(m=>({id:m.id, category:m.category||'未分类', text:m.text,
      source:m.source, scope:m.scope, hits:m.hits||0, round:m.round, status:m.status}));
  }
  function describeStep(s,st,ctx){
    const p=cur(s)||{id:'DONE',name:'已完成',todo:[],criteria:[],gate:'',ai:'',ev:''};
    // 并发执行时每个步骤归属各自的 Task，不依赖全局游标
    const t=st.taskId?taskById(s,st.taskId):currentTask(s), pid=p.id;
    const mem=memItems(s);
    const artOf=phase=>s.artifacts.filter(a=>a.phase===phase&&a.kind==='ai').map(a=>({id:a.id,title:a.title,hash:a.hash,file:a.file?a.file.path:null}));
    const evOf=phase=>s.evidences.filter(e=>e.phase===phase&&e.kind==='stage').map(e=>({id:e.id,title:e.title,result:e.result,diffHash:e.diffHash}));
    const inputs=[inp('phase_def','阶段定义（本步骤的依据）','LOGIC.PHASES['+s.phaseIdx+']',
      [{id:p.id,name:p.name,gate:p.gate,ai:p.ai,ev:p.ev,todo:p.todo,criteria:p.criteria}])];
    const generic={tool:(ACTORS[st.actor]||ACTORS.system).runtime, operation:st.step,
      params:{阶段:pid, 本轮:s.round}, basis:'《AI开发流程设计》2.3 各阶段 AI 职责 / 产出物 / 门禁'};
    let method=generic, note='';

    if(st.step==='加载上下文'||st.step==='分析 Task'){
      inputs.push(inp('project_memory','项目记忆 · 生效条目','S.memories[]',mem,{
        categories:MEMORY_CATEGORIES.map(c=>({name:c, loaded:mem.filter(m=>m.category===c).length,
          note:c==='历史教训'?'由 G10 经验回流产生，本原型真实写入':'属项目基线，本原型未接入外部知识库，不伪造条目'})),
        selector:'status === "active" && round <= S.round', orderBy:'hits DESC, id ASC',
        injectedInto:'Context Brief.已加载项目记忆'}));
      if(s.acs.length) inputs.push(inp('acceptance_criteria','验收标准 AC','S.acs[]',s.acs.map(a=>({id:a.id,text:a.text,testable:a.testable}))));
      if(s.plan&&s.plan.files) inputs.push(inp('plan_files','Plan 改动文件清单','S.plan.files',s.plan.files.map(f=>({path:f}))));
      if(s.tasks.length) inputs.push(inp('tasks','Task 清单','S.tasks[]',s.tasks.map(x=>({id:x.id,title:x.title,scope:x.scope,acs:x.acs,verify:x.verify}))));
      method={tool:'项目记忆加载器 / 上下文注入（演示模拟适配器）',
        operation:'读取生效项目记忆 → 按阶段与命中排序 → 注入本阶段上下文',
        selector:'S.memories[] 中 status="active" 且 round<=当前轮', orderBy:'hits DESC, id ASC',
        injectedInto:'Context Brief.已加载项目记忆',
        params:{阶段:pid, 本轮:s.round, 生效条目数:mem.length, 分类口径:MEMORY_CATEGORIES,
          同时读取:['S.acs[]','S.plan.files','S.tasks[]','LOGIC.PHASES['+s.phaseIdx+']']},
        basis:'《AI开发流程设计》2.3 G0「AI 加载项目记忆（约束、编码规范、历史教训）；检索相关代码与文档」'};
      note='项目记忆按文档分三类；本原型只真实承载「历史教训」（打回与复盘回流），其余两类需接项目基线，故如实显示为 0 条。';
    }else if(st.step==='检索代码库'){
      const brief=s.artifacts.find(a=>a.phase==='G0'&&a.kind==='ai');
      const briefData=brief?artData(brief):null;
      const loc=(briefData&&briefData.代码位置)||(s.plan&&s.plan.files)||(t?t.scope:[]);
      inputs.push(inp('code_locations','代码库索引命中位置',brief?'G0 Context Brief.data.代码位置':(s.plan?'S.plan.files':'S.tasks[].scope'),
        loc.map(f=>({path:f}))));
      if(briefData) inputs.push(inp('conventions','既有约定 / 风险点','G0 Context Brief.data',
        [{既有约定:briefData.既有约定,风险点:briefData.风险点}]));
      method={tool:'代码库索引检索（演示模拟适配器）',operation:'按阶段范围检索相关文件与既有约定',
        params:{索引版本:'idx-'+hash('G0'+s.round), 命中文件数:loc.length, 阶段:pid},
        basis:'《AI开发流程设计》2.3 G0「检索相关代码与文档」'};
    }else if(st.step==='生成结构化产出'||st.step==='自我检查'){
      inputs.push(inp('target_artifact','本阶段应产出','LOGIC.PHASES['+s.phaseIdx+']',[{type:p.ai,标准:p.criteria}]));
      const prev=s.phaseIdx>0?artOf(PHASES[s.phaseIdx-1].id):[];
      if(prev.length) inputs.push(inp('upstream_artifacts','上游阶段工件（作为输入）','S.artifacts[]',prev));
      if(s.acs.length) inputs.push(inp('acceptance_criteria','验收标准 AC','S.acs[]',s.acs.map(a=>({id:a.id,testable:a.testable}))));
      method={tool:(ACTORS.ai.runtime)+' · 结构化产出生成器',
        operation:st.step==='自我检查'?'对照 AC 逐条自查并附自报声明（系统不采信）':'按阶段定义生成结构化文档并登记模拟文件',
        params:{阶段:pid, 输出类型:p.ai, 上游工件数:prev.length},
        basis:'《AI开发流程设计》2.3 各阶段「AI 职责 / 产出物」'};
      if(st.step==='自我检查') note='AI 自报「已自测全绿」不构成证据，仅作提示；门禁只认工具链签名证据。';
    }else if(st.step==='执行机器验证'||st.step==='签名回传证据'){
      inputs.push(inp('verification_scope','机器验证范围','LOGIC.PHASES['+s.phaseIdx+']',[{证据类型:p.ev,判据:p.criteria}]));
      inputs.push(inp('artifacts_under_test','待验证工件','S.artifacts[]',artOf(pid)));
      if(ctx.newEvs.length) inputs.push(inp('evidence_payload','签名载荷','S.evidences[]（本步新建）',
        ctx.newEvs.map(e=>({id:e.id,result:e.result,commitHash:e.commitHash,diffHash:e.diffHash,data:evData(e)}))));
      method={tool:'ci-runner-01（演示模拟适配器）',
        operation:st.step==='签名回传证据'?'对验证结果签名，绑定 commit / diff hash 并回传':'运行测试 / 静态检查 / 覆盖率 / 一致性扫描',
        params:{阶段:pid, 签名者:'ci-runner-01', 绑定字段:['commitHash','diffHash','result']},
        basis:'《AI开发流程设计》2.5「AI 自报不算证据，工具链签名并绑定提交」'};
    }else if(st.step==='先写测试'){
      if(t) inputs.push(inp('task','当前 Task（测试依据）','S.tasks[id='+t.id+']',
        [{id:t.id,title:t.title,verify:t.verify,acs:t.acs,scope:t.scope,dependsOn:t.deps||[]}]));
      method={tool:(ACTORS.ai.runtime)+' · 测试生成器',operation:'先写测试并对齐 AC，等待工具链回传「红」',
        params:{TDD阶段:'红前', Task:t?t.id:null},basis:'《AI开发流程设计》2.5 TDD 纪律：先写测试，预期失败'};
    }else if(st.step==='写实现并提交 Diff'||st.step==='按意见修订实现'){
      if(t) inputs.push(inp('task_files','Task 文件范围与本次 Diff','S.tasks[id='+t.id+']',
        [{id:t.id,计划内文件:t.scope,改动文件:t.diff,越界文件:t.diff.filter(f=>t.scope.indexOf(f)<0)}]));
      const notes=s.reviewNotes.filter(n=>n.pid.indexOf('G4')===0);
      if(notes.length) inputs.push(inp('human_feedback','人的打回意见（修订依据）','S.reviewNotes[]',notes.map(n=>({pid:n.pid,reason:n.reason}))));
      const red=s.evidences.filter(e=>e.taskId===(t?t.id:'')&&e.type==='verify_red');
      if(red.length) inputs.push(inp('red_evidence','前置「红」阶段证据','S.evidences[]',red.map(e=>({id:e.id,result:e.result}))));
      method={tool:(ACTORS.ai.runtime)+' · 实现生成器',operation:'依据测试与反馈生成实现代码，输出 Diff + 变更说明',
        params:{Task:t?t.id:null, 改动文件数:t?t.diff.length:0},basis:'《AI开发流程设计》2.3 G4「先写测试 → 再写实现」'};
    }else if(st.step==='执行测试（红）'||st.step==='单测 + Lint（绿）'){
      const tst=s.artifacts.filter(a=>a.phase==='G4'&&a.type==='test_code'&&(!t||a.title.indexOf(t.id)===0));
      inputs.push(inp('test_code','待执行测试代码','S.artifacts[]',tst.map(a=>({id:a.id,title:a.title,hash:a.hash}))));
      if(ctx.newEvs.length) inputs.push(inp('test_result','本次执行结果（工具链签名）','S.evidences[]（本步新建）',
        ctx.newEvs.map(e=>({id:e.id,result:e.result,data:evData(e)}))));
      method={tool:'ci-runner-01（演示模拟适配器）',operation:'执行单测与 Lint 并签名回传结果',
        params:{TDD阶段:st.step.indexOf('红')>=0?'红（预期失败）':'绿（全绿）', Task:t?t.id:null},
        basis:'《AI开发流程设计》2.5 红绿测试证据由工具链产生'};
    }else if(st.step==='越界改动检测'){
      if(t){
        const out=t.diff.filter(f=>t.scope.indexOf(f)<0);
        inputs.push(inp('diff_vs_plan','Diff 文件集 − Plan 改动清单','S.tasks[].diff / .scope',
          [{计划内:t.scope,本次改动:t.diff,计划外改动:out}]));
      }
      if(ctx.newEvs.length) inputs.push(inp('oos_result','越界检测结果','S.evidences[]（本步新建）',
        ctx.newEvs.map(e=>({id:e.id,result:e.result,data:evData(e)}))));
      method={tool:'ci-runner-01 · 越界检测器（演示模拟适配器）',operation:'比对改动文件集与计划清单，命中则要求人说明',
        params:{Task:t?t.id:null},basis:'《AI开发流程设计》2.5 越界检测'};
    }else if(st.step==='移交工具链'||st.step==='检出越界改动'||st.step==='整理变更说明'){
      inputs.push(inp('handoff','移交 / 汇总所依据的当前状态','S',
        [{阶段:pid, 本阶段工件数:artOf(pid).length, 本阶段证据数:evOf(pid).length,
          Task:t?t.id:null, 越界:(s.outOfScope[t?t.id:'']||{files:[]}).files}]));
      method={tool:(ACTORS[st.actor]||ACTORS.system).runtime,operation:st.step,
        params:{阶段:pid},basis:'流程编排定义'};
    }else{
      note='该步骤由通用凭证兜底覆盖，确保任何自动动作都有可查记录。';
    }
    if(!ctx.newArts.length&&!ctx.newEvs.length&&!note) note='本步骤为读取 / 分析 / 编排，不产生工件或证据（已显式留痕）。';
    return {inputs,method,note};
  }
  function runStep(s,st){
    const p=cur(s),pid=p?p.id:'G4';
    const beforeArt=new Set(s.artifacts.map(a=>a.id));
    const beforeEv=new Set(s.evidences.map(e=>e.id));
    const startedAt=Date.now();
    let r=null;
    switch(st.fn){
      case 'aiSubmit': r=aiSubmit(s,'ai');break;
      case 'toolSubmit': r=toolSubmit(s,'toolchain');break;
      case 'aiTest': r=aiTaskAction(s,'ai','test',st.taskId);break;
      case 'aiImpl': r=aiTaskAction(s,'ai','impl',st.taskId);break;
      case 'toolRed': r=toolTaskAction(s,'toolchain','red',st.taskId);break;
      case 'toolGreen': r=toolTaskAction(s,'toolchain','green',st.taskId);break;
      case 'toolOos': r=toolTaskAction(s,'toolchain','oos',st.taskId);break;
    }
    const newArts=s.artifacts.filter(a=>!beforeArt.has(a.id));
    const newEvs=s.evidences.filter(e=>!beforeEv.has(e.id));
    const tr={id:nid(s,'TR'),ts:startedAt,actor:st.actor,phase:pid,step:st.step,detail:st.detail,
      durationMs:st.dur,status:(r&&r.ok===false)?'fail':'done',result:r?r.msg:''};
    // 反向关联：工件 / 证据 / 文件都能反查到产生它的那一步
    newArts.forEach(a=>{a.producedBy=tr.id;if(a.file)a.file.producedBy=tr.id;});
    newEvs.forEach(e=>{e.producedBy=tr.id;});
    const desc=describeStep(s,st,{newArts,newEvs,result:r});
    const eventId=log(s,st.actor,'AUTO_STEP',pid,'['+st.step+'] '+st.detail+(r?' → '+r.msg:''),
      {traceId:tr.id, actorId:(ACTORS[st.actor]||ACTORS.system).id, phase:pid});
    const memIds=desc.inputs.filter(i=>i.kind==='project_memory').reduce((n,i)=>n.concat(i.items.map(m=>m.id)),[]);
    const receipt={
      schema:'gk.receipt/1',
      who:Object.assign({},ACTORS[st.actor]||ACTORS.system,{stepSeq:s.traces.length+1}),
      when:{startedAt,endedAt:startedAt+(st.dur||0),durationMs:st.dur,clock:'浏览器本地时间'},
      where:{round:s.round,phaseIdx:s.phaseIdx,phase:pid,phaseName:p?p.name:'已完成',
        taskId:st.taskId||null,acIds:s.acs.map(a=>a.id),
        concurrency:st.taskId&&batchIds(s).indexOf(st.taskId)>=0?'本批次并行执行':null},
      what:{step:st.step,detail:st.detail,fn:st.fn||null},
      method:desc.method, inputs:desc.inputs,
      outputs:newArts.map(a=>({kind:'artifact',id:a.id,title:a.title,hash:a.hash,type:a.type,
        file:a.file?a.file.path:null})).concat(newEvs.map(e=>({kind:'evidence',id:e.id,title:e.title,
        result:e.result,signer:e.signer,commitHash:e.commitHash,diffHash:e.diffHash}))),
      note:desc.note,
      refs:{traceId:tr.id,eventId,
        artifactIds:newArts.map(a=>a.id),evidenceIds:newEvs.map(e=>e.id),memoryIds:memIds,
        filePaths:newArts.map(a=>a.file?a.file.path:null).filter(Boolean),
        commitHash:newEvs.length?newEvs[0].commitHash:null,diffHash:newEvs.length?newEvs[0].diffHash:null},
      result:{status:tr.status,message:tr.result},
      simulated:(ACTORS[st.actor]||ACTORS.system).simulated,
    };
    // 凭证本体（完整输入载荷）外置到存储插件；trace 只留引用 + 轻量摘要
    const rref=putRef(s,'receipt/'+tr.id+'.json', receipt);
    tr.receiptRef={uri:rref.uri, hash:rref.hash, sizeBytes:rref.sizeBytes};
    tr.receiptLite={who:receipt.who.id, step:receipt.what.step, outputs:receipt.outputs.length, result:receipt.result.status};
    s.traces.push(tr);
    return tr;
  }
  function receiptOk(t){
    const r=getReceipt(t);
    return !!(r&&r.who&&r.who.id&&r.when&&r.when.startedAt&&r.where&&r.method&&r.method.tool&&
      Array.isArray(r.inputs)&&r.inputs.length&&Array.isArray(r.outputs)&&
      r.refs&&r.refs.traceId===t.id&&r.refs.eventId&&r.result);
  }
  function metrics(s){
    const ap=s.approvals.filter(a=>!a.skipped);   // 精简跳过的门禁不参与耗时 / 通过率口径
    const first=ap.filter(a=>a.attempt===1).length;
    const totalAttempts=ap.length+Object.keys(s.gateAttempts).reduce((n,k)=>n+(s.gateAttempts[k]-1),0);
    const avgDur=ap.length?ap.reduce((n,a)=>n+a.durationMs,0)/ap.length:0;
    const rejected=s.reviewNotes.length;
    const adopted=Math.max(0,s.aiSuggestions-rejected);
    return [
      {key:'门禁一次通过率',value:ap.length?Math.round(first/ap.length*100)+'%':'—',na:!ap.length,desc:'首次提交即通过的门禁 / 已批准门禁。来源：事件日志（真实）'},
      {key:'需求返工率',value:totalAttempts?Math.round(s.reworks/totalAttempts*100)+'%':'—',na:!totalAttempts,desc:'G1/G2 打回次数 / 门禁提交总次数。代理指标，正式口径需接需求系统'},
      {key:'缺陷逃逸率',value:'待接入',na:true,desc:'原型不接入线上工单与缺陷系统 —— 属于边界之外，故留空'},
      {key:'AI 建议采纳率',value:s.aiSuggestions?Math.round(adopted/s.aiSuggestions*100)+'%':'—',na:!s.aiSuggestions,desc:'(AI 产出总数 − 打回次数) / AI 产出总数。代理指标'},
      {key:'人均 Review 耗时',value:ap.length?(avgDur/1000).toFixed(1)+'s':'—',na:!ap.length,desc:'AI 提交 → 人签字的审批停留时长。代理指标，演示环境为秒级'},
      {key:'执行可追溯率',value:s.traces.length?Math.round(s.traces.filter(receiptOk).length/s.traces.length*100)+'%':'—',na:!s.traces.length,
        desc:'带完整凭证（谁 / 何时 / 输入 / 加载方式 / 输出 / 关联）的自动步骤占比。来源：traces（真实）'},
    ];
  }
  function nextRound(s,role){
    if(role!=='human') return deny(s,role,'开启新一轮','G0');
    const carried=activeMemory(s).map(m=>Object.assign({},m,{hits:(m.hits||0)+1}));
    const ns=createState(s.round+1,carried);
    log(ns,'system','MEMORY_INJECTED','G0','下轮 G0 已自动加载 '+carried.length+' 条生效项目记忆');
    return ns;
  }

  /* ---- 闭环后开启下一轮 = 新建一个任务，而不是把当前任务重置 ----
     《AI开发流程设计》2.1：「项目记忆（约束、偏好、历史教训）持久化，跨任务复用」。
     记忆跨任务复用 ⇒ 载体也该跨任务。所以下一轮是**一个新任务实例**（新 ID、
     独立的状态/工件/证据/审批/事件），把已确认入库的生效记忆继承过去；
     原任务保持「已闭环」原样不动，历史工件与审计轨迹完整保留、可随时回查。
     若沿用旧做法（同一 ID 重置 state），第 1 轮的工件与凭证会被覆盖丢失，
     且总览里也看不出「这是一个新任务」。 */
  function createNextTask(root,from,role,opts){
    opts=opts||{};
    if(role!=='human') return deny((from&&from.state)||root,role,'开启下一轮','G0');
    if(!from||!from.state) return {ok:false,msg:'未找到源任务'};
    const carried=activeMemory(from.state).map(m=>Object.assign({},m,{hits:(m.hits||0)+1}));
    const id='TASK-'+(root.nextId++);
    // 默认名：源任务名若已带「· 第 N 轮」标记就不再叠加，否则补上轮次（避免出现「第 1 轮 · 第 2 轮」）
    const rn=from.state.round+1;
    const baseName=opts.name||(/(^|·\s*)第\s*\d+\s*轮/.test(from.name)?from.name:(from.name+' · 第 '+rn+' 轮'));
    const st=createState(from.state.round+1,carried);
    // 血缘：新任务记录自己派生自哪个任务、旧任务记下派生了谁，两头都能反查
    st.parentTaskId=from.id;
    st.parentRound=from.state.round;
    const inst={id,name:baseName,
      desc:(opts.desc||('派生自 '+from.id+'（第 '+from.state.round+' 轮）· 继承 '+carried.length+' 条生效项目记忆')),
      owner:opts.owner||from.owner, createdAt:Date.now(), state:st};
    from.derivedTasks=(from.derivedTasks||[]);
    from.derivedTasks.push(id);
    log(st,'system','MEMORY_INJECTED','G0','新任务 '+id+' 由 '+from.id+' 派生；G0 自动加载 '+carried.length+' 条生效项目记忆');
    log(st,'system','TASK_DERIVED','G0','由 '+from.id+' 闭环后新建 · 源任务保持已闭环留档');
    return {ok:true,msg:'已新建 '+id+'（'+baseName+'）· 继承 '+carried.length+' 条生效项目记忆 · G0 从头开始',instance:inst};
  }

  /* ---- 存档迁移：把旧版本状态补齐到当前数据结构，保留已推进的进度 ----
     v0.8 起 tasks[].deps 表达「前置 Task 签字后才开工」，旧存档里没有这个字段，
     直接读会让 depsSatisfied 判定为「无依赖」，导致本该阻塞的 Task 被并发拉起。
     这里按 TASK_TEMPLATE 的 id 回填依赖，并补齐缺省字段。 */
  function migrateState(s){
    if(!s||!Array.isArray(s.tasks))return s;
    const byId={}; TASK_TEMPLATE.forEach(t=>{byId[t.id]=t;});
    s.tasks.forEach(t=>{
      const ref=byId[t.id];
      if(!Array.isArray(t.deps)) t.deps = ref ? (ref.deps||[]).slice() : [];
      if(!Array.isArray(t.scope)) t.scope=[];
      if(!Array.isArray(t.acs)) t.acs=[];
      if(!Array.isArray(t.diff)) t.diff=[];
    });
    s.taskStep=s.taskStep||{}; s.failCount=s.failCount||{}; s.escalated=s.escalated||{};
    s.outOfScope=s.outOfScope||{}; s.reviewNotes=s.reviewNotes||[]; s.skipped=s.skipped||{};
    s.tasks.forEach(t=>{
      const st=s.taskStep[t.id]=s.taskStep[t.id]||{test:false,red:false,impl:false,green:false,review:'pending',verify:false};
      ['test','red','impl','green','verify'].forEach(k=>{ if(typeof st[k]!=='boolean') st[k]=false; });
      if(!st.review) st.review='pending';
      if(typeof s.failCount[t.id]!=='number') s.failCount[t.id]=0;
      if(typeof s.escalated[t.id]!=='boolean') s.escalated[t.id]=false;
    });
    return s;
  }

  /* ---- 内容外置迁移：把旧存档里内联的内容本体搬到存储插件，状态里换成引用（幂等） ---- */
  function externalizeState(s){
    if(!s) return s;
    (s.artifacts||[]).forEach(a=>{
      if(a.data!==undefined){ const r=putRef(s,'artifact/'+a.id+'.json',a.data); a.ref={uri:r.uri,hash:r.hash,sizeBytes:r.sizeBytes}; delete a.data; }
      if(a.file&&a.file.content!==undefined){
        const r=putRef(s,'file/'+a.id+'.md',a.file.content);
        a.file.ref={uri:r.uri,hash:r.hash};
        a.file.hash=a.file.hash||r.hash; delete a.file.content;
      }
    });
    (s.evidences||[]).forEach(e=>{
      if(e.data!==undefined){ const r=putRef(s,'evidence/'+e.id+'.json',e.data); e.ref={uri:r.uri,hash:r.hash,sizeBytes:r.sizeBytes}; delete e.data; }
    });
    (s.traces||[]).forEach(t=>{
      if(t.receipt){ const r=putRef(s,'receipt/'+t.id+'.json',t.receipt); t.receiptRef={uri:r.uri,hash:r.hash,sizeBytes:r.sizeBytes};
        t.receiptLite={who:t.receipt.who?t.receipt.who.id:null,step:t.receipt.what?t.receipt.what.step:null,
          outputs:(t.receipt.outputs||[]).length,result:t.receipt.result?t.receipt.result.status:null};
        delete t.receipt; }
    });
    return s;
  }

  /* ---- 多任务种子：全部用上面的真实流程逻辑推进，不伪造状态 ---- */
  function stepCurrent(s,confirmMem){
    const p=cur(s);
    if(!p)return;
    if(p.id==='G4'){
      // 批次循环：跑完当前批次 → 逐 Task 签字（模拟人已评审）→ 依赖解锁后进入下一批次
      let guard=0;
      while(guard++<20){
        const batch=readyBatch(s);
        if(!batch.length) break;
        buildRunPlan(s).forEach(x=>runStep(s,x));
        // 批次内每个 Task 各自处理越界说明与签字
        let progressed=false;
        batch.forEach(t=>{
          const o=s.outOfScope[t.id];
          if(o&&o.files.length&&!o.explanation) explainOutOfScope(s,'human','遗留耦合模块需同步修正错误码映射',t.id);
          const r=reviewTask(s,'human','ok','',t.id);
          if(r&&r.ok) progressed=true;
        });
        if(!progressed) break;
      }
    }else{
      buildRunPlan(s).forEach(x=>runStep(s,x));
      if(p.id==='G10'&&confirmMem) s.memories.filter(m=>m.status==='candidate').forEach(m=>confirmMemory(s,m.id,'human'));
    }
  }
  function drive(s,untilIdx,leavePending){
    let guard=0;
    while(s.phaseIdx<untilIdx&&guard++<20){
      stepCurrent(s,true);
      if(!approve(s,'human').ok)break;
    }
    if(leavePending&&s.phaseIdx===untilIdx&&cur(s)) stepCurrent(s,false);
  }
  function createSeedRoot(){
    const root={version:2,nextId:1101,instances:[],activeId:null};
    const mk=(id,name,desc,owner,setup)=>{
      const st=createState(1,[]);
      setup(st);
      const inst={id,name,desc,owner,createdAt:Date.now(),state:st};
      root.instances.push(inst);
      return inst;
    };
    const a=mk('TASK-1042','短信验证码登录','新增手机号验证码登录，兼容原密码登录','张工',st=>drive(st,1,true));
    const b=mk('TASK-1038','订单导出性能优化','大批量导出超时，需分页与异步化','李工',st=>{
      stepCurrent(st,true); approve(st,'human');
      stepCurrent(st,true); reject(st,'human','验收标准缺少异常场景判据');
      stepCurrent(st,true); approve(st,'human');
      drive(st,3,true);
    });
    // 支付回调幂等改造：批次并发跑到一半，T2 连续自测失败触发「失败即停」熔断，等待人裁决。
    // 熔断发生在 T2 执行途中（不是事后），所以裁决后确实还有活要继续 —— 与并发模型一致。
    const c=mk('TASK-1051','支付回调幂等改造','重复回调导致重复入账，需幂等键','王工',st=>{
      drive(st,4,false);
      // 只跑到批次中 T2 的红阶段之前，让 T2 停在半途
      const plan=buildRunPlan(st);
      const cut=plan.findIndex(x=>x.taskId==='T2'&&x.fn==='toolRed');
      plan.slice(0,cut<0?plan.length:cut).forEach(x=>runStep(st,x));
      // T2 连续三次自测失败 → 熔断冻结，升级人裁决
      simulateFail(st,'toolchain','T2'); simulateFail(st,'toolchain','T2'); simulateFail(st,'toolchain','T2');
    });
    const d=mk('TASK-1029','用户中心权限重构','角色模型由二级改为多级，需回归全部权限点','陈工',st=>drive(st,7,true));
    const e=mk('TASK-1060','搜索联想词迭代','联想词召回策略调整，补齐埋点','赵工',st=>drive(st,10,true));
    const f=mk('TASK-0998','日志采集链路接入','统一日志格式并接入集中检索','周工',st=>drive(st,11,false));
    // 记忆回流验证（真实两段）：源任务走完一整轮并在 G10 确认记忆 → 闭环留档；
    // 再由它派生一个**新任务**（新 ID、独立状态），新任务 G0 真实加载继承的生效记忆。
    // 这样「加载项目记忆」的凭证里能看到真实条目，而不是伪造基线数据；
    // 同时演示「闭环后新建任务，而不是把当前任务重置重跑」。
    const g=mk('TASK-0977','短信验证码登录 · 第 1 轮','完成一轮复盘并确认记忆后闭环留档，作为派生下一轮的源任务','吴工',st=>{
      drive(st,11,false);
    });
    const g2=createNextTask(root,g,'human',{name:'短信验证码登录 · 第 2 轮'});
    const derived=g2.instance;
    root.instances.unshift(derived);
    // 派生任务的 G0 真实跑起来：加载继承的生效项目记忆并产出 Context Brief
    stepCurrent(derived.state,false);
    root.activeId=a.id;
    return root;
  }
  /* ---- 空白工作区：日常使用时从零开始，不携带演示任务 ---- */
  function createEmptyRoot(){
    return {version:2,nextId:1101,instances:[],activeId:null};
  }
  /* ---- 接口规范登记表（machine-readable，见 spec.md《接口规范》）----
     AI / 工具链 / 人与系统的全部交互只能走这些接口；每次发布跑 selftest.js
     的接口规范测试套件（I 段）校验：函数存在、主体权限、返回契约。
     新增 / 修改接口时必须同步更新 spec.md 与本表。 */
  const INTERFACES=[
    {id:'gk.ai.submit',        fn:'aiSubmit',        caller:'ai',       when:'阶段门禁前提交结构化产出',   input:'(state, "ai")',                          output:'{ok,msg}', side:'登记 artifact + 模拟文件'},
    {id:'gk.toolchain.sign',   fn:'toolSubmit',      caller:'toolchain',when:'阶段机器验证后签名回传证据', input:'(state, "toolchain")',                   output:'{ok,msg}', side:'登记 evidence（绑定 commit/diff hash）'},
    {id:'gk.ai.task.action',   fn:'aiTaskAction',    caller:'ai',       when:'G4 内：写测试 / 写实现',     input:'(state, "ai", which, taskId?)',          output:'{ok,msg}', side:'登记测试 / Diff 工件'},
    {id:'gk.toolchain.task',   fn:'toolTaskAction',  caller:'toolchain',when:'G4 内：红 / 绿 / 越界检测',  input:'(state, "toolchain", which, taskId?)',   output:'{ok,msg}', side:'登记签名证据'},
    {id:'gk.human.approve',    fn:'approve',         caller:'human',    when:'签署门禁放行',              input:'(state, "human")',                       output:'{ok,msg}', side:'门禁通过 + 授权下一阶段'},
    {id:'gk.human.reject',     fn:'reject',          caller:'human',    when:'打回并给出意见',            input:'(state, "human", reason)',               output:'{ok,msg}', side:'候选记忆 + 重做授权'},
    {id:'gk.human.skip',       fn:'skipPhase',       caller:'human',    when:'精简流程跳过本阶段',        input:'(state, "human", reason?)',              output:'{ok,msg}', side:'门禁记 skipped 留痕'},
    {id:'gk.human.review',     fn:'reviewTask',      caller:'human',    when:'G4 内：逐 Task Review',     input:'(state, "human", ok|no, note, taskId?)', output:'{ok,msg}', side:'签字 / 打回留痕'},
    {id:'gk.human.arbitrate',  fn:'arbitrate',       caller:'human',    when:'G4 熔断裁决',              input:'(state, "human", taskId?)',              output:'{ok,msg}', side:'解除熔断'},
    {id:'gk.human.explain',    fn:'explainOutOfScope',caller:'human',   when:'G4 越界改动说明',          input:'(state, "human", text, taskId?)',        output:'{ok,msg}', side:'审计留痕'},
    {id:'gk.human.memory',     fn:'confirmMemory / revokeMemory', caller:'human', when:'G10 记忆确认',  input:'(state, id, "human")',                   output:'{ok,msg}', side:'记忆入库 / 否决'},
  ];
  const RECEIPT_SCHEMA='gk.receipt/1';
  return {PHASES,ACTORS,MEMORY_CATEGORIES,FAIL_LIMIT,hash,createState,cur,activeMemory,currentTask,autoCheck,aiSubmit,toolSubmit,buildFile,receiptOk,
    approve,reject,aiTaskAction,toolTaskAction,simulateFail,arbitrate,explainOutOfScope,reviewTask,createEmptyRoot,
    confirmMemory,revokeMemory,skipPhase,buildRunPlan,previewNextRun,previewNextTaskRun,runStep,metrics,nextRound,createNextTask,createSeedRoot,log,
    taskById,readyBatch,batchIds,allTasksReviewed,tasksAwaitingReview,depsSatisfied,filesOverlap,g4TaskChain,
    migrateState,
    /* 内容外置：引用读写 / 迁移（UI 与自检通过这些入口取内容本体） */
    STORE,putRef,artData,evData,fileContent,getReceipt,externalizeState,
    /* 接口规范：机器可读登记表 + 凭证 schema 版本（见 spec.md） */
    INTERFACES,RECEIPT_SCHEMA};
})();
