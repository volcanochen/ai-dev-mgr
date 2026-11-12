(function(){
  const KEY='gatekeeper-v1',KEY_LEGACY='gatekeeper-prototype-v6',KEY_ONBOARD='gatekeeper-onboarded';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=t=>{const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0');};
  const WS={
    human:{title:'人 · 工作台',duty:'<b>系统只向人提供操作</b><br>我的动作：批准（= 授权下一阶段）/ 打回 / Review / 越界说明 / 裁决 / 记忆确认 / 开启下一轮<br><b>随时可查</b>：执行追溯（每步凭证）、模拟文件、全量事件日志',
      tabs:[['desk','审批台'],['receipt','执行追溯'],['review','循环 Review'],['memory','记忆确认'],['state','状态'],['artifacts','工件'],['evidences','证据'],['metrics','度量'],['log','事件日志']]},
    ai:{title:'AI 执行观测',duty:'<b>只读观测区</b><br>展示 AI 被触发后的自动执行过程（模拟）、每步完整凭证、产出的工件与模拟文件、注入的项目记忆。<br><b>本区没有任何流程动作按钮</b>，但每步都可点开凭证与文件查看。',
      tabs:[['trace','执行过程'],['receipt','执行凭证'],['artifacts','AI 工件'],['memory','注入记忆'],['state','流程状态']]},
    toolchain:{title:'工具链观测',duty:'<b>只读观测区</b><br>展示机器验证的执行记录、每步完整凭证与签名证据。<br><b>本区没有任何流程动作按钮</b>，但每步都可点开凭证查看输入与签名载荷。',
      tabs:[['trace','执行记录'],['receipt','执行凭证'],['evidences','签名证据'],['state','流程状态']]},
  };
  let ROOT,S,VIEW='overview',TAB='desk',PLAY=null;
  let TRACE_OPEN=false;   // 自动执行过程（模拟）回放卡默认收起；播放中临时展开
  let RCP_SEL=null,RCP_ACTOR='all',RCP_Q='',RCP_KIND=null,RCP_FOCUS=null,FILE_ID=null;
  function sanitizeRoot(x){
    if(!x||x.version!==2||!Array.isArray(x.instances))return null;
    x.instances.forEach(i=>{
      if(i.state) LOGIC.migrateState(i.state);
      if(i.state) LOGIC.externalizeState(i.state);   // 旧存档内容本体搬到存储插件，状态里只留引用
      if(typeof i.archived!=='boolean') i.archived=false;
    });
    if(typeof x.nextId!=='number') x.nextId=1101;
    if(typeof x.activeId!=='string') x.activeId=null;
    return x;
  }
  function onboarded(){try{return !!localStorage.getItem(KEY_ONBOARD);}catch(e){return false;}}
  function load(){
    try{const r=localStorage.getItem(KEY);
      if(r){const x=sanitizeRoot(JSON.parse(r));if(x&&(x.instances.length||onboarded()))return x;}
      // 迁移：原型版存档（v0.9 及更早）原样升级到 v1，不丢任务数据
      const old=localStorage.getItem(KEY_LEGACY);
      if(old){const x=sanitizeRoot(JSON.parse(old));if(x&&x.instances.length)return x;}
    }catch(e){}
    return null;
  }
  ROOT=load();
  const FIRST_RUN=!ROOT;
  if(!ROOT) ROOT=LOGIC.createSeedRoot(); // 首次启动先载入示例任务，供引导页选择；用户选「空白开始」时清空
  function activeInst(){return ROOT.instances.find(i=>i.id===ROOT.activeId&&!i.archived)||ROOT.instances.find(i=>i.id===ROOT.activeId)||ROOT.instances.find(i=>!i.archived)||ROOT.instances[0];}
  function syncCurrent(){const i=ROOT.instances.find(x=>x.id===ROOT.activeId);if(i)i.state=S;}
  function save(){syncCurrent();try{localStorage.setItem(KEY,JSON.stringify(ROOT));}catch(e){}
    if(typeof GKSTORE!=='undefined'&&GKSTORE.flush) GKSTORE.flush();}   // 异步存储插件排队落盘
  /* 内容本体读取：同会话同步 hydrate；跨会话异步插件未命中时给「加载内容」按钮 */
  function loadBtn(uri){ return uri?' <button class="mini" data-nav="load-ref" data-uri="'+esc(uri)+'">从外部存储加载内容</button>':''; }
  function detailJSON(x,uri){
    if(x===null||x===undefined) return '<p class="hint">内容本体保存在外部存储（引用 '+esc(uri||'—')+'），未在本会话缓存。'+loadBtn(uri)+'</p>';
    return '<pre style="margin-top:8px">'+esc(typeof x==='string'?x:JSON.stringify(x,null,2))+'</pre>';
  }
  S=activeInst().state;

  let toastTimer;
  function toast(msg,ok){const t=document.getElementById('toast');t.textContent=msg;t.className='toast '+(ok?'ok':'no');t.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.style.display='none',3400);}
  /* 人的一次判断 = 状态变更 + 对后续自动执行的授权。
     成功且确实还有可自动执行的动作时，直接启动回放，不再要求人补一次「触发」。 */
  function dispatch(fn,autoReason,autoAction){
    const r=fn();toast(r.msg,!!r.ok);
    if(r.ok&&autoReason&&startAutoRun(autoReason,autoAction))return;
    save();render();
  }
  function head(title,desc){return '<div class="page-head"><h1>'+esc(title)+'</h1><p>'+desc+'</p></div>';}
  function ro(){return ' <span class="ro">只读</span>';}

  /* ============ 总览页 ============ */
  function pendingFor(st){
    if(st.finishedAt)return null;
    if(st.tasks&&st.tasks.some&&st.tasks.some(t=>st.escalated[t.id]))return '失败熔断待人裁决';
    // 正常流转不会残留未执行的计划；若出现，说明自动执行被刷新中断，需要人恢复
    if(LOGIC.buildRunPlan(st).length)return '自动执行中断，待人工恢复';
    const p=LOGIC.cur(st);
    if(!p)return null;
    if(p.id==='G10'&&st.memories.some(m=>m.status==='candidate'))return 'G10 候选记忆待人确认';
    if(p.id==='G4'){
      const pend=LOGIC.tasksAwaitingReview(st);
      const frozen=st.tasks.filter(t=>st.escalated[t.id]);
      if(frozen.length) return frozen.map(t=>t.id).join('、')+' 失败熔断待人裁决';
      if(pend.length){
        const need=pend.filter(t=>{const o=st.outOfScope[t.id];return o&&o.files.length&&!o.explanation;});
        if(need.length) return need.map(t=>t.id).join('、')+' 越界改动待人说明';
        return pend.map(t=>t.id).join('、')+(pend.length>1?' 等 '+pend.length+' 个 Task 各自待 Review':' Diff 待人 Review');
      }
      return 'G4 '+st.tasks.length+' 个 Task 已签完，待人批准门禁';
    }
    return LOGIC.autoCheck(st).passed?('等待人签署 '+p.id+' 门禁'):'存在未满足校验项，待人处理';
  }
  function instStatus(st){
    if(st.finishedAt)return ['已闭环','green','finished'];
    if(st.tasks&&st.tasks.some&&st.tasks.some(t=>st.escalated[t.id]))return ['异常熔断','red','frozen'];
    const p=pendingFor(st);
    if(p)return ['待我处理','amber','pending'];
    return ['待自动执行','gray',''];
  }
  function miniProgress(st){
    return '<div class="mini">'+LOGIC.PHASES.map((p,i)=>'<span class="'+(i<st.phaseIdx?'done':i===st.phaseIdx?'now':'')+'"></span>').join('')+'</div>';
  }
  function lastEvent(st){
    const e=st.events[st.events.length-1];
    return e?'['+e.actor+'] '+e.detail:'';
  }
  let OV_Q='';
  function taskCard(i){
    const st=i.state,stt=instStatus(st),p=LOGIC.cur(st);
    const last=lastEvent(st);
    return '<div class="ov-card '+stt[2]+'"><div class="row" style="justify-content:space-between"><span class="mono">'+esc(i.id)+'</span><span class="badge '+stt[1]+'">'+stt[0]+'</span></div>'+
      '<div class="ttl">'+esc(i.name)+'</div><div class="desc">'+esc(i.desc)+'</div>'+
      (st.parentTaskId?'<div class="meta" style="padding:5px 8px;background:var(--primary-bg);border-radius:6px;color:var(--primary)"><button class="lnk" data-nav="open-task" data-task="'+esc(st.parentTaskId)+'">派生自 '+esc(st.parentTaskId)+'</button> · 第 '+esc(st.parentRound)+' 轮</div>':'')+
      '<div class="row" style="justify-content:space-between"><span class="badge gray">'+esc(p?p.id+' '+p.name:'已完成')+'</span><span class="mono">'+st.approvals.length+'/11 门禁</span></div>'+
      miniProgress(st)+
      '<div class="meta">工件 '+st.artifacts.length+' · 证据 '+st.evidences.length+' · 打回 '+st.reviewNotes.length+
        ' · 执行凭证 <button class="lnk" data-nav="open-receipt" data-task="'+esc(i.id)+'">'+st.traces.length+' 步随时可查</button></div>'+
      '<div class="last">'+esc(last.slice(0,110))+'</div>'+
      '<div class="foot"><span class="mono">'+esc(i.owner)+'</span><button class="primary" data-act="open" data-id="'+esc(i.id)+'">进入流程</button></div>'+
      '<div class="card-actions"><button class="mini" data-act="rename-task" data-id="'+esc(i.id)+'">重命名</button>'+
      (i.archived?'<button class="mini" data-act="unarchive-task" data-id="'+esc(i.id)+'">恢复</button>':'<button class="mini" data-act="archive-task" data-id="'+esc(i.id)+'">归档</button>')+
      '<button class="mini danger-mini" data-act="del-task" data-id="'+esc(i.id)+'">删除</button></div></div>';
  }
  function overviewPage(){
    const q=OV_Q.trim().toLowerCase();
    const match=i=>!q||(i.id+' '+i.name+' '+(i.owner||'')).toLowerCase().includes(q);
    const all=ROOT.instances.filter(match);
    const list=all.filter(i=>!i.archived);
    const archived=all.filter(i=>i.archived);
    const running=list.filter(i=>!i.state.finishedAt);
    const done=list.filter(i=>i.state.finishedAt);
    const pend=list.filter(i=>pendingFor(i.state));
    const allAp=list.reduce((a,i)=>a.concat(i.state.approvals),[]);
    const once=allAp.length?Math.round(allAp.filter(a=>a.attempt===1).length/allAp.length*100)+'%':'—';
    const evTotal=list.reduce((n,i)=>n+i.state.events.length,0);
    let h=head('开发任务总览','每个任务都是一个独立的 G0–G10 流程实例 · 点「进入流程」查看该任务的状态、工件、证据与门禁');
    h+='<div class="row" style="justify-content:space-between;margin-bottom:12px"><input id="ov-q" placeholder="搜索任务：名称 / ID / 负责人" style="max-width:360px" value="'+esc(OV_Q)+'">'+
      (q?'<button class="ghost" data-act="clear-ov-q">清除</button>':'')+'</div>';
    if(!ROOT.instances.length)
      return h+'<div class="card"><h3>还没有任务</h3><p class="hint">在下面新建第一个开发任务，它会作为独立的 G0–G10 流程实例开始运转。</p>'+
        '<div class="row"><input id="new-task-name" placeholder="输入任务名称，例如：优惠券核销接口改造" style="max-width:420px"><button class="primary" data-act="new-task">新建并进入流程</button></div></div>';
    h+='<div class="stats">'+
      '<div class="stat"><div class="k">进行中任务</div><div class="v">'+running.length+'</div><div class="d">未走完 G0–G10</div></div>'+
      '<div class="stat"><div class="k">待我处理</div><div class="v">'+pend.length+'</div><div class="d">门禁 / Review / 裁决 / 记忆确认</div></div>'+
      '<div class="stat"><div class="k">已闭环</div><div class="v">'+done.length+'</div><div class="d">11 道门禁全部签署</div></div>'+
      '<div class="stat"><div class="k">平均门禁一次通过率</div><div class="v">'+once+'</div><div class="d">汇总 '+allAp.length+' 次审批</div></div>'+
      '<div class="stat"><div class="k">事件日志总数</div><div class="v">'+evTotal+'</div><div class="d">跨任务不可变审计轨迹</div></div></div>';
    h+='<div class="card"><h3>新建开发任务</h3><div class="row"><input id="new-task-name" placeholder="输入任务名称，例如：优惠券核销接口改造" style="max-width:420px"><button class="primary" data-act="new-task">新建并进入流程</button></div>'+
      '<p class="hint">新任务从 G0 开始，状态、工件、证据、记忆完全独立。创建后会自动进入该任务的流程页面。</p></div>';
    h+='<div class="card"><h3>待我处理（'+pend.length+'）</h3>'+
      (pend.length?pend.map(i=>'<div class="pending-row"><div class="pl"><b>'+esc(i.id)+' · '+esc(i.name)+'</b><span>'+esc(pendingFor(i.state))+' · 当前 '+esc((LOGIC.cur(i.state)||{id:'已完成'}).id)+' · '+esc(i.owner)+'</span></div><button class="primary" data-act="open" data-id="'+esc(i.id)+'">进入处理</button></div>').join(''):'<p class="hint">当前没有等待人处理的任务</p>')+'</div>';
    h+='<div class="card"><h3>全部任务（'+list.length+'）</h3>'+(list.length?'<div class="grid3">'+list.map(taskCard).join('')+'</div>':'<p class="hint">没有匹配的任务</p>')+'</div>';
    if(archived.length)
      h+='<div class="card"><h3>已归档（'+archived.length+'）</h3><p class="hint">归档任务不参与统计与待办提醒，工件、证据与审计轨迹完整保留，可随时恢复。</p><div class="grid3">'+archived.map(taskCard).join('')+'</div></div>';
    return h;
  }

  /* ============ 单任务流程页 ============ */
  function nextActor(){
    if(PLAY) return {role:'auto',text:'自动执行中 '+PLAY.i+'/'+PLAY.plan.length+' 步，过程与事件日志实时展示'};
    const p=LOGIC.cur(S);
    if(!p) return {role:'human',text:'本轮闭环已完成，由人决定是否开启下一轮'};
    if(p.id==='G4'){
      // 并发模型下不能只看全局游标 currentTask（它可能指向已签字的 Task），
      // 必须按实际待办集合判断：熔断 → 待签字 → 待执行，逐一给出真实提示。
      const frozen=S.tasks.filter(t=>S.escalated[t.id]);
      if(frozen.length) return {role:'human',text:frozen.map(t=>t.id).join('、')+' 已熔断冻结，需要人在「循环 Review」页裁决'};
      const pend=LOGIC.tasksAwaitingReview(S);
      if(pend.length){
        const need=pend.filter(t=>{const o=S.outOfScope[t.id];return o&&o.files.length&&!o.explanation;});
        if(need.length) return {role:'human',text:need.map(t=>t.id).join('、')+' 检出越界改动，需要人在「循环 Review」页填写说明'};
        return {role:'human',text:pend.map(t=>t.id).join('、')+(pend.length>1?' 等 '+pend.length+' 个 Task':'')+' 证据齐备，等待人在「循环 Review」页逐个 Review 签字'};
      }
      const busy=S.tasks.filter(t=>{
        const st=S.taskStep[t.id]||{};
        return !st.test||!st.red||!st.impl||!st.green||!S.evidences.some(e=>e.taskId===t.id&&e.type==='out_of_scope');
      });
      if(busy.length) return {role:'auto',text:busy.map(t=>t.id).join('、')+' 前置动作未完成（正常流转应已自动执行；刷新中断可用「手动触发」恢复）'};
      return {role:'human',text:S.tasks.length+' 个 Task 已全部完成，等待人在「审批台」批准 G4 门禁'};
    }
    const hasArt=S.artifacts.some(a=>a.phase===p.id&&a.kind==='ai');
    const hasEv=S.evidences.some(e=>e.phase===p.id&&e.kind==='stage');
    if(!hasArt||!hasEv) return {role:'auto',text:p.id+' 阶段产出与证据未齐（正常流转应已自动执行；刷新中断可用「手动触发」恢复）'};
    if(p.id==='G10'&&S.memories.some(m=>m.round===S.round&&m.status==='candidate')) return {role:'human',text:'G10 候选记忆等待人在「记忆确认」页确认或否决'};
    if(LOGIC.autoCheck(S).passed) return {role:'human',text:p.id+' 自动校验通过，等待人在「审批台」签署门禁'};
    return {role:'human',text:p.id+' 存在未满足的校验项，等待人处理'};
  }
  function stepBanner(){
    const n=nextActor(),inst=activeInst();
    const crumb='<span class="badge gray">'+esc(inst.id)+' · '+esc(inst.name)+'</span>';
    // 血缘：派生任务标明来自哪个任务，并能一键回到源任务查它已闭环留档的工件与凭证
    // 用 data-nav（查看导航）而非 data-act —— 三个角色视图的追溯页都要求零流程动作按钮
    const lineage=(S.parentTaskId
      ? '<button class="lnk" data-nav="open-task" data-task="'+esc(S.parentTaskId)+'">派生自 '+esc(S.parentTaskId)+'（第 '+esc(S.parentRound)+' 轮）</button>'
      : '')+
      ((inst.derivedTasks&&inst.derivedTasks.length)
        ? '<span class="badge gray">已派生 '+inst.derivedTasks.map(esc).join('、')+'</span>' : '');
    if(n.role==='auto') return '<div class="nextstep">'+crumb+lineage+'<span class="who">待自动执行</span><span>'+linkify(n.text)+'</span><span class="badge gray">系统自动完成</span></div>';
    return '<div class="nextstep">'+crumb+lineage+'<span class="who">待你处理</span><span>'+linkify(n.text)+'</span><span class="badge green">人的动作</span></div>';
  }
  function renderSide(){
    const w=WS[VIEW];
    document.getElementById('ws-title').textContent=w.title;
    document.getElementById('duty').innerHTML=w.duty;
    document.getElementById('nav').innerHTML=w.tabs.map(t=>'<button data-tab="'+t[0]+'" class="'+(TAB===t[0]?'on':'')+'">'+t[1]+'</button>').join('');
    document.getElementById('side-phases').innerHTML=LOGIC.PHASES.map((p,i)=>'<div class="'+(i<S.phaseIdx?'done':i===S.phaseIdx?'now':'')+'"><span class="dot"></span>'+p.id+' '+esc(p.name)+'</div>').join('');
    document.querySelectorAll('#rolestrip button').forEach(b=>b.classList.toggle('on',b.dataset.view===VIEW));
  }
  function runStatus(){return PLAY?'<span class="badge amber">执行中 '+PLAY.i+'/'+PLAY.plan.length+'</span>':'<span class="badge gray">空闲 · 上次授权已执行完毕</span>';}
  function todoList(items,done){
    return '<ul class="todo">'+items.map(x=>'<li><span class="mk '+(done?'ck':'dot2')+'">'+(done?'✓':'·')+'</span><span class="txt">'+linkify(x)+'</span></li>').join('')+'</ul>';
  }
  function checkList(items){
    return '<ul class="todo">'+items.map(i=>'<li><span class="mk '+(i.ok?'ck':'warn2')+'">'+(i.ok?'✓':'!')+'</span><span class="txt">'+linkify(i.label)+
      (!i.ok&&i.why?'<em>'+linkify(i.why)+'</em>':'')+'</span></li>').join('')+'</ul>';
  }
  function runSteps(items,emptyText){
    if(!items.length)return '<p class="hint">'+esc(emptyText||'该阶段没有待自动执行的动作')+'</p>';
    return '<ul class="runlist">'+items.map((x,i)=>'<li><i>'+String(i+1).padStart(2,'0')+'</i><b class="'+esc(x.actor)+'">'+esc(x.actor)+'</b><span>'+esc(x.step)+' · '+esc(x.detail)+'</span></li>').join('')+'</ul>';
  }
  /* 执行授权单：批准前让人知道本阶段做了什么、按什么标准判，以及批准后放出去的是哪一批活 */
  function authCard(){
    const p=LOGIC.cur(S),c=LOGIC.autoCheck(S),nx=LOGIC.PHASES[S.phaseIdx+1]||null;
    const steps=nx?LOGIC.previewNextRun(S):[];
    let h='<div class="card"><h3>执行授权单 · 批准前请确认'+ro()+'</h3>'+
      '<p class="sub">依据《输出文档》2.3 各阶段「AI 职责 / 产出物 / 门禁」。<b>批准放行 = 确认本阶段达标 + 授权下一阶段自动执行</b>，不再需要单独点触发。</p><div class="grid2">';
    h+='<div class="authbox"><div class="row" style="justify-content:space-between"><b>'+p.id+' '+esc(p.name)+' · 本阶段</b>'+
      '<span class="badge '+(c.passed?'green':'amber')+'">'+(c.passed?'校验通过':'未达标')+'</span></div>'+
      '<div class="authsec">AI 与工具链做了什么（已执行）</div>'+todoList(p.todo,true)+
      '<div class="authsec">本阶段通过标准 · 系统自动校验结果</div>'+checkList(c.items)+'</div>';
    if(nx){
      h+='<div class="authbox next"><div class="row" style="justify-content:space-between"><b>批准后自动启动 · '+nx.id+' '+esc(nx.name)+'</b><span class="badge amber">待授权</span></div>'+
        '<div class="authsec">将要做的事</div>'+todoList(nx.todo,false)+
        '<div class="authsec">什么标准才能通过（下一道门禁判据）</div>'+todoList(nx.criteria,false)+
        '<div class="authsec">系统实际会执行的 '+steps.length+' 步 · 主体分工</div>'+runSteps(steps,'进入该阶段后按 Task 逐项生成执行步骤')+'</div>';
    }else{
      h+='<div class="authbox next"><b>本轮最后一道门禁</b><div class="authsec">批准后 G0–G10 闭环完成，不再启动新阶段；可在「记忆确认」页开启下一轮验证经验回流。</div>'+todoList(p.criteria,false)+'</div>';
    }
    // G4 阶段：批准前要能看清「哪些 Task 已签字、哪些还待签、依赖关系如何」
    if(p.id==='G4'&&S.tasks.length){
      const batch=LOGIC.batchIds(S),pend=LOGIC.tasksAwaitingReview(S);
      const signed=S.tasks.filter(t=>S.taskStep[t.id]&&S.taskStep[t.id].review==='ok').map(t=>t.id);
      const frozen=S.tasks.filter(t=>S.escalated[t.id]).map(t=>t.id);
      h+='<div class="authbox next" style="grid-column:1/-1"><b>G4 逐 Task 签字情况</b>'+
        '<div class="authsec">已签字：'+(signed.length?esc(signed.join('、')):'（无）')+
        ' ｜ 待独立评审：'+(pend.length?esc(pend.map(t=>t.id).join('、')):'（无）')+
        (frozen.length?' ｜ 熔断待裁决：'+esc(frozen.join('、')):'')+'</div>'+
        '<div class="authsec">依赖关系（前置 Task 签字后才开工）</div>'+
        depGraph()+
        S.tasks.map(t=>('· '+esc(t.id)+' '+(t.deps&&t.deps.length?('依赖 '+esc(t.deps.join('、'))):'无依赖'))).join('<br>')+
        '</div>'+
        (batch.length>1?'<div class="authsec">下一批可并行开工：'+esc(batch.join('、'))+'（依赖已满足且改动文件互不重叠）</div>':'')+
        '</div>';
    }
    h+='<div class="chipbar" style="margin-top:12px"><button class="chip" data-nav="receipt-all" data-actor="all">查看本任务全部执行凭证</button>'+
      '<span class="hint">上面列出的每一步执行后都会生成完整凭证（主体 / 时间 / 输入 / 加载方式 / 输出 / 关联），随时可在「执行追溯」页反查。</span></div>';
    return h+'</div></div>';
  }
  /* G4 签字授权单：批次语义 —— 展示本批各 Task 要做的事、下一批会跑什么、什么标准才能通过 */
  function reviewCard(t){
    const g=LOGIC.PHASES[4],steps=LOGIC.previewNextTaskRun(S);
    const batch=LOGIC.batchIds(S);
    // 人此刻实际面对的是「待评审的 Task 集合」，而不是「下一批可开工的 Task」。
    // 并行时多个 Task 同时待签，验证方式必须逐 Task 列出，
    // 只显示其中一个会被误读成整批共用一条判据。
    const pend=LOGIC.tasksAwaitingReview(S);
    const focus=pend.length?pend.map(x=>x.id):batch;
    const verifySec = focus.length>1
      ? '<div class="authsec">各 Task 的验证方式（各自独立判据）</div>'+
        focus.map(id=>{const b=LOGIC.taskById(S,id);return b?('<div style="margin:3px 0">· <b>'+esc(b.id)+'</b> '+esc(b.title)+' —— '+esc(b.verify)+'</div>'):'';}).join('')
      : '<div class="authsec">本 Task 验证方式：'+esc(t.verify)+'</div>';
    const titleSec = focus.length>1
      ? (pend.length?'本批 '+pend.length+' 个 Task 并行待签：':'本批 '+batch.length+' 个 Task 并行：')+esc(focus.join('、'))
      : t.id+' '+esc(t.title);
    return '<div class="card"><h3>本次签字授权什么'+ro()+'</h3><div class="grid2">'+
      '<div class="authbox"><b>'+esc(titleSec)+'</b>'+
      '<div class="authsec">要做的事</div>'+todoList(g.todo,false)+
      verifySec+
      '<div class="authsec">评审单位：单个 Task —— 各自独立签字，互不阻塞</div></div>'+
      '<div class="authbox next"><b>什么标准才能通过</b>'+todoList(g.criteria,false)+
      '<div class="authsec">签字即授权后续自动执行（'+steps.length+' 步）；打回或裁决同样连带重跑</div>'+
      runSteps(steps,'全部 Task 均已签字，下一步是人在审批台批准 G4 门禁')+'</div>'+
      '</div></div>';
  }
  function triggerButton(label){
    const plan=LOGIC.buildRunPlan(S);
    return '<button class="ghost" data-act="manual-run" '+((PLAY||!plan.length)?'disabled':'')+'>'+esc(label)+'</button>';
  }
  /* 所有人工判断最终都汇到这里：批准 / 打回 / Review / 裁决 / 新建任务各自只点一次，
     后续执行由系统按授权单自动编排，AI 与工具链分工完成。 */
  function startAutoRun(reason,action){
    if(PLAY)return false;
    const plan=LOGIC.buildRunPlan(S);
    if(!plan.length)return false;
    const pid=(LOGIC.cur(S)||{id:'DONE'}).id;
    const nA=plan.filter(x=>x.actor==='ai').length,nT=plan.filter(x=>x.actor==='toolchain').length;
    LOGIC.log(S,'human',action||'AUTO_RUN_AUTHORIZED',pid,
      reason+' · 授权 '+plan.length+' 步自动执行（AI '+nA+' / 工具链 '+nT+' / 系统编排 '+(plan.length-nA-nT)+'）');
    PLAY={plan,i:0};save();render();playTick();
    return true;
  }
  function triggerRun(){
    if(PLAY){toast('正在执行中，请稍候',false);return;}
    if(!startAutoRun('人手动下达执行指令（仅异常恢复）','RUN_TRIGGERED'))
      toast('当前没有可自动执行的动作；正常流转由人工判断自动授权',false);
  }
  function playTick(){
    if(!PLAY)return;
    const st=PLAY.plan[PLAY.i++];
    LOGIC.runStep(S,st);
    save();render();
    if(PLAY.i<PLAY.plan.length){setTimeout(playTick,300);}
    else{const n=PLAY.i;PLAY=null;save();render();toast('自动执行完成：'+n+' 步，过程与事件日志已记录',true);}
  }
  function traceRows(list){
    if(!list.length)return '<p class="hint">尚无执行记录。人在审批台批准 / 打回、在 Review 页签字或裁决后，系统会自动执行并在此逐步展示。</p>';
    const curId=PLAY&&S.traces.length?S.traces[S.traces.length-1].id:null;
    return '<div class="trace">'+list.slice().reverse().map(t=>{
      const who=t.receiptLite&&t.receiptLite.who?t.receiptLite.who:'—';
      return '<div class="tr '+(t.status==='fail'?'fail ':'')+(t.id===curId&&PLAY?'cur':'')+'">'+
        '<span class="tm">'+fmt(t.ts)+'</span><span class="ac '+t.actor+'">'+esc(t.actor)+'</span>'+
        '<div class="bd"><b>'+esc(t.step)+'</b> <span class="mono">'+t.durationMs+'ms · '+esc(t.phase)+' · '+esc(who)+'</span> '+
        '<button class="lnk" data-nav="receipt" data-id="'+esc(t.id)+'">凭证</button>'+
        '<div class="dt">'+linkify(t.detail)+'</div>'+(t.result?'<div class="rs">→ '+esc(t.result)+'</div>':'')+'</div></div>';
    }).join('')+'</div>';
  }
  /* 回放卡：collapsible=true 时可收起 / 展开，默认收起（播放中临时展开，结束后恢复收起） */
  function traceCard(title,actor,limit,collapsible){
    let list=S.traces.filter(t=>actor==='all'||t.actor===actor||t.actor==='system');
    const full=list.length;
    if(limit)list=list.slice(-limit);
    const open=!collapsible||TRACE_OPEN||!!PLAY;
    let h='<div class="card"><div class="row" style="justify-content:space-between">'+
      '<h3 style="margin:0">'+esc(title)+' '+runStatus()+ro()+'</h3>'+
      (collapsible?'<button class="mini" data-nav="trace-toggle">'+(open?'收起 ▲':'展开 ▼')+'</button>':'')+'</div>'+
      '<p class="sub">共 '+full+' 条执行记录'+(limit?' · 本卡片显示最近 '+list.length+' 条，全量请在「执行追溯」页查看':'')+'。每步都有可下钻的完整凭证（主体 / 时间 / 输入 / 加载方式 / 输出 / 关联）。</p>';
    if(!open){
      h+='<p class="hint">已收起 · 过程与事件日志已留痕，可随时在「执行追溯」页回查。</p></div>';
      return h;
    }
    h+='<div class="chipbar"><button class="chip" data-nav="receipt-all" data-actor="'+esc(actor)+'">打开执行追溯 · 全部 '+full+' 步凭证</button></div>'+
      traceRows(list)+'</div>';
    return h;
  }
  /* 事件日志一律全量渲染（可滚动），不再截断成「最近 N 条」 */
  function logCard(){
    const ev=S.events.slice().reverse();
    return '<div class="card"><h3>事件日志（本任务全部 '+S.events.length+' 条）'+ro()+'</h3>'+
      '<p class="sub">不可变追加 · 按时间倒序 · 全量展示：触发、AI 产出、工具链签名、审批、打回、熔断、记忆确认都在此留痕，也是度量指标唯一的数据来源。自动执行步骤可点「凭证」下钻到完整执行凭证。</p>'+
      '<div class="log">'+ev.map(e=>'<div class="'+(RCP_FOCUS===e.id?'hl':'')+'" id="ev-'+esc(e.id)+'"><span class="t">'+fmt(e.ts)+'</span><span class="a '+e.actor+'">'+esc(e.actor)+'</span><span class="mono" style="flex:0 0 150px">'+esc(e.action)+'</span><span class="d">'+esc(e.detail)+'</span>'+
        (e.traceId?'<button class="lnk" data-nav="receipt" data-id="'+esc(e.traceId)+'">凭证</button>':'')+'</div>').join('')+'</div></div>';
  }
  /* ---- 跳转入口：全部使用 data-nav（查看导航），不占用 data-act（流程动作） ---- */
  function navLink(label,nav,id){
    return '<button class="lnk" data-nav="'+nav+'"'+(id?' data-id="'+esc(id)+'"':'')+'>'+esc(label)+'</button>';
  }
  /* 产出物名称词典：界面任何地方出现「PRD / Plan / Diff …」这类**产出物名**，
     只要该阶段确实已产出对应文件，就渲染成可跳到模拟文件的链接；没有文件则保持纯文本，不给死链。
     口径：只收录《输出文档》2.3 各阶段「产出物」栏里的产物名。
     「验收标准」不是独立产物——它是 PRD 内的内容（《输出文档》G1 产出物 =「结构化 PRD（含验收标准）」），
     故不建链接；「任务拆解」是 G3 阶段名，其产出物为 Task 清单（Task-Breakdown.md），保留跳转。 */
  const FILE_TERMS=[
    {term:'Context Brief',phase:'G0'},{term:'上下文摘要',phase:'G0'},
    {term:'PRD',phase:'G1'},
    {term:'Plan',phase:'G2'},{term:'实现计划',phase:'G2'},
    {term:'Task 清单',phase:'G3'},{term:'任务拆解',phase:'G3'},
    {term:'测试代码',phase:'G4',type:'test_code'},
    {term:'Diff',phase:'G4',type:'diff'},{term:'变更说明',phase:'G4',type:'diff'},
    {term:'验证报告',phase:'G5'},{term:'预审清单',phase:'G6'},
    {term:'用例矩阵',phase:'G7'},{term:'Changelog',phase:'G8'},{term:'发布单',phase:'G8'},
    {term:'诊断报告',phase:'G9'},{term:'候选记忆规则',phase:'G10'},
  ];
  function fileArtifact(t){
    const arts=S.artifacts.filter(a=>a.file&&a.phase===t.phase);
    if(t.type) return arts.find(a=>a.type===t.type)||null;
    return arts.find(a=>a.kind==='ai')||arts[0]||null;
  }
  function linkify(text){
    const s=String(text==null?'':text);
    if(!s) return '';
    const usable=FILE_TERMS.filter(t=>fileArtifact(t));
    if(!usable.length) return esc(s);
    const terms=usable.map(t=>t.term).slice().sort((a,b)=>b.length-a.length);
    const re=new RegExp('('+terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','g');
    let out='',last=0,m;
    while((m=re.exec(s))!==null){
      out+=esc(s.slice(last,m.index));
      const t=usable.find(x=>x.term===m[0]),art=t?fileArtifact(t):null;
      out+=art?navLink(m[0],'file',art.id):esc(m[0]);
      last=m.index+m[0].length;
      if(m[0].length===0) re.lastIndex++;
    }
    return out+esc(s.slice(last));
  }
  function kvTable(rows){
    return '<table class="kv">'+rows.map(r=>'<tr><td>'+esc(r[0])+'</td><td>'+r[1]+'</td></tr>').join('')+'</table>';
  }
  function itemsTable(items){
    if(!items||!items.length)return '<p class="hint">（0 条）</p>';
    const keys=[];
    items.forEach(o=>Object.keys(o).forEach(k=>{if(keys.indexOf(k)<0)keys.push(k);}));
    return '<table class="minitb"><tr>'+keys.map(k=>'<th>'+esc(k)+'</th>').join('')+'</tr>'+
      items.map(o=>'<tr>'+keys.map(k=>{
        const v=(o[k]&&typeof o[k]==='object')?esc(JSON.stringify(o[k])):linkify(o[k]);
        return '<td>'+v+'</td>';
      }).join('')+'</tr>').join('')+'</table>';
  }
  function receiptMatches(t){
    if(RCP_KIND==='project_memory'){
      const r=LOGIC.getReceipt(t);
      if(!(r&&r.inputs&&r.inputs.some(i=>i.kind==='project_memory'&&i.count>0)))return false;
    }
    if(RCP_ACTOR!=='all'&&t.actor!==RCP_ACTOR)return false;
    if(RCP_Q){
      const q=RCP_Q.toLowerCase();
      const hay=JSON.stringify({step:t.step,detail:t.detail,phase:t.phase,actor:t.actor,
        receipt:LOGIC.getReceipt(t)||t.receiptLite}).toLowerCase();
      if(hay.indexOf(q)<0)return false;
    }
    return true;
  }
  function receiptDetail(t){
    if(!t)return '<div class="rcp-detail"><p class="hint">没有匹配的凭证，试试清空搜索或切换筛选。</p></div>';
    const r=LOGIC.getReceipt(t);
    if(!r)return '<div class="rcp-detail"><p class="hint">凭证本体保存在外部存储（引用 '+esc(t.receiptRef?t.receiptRef.uri:'—')+'），本会话尚未加载。'+loadBtn(t.receiptRef?t.receiptRef.uri:null)+'</p></div>';
    const d=ts=>new Date(ts).toLocaleString('zh-CN');
    let h='<div class="rcp-detail"><div class="row" style="justify-content:space-between"><b>'+esc(r.what.step)+'</b>'+
      '<span class="badge '+(t.status==='fail'?'red':'green')+'">'+esc(r.result.status)+'</span></div>'+
      '<p class="sub">凭证 '+esc(r.refs.traceId)+' · '+esc(r.schema)+' · '+
      (r.simulated?'<span class="simtag">演示模拟执行</span>':'本系统内部编排动作')+'</p>';
    h+='<div class="sect">① 谁做的 · 执行主体</div>'+kvTable([
      ['主体 ID','<span class="mono">'+esc(r.who.id)+'</span>'],
      ['名称 / 类型',esc(r.who.name)+'（'+esc(r.who.kind)+'）'],
      ['运行时',esc(r.who.runtime)],['职责',esc(r.who.duty)],
      ['执行序号','本任务第 '+r.who.stepSeq+' 步'],
      ['模拟标注',esc(r.who.note)],
    ]);
    h+='<div class="sect">② 什么时候</div>'+kvTable([
      ['开始',esc(d(r.when.startedAt))],['结束',esc(d(r.when.endedAt))],
      ['耗时',r.when.durationMs+' ms'],['时钟',esc(r.when.clock)],
    ]);
    h+='<div class="sect">③ 在哪一步 · 上下文</div>'+kvTable([
      ['轮次 / 阶段','第 '+r.where.round+' 轮 · '+esc(r.where.phase)+' '+esc(r.where.phaseName)],
      ['Task',esc(r.where.taskId||'—')],['关联 AC',esc(r.where.acIds.join(', ')||'—')],
      ['动作',esc(r.what.step)],['描述',esc(r.what.detail)],
      ['内部函数',esc(r.what.fn||'（无状态变更，读取 / 编排类动作）')],
    ]);
    h+='<div class="sect">④ 如何加载 / 如何执行</div>'+kvTable(Object.keys(r.method).map(k=>{
      const v=r.method[k]; return [k,esc(typeof v==='object'?JSON.stringify(v):v)];
    }));
    h+='<div class="sect">⑤ 输入了什么 · 逐条可查</div>';
    r.inputs.forEach(i=>{
      h+='<div style="margin:9px 0 4px"><b>'+linkify(i.label)+'</b> <span class="mono">'+esc(i.kind)+' · 来源 '+esc(i.source)+' · '+i.count+' 条</span></div>';
      if(i.categories) h+='<p class="hint">分类口径（《输出文档》2.3 G0）：'+i.categories.map(c=>esc(c.name)+' '+c.loaded+' 条（'+esc(c.note)+'）').join('；')+'</p>';
      if(i.selector) h+='<p class="hint">过滤 '+esc(i.selector)+' · 排序 '+esc(i.orderBy||'—')+' · 注入 '+esc(i.injectedInto||'—')+'</p>';
      if(i.kind==='phase_def'&&i.items.length&&i.items[0]&&i.items[0].ai)
        h+='<p class="hint">本阶段产出物：'+linkify(i.items[0].ai)+' ｜ 机器证据：'+linkify(i.items[0].ev)+' ｜ 门禁判据：'+linkify(i.items[0].gate)+'</p>';
      h+=itemsTable(i.items);
    });
    h+='<div class="sect">⑥ 产出了什么 · 可跳转到文件 / 工件 / 证据</div>';
    if(r.outputs.length){
      h+='<table class="minitb"><tr><th>类型</th><th>ID / 标题</th><th>哈希或结果</th><th>跳转</th></tr>'+r.outputs.map(o=>'<tr>'+
        '<td>'+esc(o.kind)+'</td><td>'+esc(o.id)+' · '+linkify(o.title)+'</td>'+
        '<td class="mono">'+esc(o.hash||o.result||'')+'</td><td>'+
        (o.kind==='artifact'?(navLink('打开文件','file',o.id)+navLink('工件库','artifact',o.id)):navLink('证据库','evidence',o.id))+
        '</td></tr>').join('')+'</table>';
    }else h+='<p class="hint">'+esc(r.note||'本步骤不产生工件或证据（已显式留痕，非遗漏）。')+'</p>';
    h+='<div class="sect">⑦ 关联与反查</div>'+kvTable([
      ['事件日志',esc(r.refs.eventId)+' '+navLink('定位该事件','event',r.refs.eventId)],
      ['工件 ID',esc(r.refs.artifactIds.join(', ')||'—')],
      ['证据 ID',esc(r.refs.evidenceIds.join(', ')||'—')],
      ['项目记忆 ID',esc(r.refs.memoryIds.join(', ')||'—')+(r.refs.memoryIds.length?' '+navLink('查看注入记忆','memory'):'')],
      ['模拟文件路径',esc(r.refs.filePaths.join(', ')||'—')],
      ['commit / diff hash','<span class="mono">'+esc(r.refs.commitHash||'—')+' / '+esc(r.refs.diffHash||'—')+'</span>'],
    ]);
    h+='<div class="sect">⑧ 结果</div>'+kvTable([['状态',esc(r.result.status)],['返回信息',esc(r.result.message||'—')],
      ['说明',esc(r.note||'—')]]);
    h+='<div class="sect">⑨ 原始凭证 JSON（完整留痕）</div><details><summary>展开全文</summary><pre style="margin-top:8px">'+esc(JSON.stringify(r,null,2))+'</pre></details>';
    return h+'</div>';
  }
  function receiptPage(){
    const human=VIEW==='human';
    const all=S.traces.filter(receiptMatches);
    const sel=all.find(t=>t.id===RCP_SEL)||all[0]||null;
    const ok=S.traces.filter(t=>LOGIC.receiptOk(t)).length;
    let h=head(human?'执行追溯':'执行凭证（只读）',
      'AI / 工具链每一步的完整凭证 · 谁 / 何时 / 输入了什么 / 如何加载 / 产出什么 / 如何反查'+(human?'':ro()))+stepBanner();
    h+='<div class="notice info"><b>可追溯覆盖率 '+ok+' / '+S.traces.length+' 步'+(S.traces.length?'（'+Math.round(ok/S.traces.length*100)+'%）':'')+'：</b>'+
      '凭证由执行当时的真实状态快照生成，不是事后补写；输入明细（含项目记忆逐条 ID / 文本 / 来源 / 范围 / 命中次数）、加载规则、输出引用与事件 ID 全部可查。'+
      '未接入的项目基线如实标注 0 条，不伪造条目。</div>';
    h+='<div class="card"><div class="chipbar">'+
      [['all','全部'],['ai','AI'],['toolchain','工具链'],['system','系统']].map(x=>
        '<button class="chip '+(RCP_ACTOR===x[0]?'on':'')+'" data-nav="filter" data-actor="'+x[0]+'">'+x[1]+'</button>').join('')+
      '<input id="rcp-q" placeholder="搜索：步骤 / 主体 / 记忆条目 / 文件路径 / 工件 ID …" value="'+esc(RCP_Q)+'" style="max-width:330px">'+
      '<button class="chip" data-nav="quick-memory">项目记忆加载凭证</button>'+
      (RCP_KIND?'<button class="chip on" data-nav="filter" data-actor="all">已精确筛选：真正加载了记忆的步骤 ×</button>':'')+
      '<span class="mono">命中 '+all.length+' / '+S.traces.length+' 步</span>'+
      (RCP_Q?navLink('清空搜索','clear-q'):'')+'</div>';
    h+='<div class="rcp-wrap"><div class="rcp-list">'+(all.length?all.slice().reverse().map(t=>{
      const who=t.receiptLite&&t.receiptLite.who?t.receiptLite.who:'—';
      return '<button class="rcp-item '+(sel&&t.id===sel.id?'on':'')+'" data-nav="receipt" data-id="'+esc(t.id)+'">'+
        '<span class="r1">'+fmt(t.ts)+' · '+esc(t.phase)+' · '+esc(who)+'</span>'+
        '<span class="r2">'+esc(t.step)+'</span>'+
        '<span class="r3">'+esc(t.actor)+' · '+esc(String(t.detail).slice(0,58))+'</span></button>';
    }).join(''):'<p class="hint" style="padding:12px">没有匹配的凭证</p>')+'</div>'+receiptDetail(sel)+'</div></div>';
    return h;
  }
  /* 模拟文件预览：复现「评审人打开 PRD 阅读 → 回到审批台签字」的动作 */
  function hFile(){
    const a=S.artifacts.find(x=>x.id===FILE_ID)||S.artifacts.find(x=>x.file);
    if(!a||!a.file)return head('文件预览','演示模拟文件'+ro())+'<div class="card"><p class="hint">没有可打开的文件。请先到「工件库」选择一份产出。</p></div>';
    const f=a.file,p=LOGIC.cur(S);
    let h=head('文件预览 · '+f.name,'模拟文件 · 用于演练评审人「打开文件阅读 → 回到审批台签字」的动作')+stepBanner();
    h+='<div class="filebar"><span class="fp">'+esc(f.path)+'</span><span class="simtag">演示模拟文件 · 非真实仓库文件</span>'+
      '<span class="mono">'+esc(f.kind)+' · '+esc(f.encoding)+' · '+f.sizeBytes+' bytes · '+f.lineCount+' 行</span>'+
      navLink('返回审批台','desk')+(a.producedBy?navLink('产生该文件的执行凭证','receipt',a.producedBy):'')+'</div>';
    h+='<div class="grid2"><div class="card"><h3>文件元信息'+ro()+'</h3>'+kvTable([
      ['文件路径','<span class="mono">'+esc(f.path)+'</span>'],['文档类型',esc(f.kind)],
      ['建议评审人',esc(f.reviewer)],['内容哈希','<span class="mono">'+esc(f.hash)+'</span>'],
      ['字节 / 行数',f.sizeBytes+' bytes / '+f.lineCount+' 行'],
      ['生成自','<span class="mono">'+esc(f.generatedFrom)+'</span>'],
      ['模拟标注','由工件结构化数据展开生成，不写入真实仓库'],
    ])+'</div><div class="card"><h3>关联工件与门禁'+ro()+'</h3>'+kvTable([
      ['工件',esc(a.id)+' · '+linkify(a.title)],['阶段',esc(a.phase)],
      ['版本 / 哈希','v'+a.version+' · <span class="mono">'+esc(a.hash)+'</span>'],
      ['产出者',esc(a.producer)],['产生步骤',a.producedBy?esc(a.producedBy)+' '+navLink('查看凭证','receipt',a.producedBy):'—'],
      ['门禁',esc((LOGIC.PHASES.find(x=>x.id===a.phase)||{gate:'—'}).gate)],
      ['AI 自报','<span style="color:var(--red)">'+esc(a.selfReport||'—')+'</span>（不采信）'],
    ])+'</div></div>';
    h+='<div class="card"><h3>文件内容 · 全量可滚动'+ro()+'</h3>'+(function(){
      const c=LOGIC.fileContent(a);
      return c!==null&&c!==undefined?'<div class="fileview">'+esc(c)+'</div>'
        :'<p class="hint">文件内容本体保存在外部存储（引用 '+esc(f.ref?f.ref.uri:'—')+'）。'+loadBtn(f.ref?f.ref.uri:null)+'</p>';
    })()+'</div>';
    if(p&&a.phase===p.id&&LOGIC.autoCheck(S).passed){
      h+='<div class="card"><h3>模拟评审动作 · 阅读后签署门禁</h3>'+
        '<p class="sub">这就是评审时人的动作：打开 PRD / Plan / 验证报告阅读内容，然后批准或打回。一次批准即授权下一阶段自动执行。</p>'+
        '<div class="actions"><button class="primary" data-act="approve" '+(PLAY?'disabled':'')+'>批准放行并授权下一阶段</button>'+
        '<button class="danger" data-act="reject" '+(PLAY?'disabled':'')+'>打回</button></div>'+
        '<div class="row" style="margin-top:10px"><input id="reject-reason" placeholder="打回意见（必填）· 会在 G10 被提炼为项目记忆" style="max-width:520px"></div></div>';
    }else{
      h+='<div class="card"><h3>评审状态'+ro()+'</h3><p class="hint">'+
        (p&&a.phase===p.id?'当前阶段自动校验尚未全部通过，门禁锁定，请回审批台查看未达标项。':
          '该文件属于 '+esc(a.phase)+' 阶段，当前门禁不在该阶段；可回审批台继续流程。')+'</p></div>';
    }
    return h;
  }
  /* Task 卡片：显示每个 Task 的依赖、所在批次与独立评审状态。
     「可并行」= 依赖已满足且与批内其它 Task 文件不重叠；「待依赖」= 前置 Task 尚未签字。 */
  function taskStatusOf(x){
    const st=S.taskStep[x.id]||{};
    if(st.review==='ok') return {k:'done',label:'已签字',cls:'green'};
    if(S.escalated[x.id]) return {k:'frozen',label:'熔断待裁决',cls:'red'};
    if(!LOGIC.depsSatisfied(S,x)) return {k:'blocked',label:'等待依赖 '+x.deps.join('/'),cls:'gray'};
    if(st.test&&st.red&&st.impl&&st.green) return {k:'review',label:'待独立评审',cls:'amber'};
    if(st.review==='rejected') return {k:'redo',label:'打回待重做',cls:'amber'};
    if(st.test||st.red||st.impl) return {k:'running',label:'本批次执行中',cls:'amber'};
    return {k:'ready',label:'可开工',cls:'gray'};
  }
  /* G4 Task 依赖关系图（SVG DAG）：按依赖深度分层布局，
     节点颜色 = 执行状态（绿=已签字 / 红=熔断 / 琥珀=执行中或待评审 / 灰=未开工），
     箭头 = 前置依赖（前置 Task 签字后才开工）。 */
  function depGraph(){
    if(!S.tasks.length)return '';
    const byId={}; S.tasks.forEach(t=>byId[t.id]=t);
    const depth={};
    const dep=t=>{
      const ds=(t.deps||[]).filter(d=>byId[d]);
      if(!ds.length)return 0;
      return Math.max.apply(null,ds.map(d=>depth[d]!==undefined?depth[d]:dep(byId[d])))+1;
    };
    S.tasks.forEach(t=>{depth[t.id]=dep(t);});
    const layers=[];
    S.tasks.forEach(t=>{(layers[depth[t.id]]=layers[depth[t.id]]||[]).push(t);});
    const NW=128,NH=40,GX=64,GY=14,X0=10,Y0=10;
    const maxRows=Math.max.apply(null,layers.map(l=>l.length));
    const W=X0*2+layers.length*NW+(layers.length-1)*GX;
    const H=Y0*2+maxRows*NH+(maxRows-1)*GY;
    const pos={};
    layers.forEach((l,li)=>l.forEach((t,i)=>{
      pos[t.id]={x:X0+li*(NW+GX), y:Y0+i*(NH+GY)};
    }));
    const COLORS={green:'#2e9e5b',red:'#d64545',amber:'#d69a2e',gray:'#9aa4af'};
    let svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" style="max-width:100%;display:block" role="img" aria-label="Task 依赖关系图">';
    svg+='<defs><marker id="dep-arrow" markerWidth="9" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 9 3.5, 0 7" fill="#7a8694"/></marker></defs>';
    // 箭头：前置节点右缘中点 → 依赖节点左缘中点（绕行 y 微移避免重叠视觉）
    S.tasks.forEach(t=>(t.deps||[]).forEach(d=>{
      if(!pos[d]||!pos[t.id])return;
      const a=pos[d],b=pos[t.id];
      const x1=a.x+NW,y1=a.y+NH/2,x2=b.x,y2=b.y+NH/2;
      const mx=(x1+x2)/2;
      svg+='<path d="M '+x1+' '+y1+' C '+mx+' '+y1+', '+mx+' '+y2+', '+x2+' '+y2+'" fill="none" stroke="#7a8694" stroke-width="1.5" marker-end="url(#dep-arrow)"/>';
    }));
    S.tasks.forEach(t=>{
      const p=pos[t.id];if(!p)return;
      const ts=taskStatusOf(t);
      const col=COLORS[ts.cls]||COLORS.gray;
      svg+='<g><rect x="'+p.x+'" y="'+p.y+'" width="'+NW+'" height="'+NH+'" rx="8" fill="'+col+'22" stroke="'+col+'" stroke-width="1.5"/>'+
        '<text x="'+(p.x+10)+'" y="'+(p.y+17)+'" font-size="12" font-weight="600" fill="'+col+'">'+esc(t.id)+'</text>'+
        '<text x="'+(p.x+10)+'" y="'+(p.y+32)+'" font-size="10" fill="#5a6470">'+esc(ts.label)+'</text></g>';
    });
    svg+='</svg>';
    const legend='<div class="hint" style="margin-top:8px">节点颜色：绿色=已签字 · 红色=熔断待裁决 · 琥珀=执行中/待评审 · 灰=未开工；箭头指向被依赖解锁的 Task（前置签字后才开工）。</div>';
    return '<div style="overflow:auto;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg,#fafbfc)">'+svg+'</div>'+legend;
  }
  function taskCards(){
    const batch=LOGIC.batchIds(S);
    return '<div class="grid3">'+S.tasks.map((x)=>{
      const st=S.taskStep[x.id]||{},o=S.outOfScope[x.id]||{files:[]};
      const ts=taskStatusOf(x);
      const cls=ts.k==='done'?'done':(ts.k==='frozen'?'frozen':(ts.k==='running'||ts.k==='review'?'active':''));
      const inBatch=batch.indexOf(x.id)>=0;
      const steps=[['测试',st.test],['红',st.red],['实现',st.impl],['绿',st.green],['越界检测',S.evidences.some(e=>e.taskId===x.id&&e.type==='out_of_scope')],['Review',st.review==='ok']];
      return '<div class="taskcard '+cls+'"><div class="row"><b>'+x.id+'</b> '+esc(x.title)+' <span class="badge '+ts.cls+'">'+esc(ts.label)+'</span></div>'+
        '<div class="steps">'+steps.map(z=>'<span class="'+(z[1]?'on':'')+'">'+z[0]+(z[1]?' ✓':'')+'</span>').join('')+'</div>'+
        '<div class="mono">计划内：'+esc(x.scope.join(', '))+'</div>'+
        '<div class="mono">依赖：'+(x.deps&&x.deps.length?esc(x.deps.join(', '))+'（前置签字后才开工）':'无 · 可与同批 Task 并行')+
          (inBatch?' · <b>本批次并行</b>':'')+'</div>'+
        (o.files.length?'<div class="notice" style="margin:8px 0 0;padding:7px 10px">越界：'+esc(o.files.join(', '))+(o.explanation?'<br>已说明：'+esc(o.explanation):'<br><b>未说明，禁止 Review 通过</b>')+'</div>':'')+
        (S.failCount[x.id]?'<div class="mono" style="color:var(--red)">自测失败 '+S.failCount[x.id]+'/'+LOGIC.FAIL_LIMIT+(S.escalated[x.id]?' · 已熔断冻结':'')+'</div>':'')+'</div>';
    }).join('')+'</div>';
  }
  function memoryRO(m){
    const loads=S.traces.filter(t=>{const r=LOGIC.getReceipt(t);return r&&r.refs.memoryIds.indexOf(m.id)>=0;});
    return '<div class="mem"><div class="body"><div>'+esc(m.text)+'</div>'+
      '<div class="src">ID '+esc(m.id)+' · 分类 '+esc(m.category||'未分类')+' · 来源：'+esc(m.source)+' · 范围：'+esc(m.scope)+
      ' · 状态：'+esc(m.status)+' · 命中 '+(m.hits||0)+' 次 · 第 '+m.round+' 轮</div>'+
      '<div class="src">被 '+loads.length+' 个执行步骤真实加载：'+
      (loads.length?loads.slice(0,5).map(t=>navLink(t.id+' '+t.step,'receipt',t.id)).join(' '):'暂无（需下一轮 G0 加载）')+'</div></div></div>';
  }
  function memoryList(title,list,status){
    return '<div class="card"><h3>'+title+'（'+list.length+'）'+(status==='candidate'?'':ro())+'</h3>'+
      (list.length?list.map(m=>'<div class="mem"><div class="body"><div>'+esc(m.text)+'</div><div class="src">来源：'+esc(m.source)+' · 范围：'+esc(m.scope)+' · 命中 '+(m.hits||0)+' 次 · 第 '+m.round+' 轮</div></div><div class="row">'+
        (status==='candidate'?'<button class="primary" data-act="mem-ok" data-id="'+m.id+'">确认入库</button><button data-act="mem-no" data-id="'+m.id+'">否决</button>':'<span class="badge '+(status==='active'?'green':'gray')+'">'+(status==='active'?'已生效':'已撤销')+'</span>')+'</div></div>').join(''):'<p class="hint">暂无条目</p>')+'</div>';
  }

  /* ---- 人 · 工作台 ---- */
  /* 审批台快捷入口：一键直达当前阶段相关的工作页面（如 G4 循环 Review、G10 记忆确认） */
  function quickLinks(p){
    const c=[];
    if(p.id==='G4') c.push('<button class="chip" data-nav="goto-review">进入循环 Review 页（逐 Task 签字）</button>');
    if(p.id==='G10') c.push('<button class="chip" data-nav="goto-memory">进入记忆确认页</button>');
    c.push('<button class="chip" data-nav="receipt-all" data-actor="all">执行追溯</button>'+
      '<button class="chip" data-nav="goto-log">事件日志</button>'+
      '<button class="chip" data-nav="goto-artifacts">工件库</button>'+
      '<button class="chip" data-nav="goto-evidences">证据库</button>'+
      '<button class="chip" data-nav="goto-state">流程状态</button>');
    return '<div class="card" style="padding:10px 14px"><div class="chipbar"><span class="hint">快捷入口：</span>'+c.join('')+'</div></div>';
  }
  function hDesk(){
    const p=LOGIC.cur(S);
    let h=head('审批台','批准即授权下一阶段 · 先读执行授权单，再做一次判断 · 本页只有人的动作')+stepBanner();
    if(!p){
      h+='<div class="notice ok"><b>G0–G10 全部 11 道门禁已由人签署。</b> 本任务已闭环留档；可在「记忆确认」页<b>新建下一轮任务</b>（新任务继承本任务的生效项目记忆）。</div>'+
        '<div class="card"><h3>本轮结果</h3><p class="sub">共 '+S.approvals.length+' 道门禁 · '+S.artifacts.length+' 份工件 · '+S.evidences.length+' 份签名证据 · '+S.traces.length+' 条执行过程 · '+S.reviewNotes.length+' 次打回</p>'+
        '<div class="actions"><button class="primary" data-act="next-round">新建下一轮任务（验证记忆回流）</button></div></div>'+
        traceCard('本轮自动执行过程','all',14,true)+logCard();
      return h;
    }
    h+=quickLinks(p);
    const c=LOGIC.autoCheck(S),unmet=c.items.filter(i=>!i.ok).length;
    h+='<div class="notice '+(unmet?'':'ok')+'"><b>'+esc(p.seg)+' · '+p.id+' '+esc(p.name)+'</b> ｜ 门禁：'+linkify(p.gate)+'<br>'+
      (unmet?'还有 '+unmet+' 项自动校验未通过，门禁锁定。':'自动校验全部通过，门禁具备解锁条件，等待人签署。')+'</div>';
    h+=authCard();
    // 评审依据上移，紧邻审批动作：人先看产出与证据，再做一次判断
    const arts=S.artifacts.filter(a=>a.phase===p.id&&a.kind==='ai'),evs=S.evidences.filter(e=>e.phase===p.id&&e.kind==='stage');
    h+='<div class="grid2"><div class="card"><h3>审批依据 · AI 产出'+ro()+'</h3>'+(arts.length?arts.map(a=>
      '<div style="margin-bottom:10px"><b>'+linkify(a.title)+'</b><div class="mono">'+esc(a.id)+' · v'+a.version+' · '+a.hash+' · '+esc(a.producer)+'</div>'+
      '<div class="row" style="margin:5px 0">'+(a.file?navLink('打开 '+a.file.name+' 评审','file',a.id):'')+
      (a.producedBy?navLink('产生该工件的执行凭证','receipt',a.producedBy):'')+'</div>'+
      '<details><summary>查看结构化内容</summary>'+detailJSON(LOGIC.artData(a),a.ref&&a.ref.uri)+'</details></div>').join(''):'<p class="hint">尚无 AI 产出</p>')+
      '<div class="selfreport">AI 每次提交都附「<b>已自测全绿</b>」自报声明，系统不采信，仅作提示。评审时请点开上面的模拟文件阅读内容，再回到本页签署门禁。</div></div>';
    h+='<div class="card"><h3>审批依据 · 工具链证据'+ro()+'</h3>'+(evs.length?evs.map(e=>
      '<div style="margin-bottom:8px"><b>'+linkify(e.title)+'</b><div class="mono">'+esc(e.signer)+' · commit '+esc(e.commitHash)+' · diff '+e.diffHash+' · '+esc(e.result)+'</div>'+
      (e.producedBy?navLink('签名时的完整凭证','receipt',e.producedBy):'')+
      '<details><summary>查看证据载荷</summary>'+detailJSON(LOGIC.evData(e),e.ref&&e.ref.uri)+'</details></div>').join(''):'<p class="hint">尚无签名证据</p>')+'</div></div>';
    h+='<div class="card"><h3>我的动作 · 一次批准即授权下一阶段</h3>'+
      '<div class="actions">'+
      '<button class="primary" data-act="approve" '+(PLAY?'disabled':'')+'>批准放行并授权下一阶段</button>'+
      '<button class="danger" data-act="reject" '+(PLAY?'disabled':'')+'>打回</button>'+
      '<button class="ghost" data-act="skip-phase" '+(PLAY?'disabled':'')+'>跳过本阶段（精简流程）</button>'+
      triggerButton('手动触发执行（仅异常恢复）')+'</div>'+
      '<div class="row" style="margin-top:12px"><input id="reject-reason" placeholder="打回意见（必填）· 它会在 G10 被提炼为项目记忆" style="max-width:520px"></div>'+
      '<p class="hint">正常流转只需这一步：批准后系统按授权单自动启动下一阶段，AI 与工具链按 TDD 顺序执行并把过程逐步展示出来。打回、Review 通过、熔断裁决同样会连带重跑，无需再点触发。「手动触发」只用于刷新中断等异常恢复场景。</p>'+
      '<p class="hint"><b>精简流程：</b>普通开发任务可按需精简个别动作（例如普通改代码不需要 G9 运维）。点「跳过本阶段」并确认即可，跳过是一次正式的人工判断，会在门禁记录与事件日志中留痕，度量口径不受影响。</p></div>';
    h+=traceCard('自动执行过程（模拟）','all',10,true);
    h+=logCard();
    return h;
  }
  /* G4 逐 Task 的独立评审板：
     每个 Task 一张独立评审卡 —— 签字 / 打回 / 越界说明 / 裁决都只作用于它自己。
     批次并行的 Task 互不阻塞：T1 待审时 T2 也能单独签字，不必按顺序排队。 */
  function reviewTaskCard(t){
    const st=S.taskStep[t.id]||{},o=S.outOfScope[t.id]||{files:[]};
    const ts=taskStatusOf(t);
    const hasDiff=st.impl&&st.green&&S.evidences.some(e=>e.taskId===t.id&&e.type==='out_of_scope');
    const ready=hasDiff&&!PLAY&&!S.escalated[t.id];
    const needExplain=o.files.length&&!o.explanation;
    let h='<div class="card"><h3>我的动作 · '+t.id+' '+esc(t.title)+' <span class="badge '+ts.cls+'">'+esc(ts.label)+'</span></h3>';
    h+='<div class="mono" style="margin-bottom:8px">覆盖验收标准：'+esc(t.acs.join(', '))+' · 验证方式：'+esc(t.verify)+
       (t.deps&&t.deps.length?' · 依赖 '+esc(t.deps.join(', '))+'（已签字）':' · 无依赖')+'</div>';
    if(needExplain){
      h+='<div class="notice">检出计划外改动：'+esc(o.files.join(', '))+'。必须填写理由才能 Review 通过。</div>'+
        '<div class="row"><input id="scope-note-'+esc(t.id)+'" placeholder="为什么改动这些文件？说明会写入审计日志" style="max-width:520px">'+
        '<button data-act="explain" data-id="'+esc(t.id)+'">提交越界说明</button></div>';
    }
    if(S.escalated[t.id]){
      h+='<div class="actions"><button class="warn" data-act="arbitrate" data-id="'+esc(t.id)+'" '+(PLAY?'disabled':'')+'>裁决熔断异常</button>'+
        '<span class="why-dis">该 Task 自测失败超过 '+LOGIC.FAIL_LIMIT+' 次已冻结，裁决后恢复执行</span></div>';
    } else if(st.review==='ok'){
      h+='<p class="hint">该 Task 的 Diff 已由人签字通过。'+(LOGIC.allTasksReviewed(S)?'全部 Task 已签字，可回「审批台」批准 G4 门禁。':'其它 Task 仍可独立评审。')+'</p>';
    } else {
      h+='<div class="actions">'+
        '<button class="primary" data-act="review-ok" data-id="'+esc(t.id)+'" '+(ready?'':'disabled')+'>Review 通过</button>'+
        '<button class="danger" data-act="review-no" data-id="'+esc(t.id)+'" '+(ready?'':'disabled')+'>Review 打回</button>'+
        (!ready?'<span class="why-dis">前置未完成：正常应已自动执行；刷新中断请用「手动触发」恢复</span>':'')+'</div>'+
        '<div class="row" style="margin-top:11px"><input id="review-note-'+esc(t.id)+'" placeholder="Review 打回意见（可选）" style="max-width:520px"></div>';
    }
    h+='</div>';
    return h;
  }
  function hReview(){
    let h=head('循环 Review','G4 逐 Task 的人工签字、越界说明与异常裁决')+stepBanner();
    const p=LOGIC.cur(S);
    if(!p||p.id!=='G4'||!S.tasks.length) return h+'<div class="card"><h3>当前不在 G4 实现循环</h3><p class="sub">该页面只在 G4 阶段提供人的动作：Review Diff、填写越界说明、裁决失败熔断。</p></div>';
    const batch=LOGIC.batchIds(S);
    const pend=LOGIC.tasksAwaitingReview(S);
    const frozen=S.tasks.filter(t=>S.escalated[t.id]);
    // 并发说明：有多个 Task 同时处于可评审状态
    if(batch.length>1){
      h+='<div class="notice"><b>本批 '+batch.length+' 个 Task 并行执行：</b>'+esc(batch.join('、'))+
        '。它们依赖已满足且改动文件互不重叠，可以同时推进。<b>评审单位是单个 Task</b>：每个 Task 的 Diff 各自独立签字，互不阻塞 —— 不必等前一个 Task 走完。工具链证据分别绑定各自的 commit / diff hash，跨 Task 的集成回归由 G5 全量回归兜底。</div>';
    } else if(batch.length===1){
      h+='<div class="notice"><b>当前批次：</b>'+esc(batch[0])+'（依赖已满足）。本批只有它一个 Task 可开工。</div>';
    }
    h+='<div class="card"><h3>逐 Task 状态与批次'+ro()+'</h3>'+taskCards()+'</div>';
    h+='<div class="card"><h3>Task 依赖关系图'+ro()+'</h3>'+depGraph()+'</div>';
    // 授权单锚定「当前批次首个 Task」；批次内的其它 Task 各出自己的评审卡（见下）
    const anchor=LOGIC.taskById(S,batch[0])||S.tasks[0];
    if(anchor) h+=reviewCard(anchor);
    if(!batch.length&&!pend.length&&!frozen.length){
      h+='<div class="card"><h3>全部 Task 均已签字</h3><p class="sub">回到「审批台」批准 G4 门禁。</p></div>';
    }
    // 每个待评审 / 熔断的 Task 各出一张独立评审卡
    const shown=[];
    pend.concat(frozen).forEach(t=>{ if(shown.indexOf(t.id)<0) shown.push(t.id); });
    if(!shown.length&&batch.length) shown.push(batch[0]);
    shown.forEach(id=>{ const t=LOGIC.taskById(S,id); if(t) h+=reviewTaskCard(t); });
    // 批次级动作
    h+='<div class="card"><h3>我的动作 · 批次级恢复</h3><div class="actions">'+triggerButton('手动触发（仅异常恢复）')+
      '<button class="ghost" data-act="inject-fail" '+(PLAY?'disabled':'')+'>演示控制：注入自测失败</button></div>'+
      '<p class="hint">正常流转由人的判断自动授权：上一次批准 / Review 签字 / 裁决之后，AI 与工具链已自动跑完前置动作，这里只需签字。「注入自测失败」属于演示控制，不是流程角色动作。</p></div>';
    h+=traceCard('G4 批次执行过程','all',10)+logCard();
    return h;
  }
  function hMemory(){
    let h=head('记忆确认','只有人能决定哪些教训固化为长期约束')+stepBanner();
    const carried=LOGIC.activeMemory(S).length;
    h+='<div class="notice"><b>错误回流：</b>每次 Review 打回都会生成候选规则，只有人确认后才成为长期约束。当前任务有 <b>'+carried+'</b> 条生效记忆；各任务记忆库相互隔离，仅在新建下一轮任务时把已入库条目继承过去。</div>';
    h+=memoryList('候选规则 · 待人确认',S.memories.filter(m=>m.status==='candidate'),'candidate');
    h+=memoryList('已入库 · 跨任务复用',S.memories.filter(m=>m.status==='active'),'active');
    h+=memoryList('已否决',S.memories.filter(m=>m.status==='revoked'),'revoked');
    h+='<div class="card"><h3>我的动作 · 开启下一轮</h3><p class="sub"><b>开启下一轮 = 新建一个任务，不是把当前任务重置重跑。</b>'+
      '本任务（'+esc(S.parentTaskId?('派生自 '+S.parentTaskId):'当前任务')+'）的状态、工件、证据、审批与全部执行凭证保持原样留档，可随时回查；'+
      '系统会新建一个<b>独立的新任务</b>，把本任务已入库的 <b>'+carried+'</b> 条生效项目记忆继承过去，新任务从 G0 重新开始。'+
      '依据《输出文档》2.1「项目记忆持久化，跨任务复用」。</p>'+
      '<div class="row" style="margin:10px 0"><input id="next-task-name" placeholder="新任务名称（默认：'+esc(S.round+1)+' 轮）" style="max-width:420px"></div>'+
      '<div class="actions"><button class="primary" data-act="next-round">新建下一轮任务</button>'+
      (S.finishedAt?'':'<span class="why-dis">建议先跑完本轮 G0–G10 再开下一轮</span>')+'</div></div>';
    return h;
  }
  function hState(){
    let h=head('状态总览','只管流程状态与双层状态机'+ro())+stepBanner();
    h+='<div class="card"><h3>外层：G0–G10 · 11 道人工门禁</h3><div class="phasegrid">'+LOGIC.PHASES.map((p,i)=>'<div class="'+(i<S.phaseIdx?'done':i===S.phaseIdx?'now':'')+'"><span class="pid">'+p.id+'</span>'+esc(p.name)+'</div>').join('')+'</div>'+
      '<p class="hint">当前位置：<b>'+esc((LOGIC.cur(S)||{id:'本轮完成'}).id)+'</b> · 第 '+S.round+' 轮。每个箭头隐含一道人工门禁。</p></div>';
    const done=S.tasks.filter(t=>(S.taskStep[t.id]||{}).review==='ok').length;
    h+='<div class="grid2"><div class="card"><h3>内层：G4 实现循环</h3><p class="sub">'+done+' / '+S.tasks.length+' 个 Task 的 Diff 已由人签字</p>'+
      (S.tasks.length?S.tasks.map(t=>'<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--border);padding:7px 0"><span>'+t.id+' '+esc(t.title)+'</span><span class="badge '+((S.taskStep[t.id]||{}).review==='ok'?'green':'gray')+'">'+((S.taskStep[t.id]||{}).review==='ok'?'已签字':'待 Review')+'</span></div>').join(''):'<p class="hint">进入 G3 拆解后生成</p>')+'</div>';
    h+='<div class="card"><h3>系统边界 · 六件事</h3><div class="tag6"><span>状态</span><span>工件</span><span>证据</span><span>审批</span><span>记忆</span><span>度量</span></div>'+
      '<p class="hint" style="margin-top:14px"><b>不做什么：</b>不生成代码、不运行构建与测试、不托管源码、不采集线上缺陷。本原型用模拟适配器代替这些外部系统。</p>'+
      '<p class="hint"><b>系统只给人用：</b>人的一次判断即授权后续自动执行并守住门禁；AI 与工具链只有只读观测区，但每一步都有可下钻的完整凭证。</p></div></div>';
    h+='<div class="card"><h3>门禁记录</h3>'+(S.approvals.length?'<table><tr><th>门禁</th><th>提交次数</th><th>审批停留</th><th>签署人</th></tr>'+S.approvals.map(a=>'<tr><td>'+a.phase+'</td><td>第 '+a.attempt+' 次</td><td>'+(a.durationMs/1000).toFixed(1)+'s</td><td>人</td></tr>').join('')+'</table>':'<p class="hint">尚无门禁被签署</p>')+'</div>';
    return h;
  }
  function hArtifacts(){
    let h=head('工件库','结构化产出物 · 每份带版本与哈希'+ro())+stepBanner();
    h+='<div class="card"><h3>全部工件（'+S.artifacts.length+'）· 点文件即可打开评审'+ro()+'</h3>'+(S.artifacts.length?'<table><tr><th>ID</th><th>阶段</th><th>类型 / 标题</th><th>版本</th><th>哈希</th><th>产出者</th><th>模拟文件</th><th>产生步骤</th><th>内容</th></tr>'+
      S.artifacts.map(a=>'<tr class="'+(RCP_FOCUS===a.id?'hl':'')+'"><td class="mono">'+a.id+'</td><td>'+a.phase+'</td><td>'+linkify(a.title)+'</td><td>v'+a.version+'</td><td class="mono">'+a.hash+'</td><td>'+esc(a.producer)+'</td><td>'+
        (a.file?navLink(a.file.name,'file',a.id):'—')+'</td><td>'+(a.producedBy?navLink(a.producedBy,'receipt',a.producedBy):'—')+'</td>'+
        '<td><details><summary>查看 JSON</summary>'+detailJSON(LOGIC.artData(a),a.ref&&a.ref.uri)+'</details></td></tr>').join('')+'</table>':'<p class="hint">尚无工件</p>')+'</div>';
    const covered=S.acs.map(a=>({id:a.id,plan:(S.plan&&S.plan.acMap||{})[a.id]||null,tasks:S.tasks.filter(t=>t.acs.indexOf(a.id)>=0).map(t=>t.id)}));
    h+='<div class="card"><h3>追溯链 · AC → Plan → Task → 用例</h3><p class="sub">机器校验的依据：Plan 与验收标准一一对应、验收标准全覆盖。</p>'+
      (S.acs.length?'<table><tr><th>验收标准</th><th>可测试判据</th><th>Plan 改动点</th><th>覆盖 Task</th><th>用例矩阵</th></tr>'+covered.map(x=>{
        const ac=S.acs.find(a=>a.id===x.id),matrix=S.evidences.some(e=>e.phase==='G7');
        return '<tr><td class="mono">'+x.id+'</td><td>'+esc(ac.testable)+'</td><td>'+(x.plan?'<span class="badge green">'+esc(x.plan)+'</span>':'<span class="badge gray">未建立</span>')+'</td><td>'+(x.tasks.length?x.tasks.join(', '):'<span class="badge gray">未覆盖</span>')+'</td><td>'+(matrix?'<span class="badge green">已生成</span>':'<span class="badge gray">待 G7</span>')+'</td></tr>';
      }).join('')+'</table>':'<p class="hint">G1 批准后生成验收标准与追溯链。</p>')+'</div>';
    return h;
  }
  function hEvidences(){
    let h=head('证据库','只认工具链签名 · AI 自报不构成证据'+ro())+stepBanner();
    h+='<div class="notice"><b>为什么单独做一层：</b>「AI 觉得对 ≠ 对」。测试结果、Lint、覆盖率、越界检测必须由工具链产生并绑定 commit / diff hash，门禁引擎才认。</div>';
    h+='<div class="card"><h3>签名证据（'+S.evidences.length+'）· 每份可反查签名步骤'+ro()+'</h3>'+(S.evidences.length?'<table><tr><th>ID</th><th>阶段 / Task</th><th>证据</th><th>结果</th><th>签名者</th><th>diff hash</th><th>产生步骤</th><th>载荷</th></tr>'+
      S.evidences.map(e=>'<tr class="'+(RCP_FOCUS===e.id?'hl':'')+'"><td class="mono">'+e.id+'</td><td>'+e.phase+(e.taskId?' / '+e.taskId:'')+'</td><td>'+linkify(e.title)+'</td><td><span class="badge '+(e.result.indexOf('PASS')===0||e.result.indexOf('FAIL(EXPECTED)')===0?'green':e.result==='WARN'?'amber':'red')+'">'+esc(e.result)+'</span></td><td class="mono">'+esc(e.signer)+'</td><td class="mono">'+e.diffHash+'</td><td>'+
        (e.producedBy?navLink(e.producedBy,'receipt',e.producedBy):'—')+'</td><td><details><summary>查看</summary>'+detailJSON(LOGIC.evData(e),e.ref&&e.ref.uri)+'</details></td></tr>').join('')+'</table>':'<p class="hint">尚无证据</p>')+'</div>';
    const selfs=S.artifacts.filter(a=>a.selfReport);
    h+='<div class="card"><h3>AI 自报声明（不计入证据）</h3>'+(selfs.length?selfs.map(a=>'<div class="row" style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="mono">'+a.phase+' · '+a.id+'</span><span style="color:var(--red)">「'+esc(a.selfReport)+'」</span><span class="badge red">不采信</span></div>').join(''):'<p class="hint">暂无</p>')+'</div>';
    return h;
  }
  function hMetrics(){
    const ms=LOGIC.metrics(S);
    let h=head('度量','全部由本任务事件日志推导 · 不达标不进入下一推广阶段'+ro())+stepBanner();
    h+='<div class="notice">口径诚实标注：能由本系统事件直接算的标「真实」，近似替代的标「代理」，需要外部系统的<b>直接留空</b>。</div>';
    h+='<div class="grid3">'+ms.map(m=>'<div class="metric" style="border:1px solid var(--border);border-radius:10px;padding:13px 14px"><div class="k" style="font-size:12px;color:var(--muted)">'+esc(m.key)+'</div><div class="v" style="font-size:26px;font-weight:600;color:var(--primary);margin:4px 0">'+esc(m.value)+'</div><div class="d" style="font-size:11px;color:var(--faint)">'+esc(m.desc)+'</div></div>').join('')+'</div>'+logCard();
    return h;
  }
  function hLog(){return head('事件日志','本任务全流程不可变审计轨迹'+ro())+stepBanner()+logCard();}

  /* ---- AI / 工具链只读观测 ---- */
  function aTrace(){
    let h=head('AI 执行过程','触发后自动完成的模拟执行轨迹'+ro())+stepBanner();
    h+='<div class="notice"><b>这一区只用于观测。</b> AI 不是给人操作的界面：人在工作台做一次判断（批准 / 打回 / Review / 裁决），AI 与工具链按分工自动跑完。每一步可点「凭证」查完整输入与加载方式，事件日志在本任务内全量展示。</div>';
    h+=traceCard('AI 执行轨迹（含系统移交步骤）','ai',40);
    h+='<div class="card"><h3>本轮统计'+ro()+'</h3><p class="sub">AI 步骤 '+S.traces.filter(t=>t.actor==='ai').length+' · 工具链步骤 '+S.traces.filter(t=>t.actor==='toolchain').length+' · 系统步骤 '+S.traces.filter(t=>t.actor==='system').length+' · 事件 '+S.events.length+' 条</p></div>'+logCard();
    return h;
  }
  function aArtifacts(){
    const mine=S.artifacts.filter(a=>a.producer==='AI Agent');
    let h=head('AI 工件','仅展示由 AI Agent 自动产出的工件'+ro())+stepBanner();
    h+='<div class="card"><h3>产出清单（'+mine.length+'）· 文件与凭证均可点开'+ro()+'</h3>'+(mine.length?'<table><tr><th>ID</th><th>阶段</th><th>标题</th><th>版本</th><th>哈希</th><th>模拟文件</th><th>产生步骤</th><th>内容</th></tr>'+
      mine.map(a=>'<tr><td class="mono">'+a.id+'</td><td>'+a.phase+'</td><td>'+linkify(a.title)+'</td><td>v'+a.version+'</td><td class="mono">'+a.hash+'</td><td>'+
        (a.file?navLink(a.file.name,'file',a.id):'—')+'</td><td>'+(a.producedBy?navLink(a.producedBy,'receipt',a.producedBy):'—')+'</td>'+
        '<td><details><summary>查看 JSON</summary>'+detailJSON(LOGIC.artData(a),a.ref&&a.ref.uri)+'</details></td></tr>').join('')+'</table>':'<p class="hint">尚未产出工件</p>')+'</div>'+
      '<div class="card"><h3>产出约定'+ro()+'</h3><p class="sub">每阶段产出物是下一阶段的输入，格式结构化、带版本与哈希。工件的审批权不在 AI，且 AI 附带的「已自测全绿」自报声明不构成证据。</p></div>';
    return h;
  }
  function aMemory(){
    let h=head('注入记忆','这些约束会在每次 G0 自动加载，是 AI 执行时的输入'+ro())+stepBanner();
    const act=LOGIC.activeMemory(S),cand=S.memories.filter(m=>m.status==='candidate');
    h+='<div class="card"><h3>已生效约束（'+act.length+'）</h3>'+(act.length?act.map(memoryRO).join(''):'<p class="hint">本任务首轮暂无历史约束。人打回后产生的规则，经人确认即在此生效。</p>')+'</div>';
    h+='<div class="card"><h3>待确认候选（'+cand.length+'）</h3>'+(cand.length?cand.map(memoryRO).join(''):'<p class="hint">暂无</p>')+'<p class="hint">确认与否决由人在其「记忆确认」页完成，本区不提供该动作。</p></div>';
    return h;
  }
  function aState(){
    let h=head('流程状态','只读流程位置，用于说明 AI 在哪一步被授权执行'+ro())+stepBanner();
    h+='<div class="card"><h3>G0–G10 进度</h3><div class="phasegrid">'+LOGIC.PHASES.map((p,i)=>'<div class="'+(i<S.phaseIdx?'done':i===S.phaseIdx?'now':'')+'"><span class="pid">'+p.id+'</span>'+esc(p.name)+'</div>').join('')+'</div>'+
      '<p class="hint">当前第 '+S.round+' 轮 · 已产出 '+S.artifacts.filter(a=>a.producer==='AI Agent').length+' 份工件 · 生效约束 '+LOGIC.activeMemory(S).length+' 条。AI 不自行推进流程。</p></div>'+logCard();
    return h;
  }
  function tTrace(){
    let h=head('工具链执行记录','机器验证与证据签名的自动执行轨迹'+ro())+stepBanner();
    h+='<div class="notice"><b>这一区只用于观测。</b> 测试、Lint、覆盖率与越界检测由工具链在触发后自动执行并签名，人不需要也不可以在这里操作。</div>'+traceCard('工具链执行轨迹','toolchain',40)+logCard();
    return h;
  }
  function tEvidences(){
    let h=head('签名证据','仅展示由工具链自动签发的证据'+ro())+stepBanner();
    h+='<div class="card"><h3>证据清单（'+S.evidences.length+'）· 每份可反查签名凭证'+ro()+'</h3>'+(S.evidences.length?'<table><tr><th>ID</th><th>阶段 / Task</th><th>证据</th><th>结果</th><th>签名者</th><th>diff hash</th><th>产生步骤</th><th>载荷</th></tr>'+
      S.evidences.map(e=>'<tr><td class="mono">'+e.id+'</td><td>'+e.phase+(e.taskId?' / '+e.taskId:'')+'</td><td>'+linkify(e.title)+'</td><td><span class="badge '+(e.result.indexOf('PASS')===0||e.result.indexOf('FAIL(EXPECTED)')===0?'green':e.result==='WARN'?'amber':'red')+'">'+esc(e.result)+'</span></td><td class="mono">'+esc(e.signer)+'</td><td class="mono">'+e.diffHash+'</td><td>'+
        (e.producedBy?navLink(e.producedBy,'receipt',e.producedBy):'—')+'</td><td><details><summary>查看</summary>'+detailJSON(LOGIC.evData(e),e.ref&&e.ref.uri)+'</details></td></tr>').join('')+'</table>':'<p class="hint">尚未签发证据</p>')+'</div>'+
      '<div class="card"><h3>签名约定'+ro()+'</h3><p class="sub">证据只能由工具链产生，AI 自报不采信；签名后绑定 commit / diff hash，审批人据此判断。</p></div>';
    return h;
  }
  function tState(){
    let h=head('流程状态','只读流程位置，用于说明工具链在哪一步被授权执行'+ro())+stepBanner();
    h+='<div class="card"><h3>G0–G10 进度</h3><div class="phasegrid">'+LOGIC.PHASES.map((p,i)=>'<div class="'+(i<S.phaseIdx?'done':i===S.phaseIdx?'now':'')+'"><span class="pid">'+p.id+'</span>'+esc(p.name)+'</div>').join('')+'</div>'+
      '<p class="hint">当前第 '+S.round+' 轮 · 已签发 '+S.evidences.length+' 份证据。工具链不参与门禁审批，也不自行推进流程。</p></div>'+logCard();
    return h;
  }
  function renderView(){
    const t=TAB;
    if(t==='receipt')return receiptPage();          // 三个区都能随时查凭证
    if(t==='file'&&VIEW==='human')return hFile();   // 模拟文件只在人工作台打开
    if(VIEW==='human')
      return t==='desk'?hDesk():t==='review'?hReview():t==='memory'?hMemory():t==='state'?hState():t==='artifacts'?hArtifacts():t==='evidences'?hEvidences():t==='metrics'?hMetrics():hLog();
    if(VIEW==='ai')
      return t==='trace'?aTrace():t==='artifacts'?aArtifacts():t==='memory'?aMemory():aState();
    return t==='trace'?tTrace():t==='evidences'?tEvidences():tState();
  }
  /* ---- 浏览器返回键：站内导航入 history 栈，返回回上一站内页而非退出整站 ----
     每次「进入一个站内页面」push 一条 {gk:1,view,tab}；浏览器返回触发 popstate
     恢复到上一站内页；栈耗尽回到初始条目后，返回才会真正离开网站。
     环境无 history API（如自检桩）时自动降级为原行为。 */
  function canHistory(){ return typeof window!=='undefined'&&window.history&&typeof window.history.pushState==='function'&&typeof window.addEventListener==='function'; }
  function pushNav(){
    if(!canHistory())return;
    try{ window.history.pushState({gk:1,view:VIEW,tab:TAB},''); }catch(e){}
  }
  function handleNav(d){
    switch(d.nav){
      case 'receipt': RCP_SEL=d.id||null;RCP_Q='';RCP_KIND=null;RCP_ACTOR='all';TAB='receipt';break;
      case 'receipt-all': RCP_SEL=null;RCP_Q='';RCP_KIND=null;RCP_ACTOR=(d.actor&&d.actor!=='all')?d.actor:'all';TAB='receipt';break;
      case 'filter': RCP_ACTOR=d.actor||'all';RCP_KIND=null;RCP_SEL=null;TAB='receipt';break;
      case 'clear-q': RCP_Q='';RCP_KIND=null;TAB='receipt';break;
      case 'quick-memory': RCP_KIND='project_memory';RCP_Q='';RCP_ACTOR='all';RCP_SEL=null;TAB='receipt';break;
      case 'file': FILE_ID=d.id||null;VIEW='human';TAB='file';break;
      case 'desk': VIEW='human';TAB='desk';break;
      case 'artifact': RCP_FOCUS=d.id;VIEW='human';TAB='artifacts';break;
      case 'evidence': RCP_FOCUS=d.id;VIEW='human';TAB='evidences';break;
      case 'memory': RCP_FOCUS=d.id||null;VIEW='ai';TAB='memory';break;
      case 'event': RCP_FOCUS=d.id;VIEW='human';TAB='log';break;
      case 'open-receipt': openInstance(d.task);RCP_SEL=null;RCP_Q='';RCP_KIND=null;RCP_ACTOR='all';TAB='receipt';break;
      case 'open-file': openInstance(d.task);FILE_ID=d.id;TAB='file';break;
      case 'open-task': openInstance(d.task);TAB='desk';break;   // 血缘跳转：回到源任务看已闭环留档
      // 审批台快捷入口：直达各步骤页面
      case 'goto-review': VIEW='human';TAB='review';break;
      case 'goto-memory': VIEW='human';TAB='memory';break;
      case 'goto-log': VIEW='human';TAB='log';break;
      case 'goto-artifacts': VIEW='human';TAB='artifacts';break;
      case 'goto-evidences': VIEW='human';TAB='evidences';break;
      case 'goto-state': VIEW='human';TAB='state';break;
      case 'trace-toggle': TRACE_OPEN=!TRACE_OPEN;break;   // 回放卡收起 / 展开（不切页）
      // 内容本体异步加载：从外部存储插件读回后重渲染
      case 'load-ref': if(typeof GKSTORE!=='undefined'){GKSTORE.read(d.uri).then(()=>render());}break;
    }
    // 「进入一个页面」类导航才入 history 栈；筛选 / 收起等视图内微操作不产生历史条目
    if(['receipt','receipt-all','file','desk','artifact','evidence','memory','event',
        'open-receipt','open-file','open-task','goto-review','goto-memory','goto-log',
        'goto-artifacts','goto-evidences','goto-state'].indexOf(d.nav)>=0) pushNav();
    render();
  }
  function render(){
    if(!ROOT.instances.length&&VIEW!=='overview')VIEW='overview'; // 空工作区只能停留在总览
    const ov=VIEW==='overview',inst=activeInst();
    document.getElementById('side').style.display=ov?'none':'block';
    document.getElementById('rolestrip').style.display=ov?'none':'flex';
    document.getElementById('crumb').textContent=ov?'总览':(inst?('总览 / '+inst.id+' '+inst.name):'总览');
    document.getElementById('backBtn').style.display=ov?'none':'inline-block';
    const keep={};
    ['reject-reason','scope-note','review-note','new-task-name','rcp-q','ov-q'].forEach(id=>{const n=document.getElementById(id);if(n)keep[id]=n.value;});
    // 按 Task 编号的独立评审输入框也要保留
    (S&&S.tasks||[]).forEach(t=>{['scope-note-','review-note-'].forEach(pfx=>{const n=document.getElementById(pfx+t.id);if(n)keep[pfx+t.id]=n.value;});});
    if(!ov&&inst)renderSide();
    document.getElementById('main').innerHTML=ov?overviewPage():renderView();
    Object.keys(keep).forEach(id=>{const n=document.getElementById(id);if(n)n.value=keep[id];});
  }
  function openInstance(id){
    syncCurrent();
    const inst=ROOT.instances.find(i=>i.id===id);
    if(!inst)return;
    ROOT.activeId=id;S=inst.state;VIEW='human';TAB='desk';PLAY=null;
    save();render();
  }
  document.addEventListener('change',e=>{
    if(e.target&&e.target.id==='rcp-q'){RCP_Q=String(e.target.value||'');RCP_SEL=null;render();}
    if(e.target&&e.target.id==='ov-q'){OV_Q=String(e.target.value||'');render();}
  });
  document.addEventListener('click',e=>{
    const nv=e.target.closest('[data-nav]');
    if(nv){handleNav(nv.dataset);return;}
    const vb=e.target.closest('[data-view]');
    if(vb){VIEW=vb.dataset.view;TAB=(WS[VIEW]||WS.human).tabs[0][0];pushNav();render();return;}
    const tb=e.target.closest('[data-tab]');
    if(tb){TAB=tb.dataset.tab;pushNav();render();return;}
    const el=e.target.closest('[data-act]');
    if(!el)return;
    const a=el.dataset.act;
    const val=id=>{const n=document.getElementById(id);return n?n.value:'';};
    switch(a){
      case 'open': openInstance(el.dataset.id);pushNav();break;
      case 'back':
        // 浏览器语义的返回：站内导航栈里能退就退一步（回到上一站内页）；
        // 栈里没有站内条目（或环境不支持 history）才退回总览
        if(canHistory()&&VIEW!=='overview'){ try{window.history.back();}catch(e){} break; }
        syncCurrent();VIEW='overview';PLAY=null;save();render();break;
      case 'skip-phase': {
        const cp=LOGIC.cur(S);if(!cp)break;
        if(!confirm('确定跳过 '+cp.id+' '+cp.name+'？\n该门禁将记为「精简跳过」留痕（可在门禁记录与事件日志中查证），随后进入下一阶段。'))break;
        dispatch(()=>LOGIC.skipPhase(S,'human','人工选择精简流程'),
          cp?('人精简流程：跳过 '+cp.id+'，授权下一阶段自动执行'):null,'PHASE_SKIP_AUTHORIZED');
        break;
      }
      case 'new-task': {
        const name=String(val('new-task-name')||'').trim();
        if(!name){toast('请先填写任务名称',false);return;}
        syncCurrent();
        const id='TASK-'+ROOT.nextId++;
        const inst={id,name,desc:'新建开发任务 · 从 G0 开始',owner:'我',createdAt:Date.now(),state:LOGIC.createState(1,[])};
        ROOT.instances.unshift(inst);ROOT.activeId=id;S=inst.state;VIEW='human';TAB='desk';PLAY=null;
        pushNav();save();render();toast('已创建 '+id+' 并进入流程，G0 已授权自动执行',true);
        startAutoRun('新建开发任务 · 授权 G0 自动执行','TASK_AUTHORIZED_G0');break;
      }
      // manual-run 只用于刷新中断等异常恢复；trigger 保留为兼容别名
      case 'manual-run': case 'trigger': triggerRun();break;
      case 'approve': {
        const nx=LOGIC.PHASES[S.phaseIdx+1];
        dispatch(()=>LOGIC.approve(S,'human'),
          nx?('人签署门禁放行，按执行授权单启动 '+nx.id+' '+nx.name):null,
          'GATE_AUTHORIZED_NEXT_RUN');
        break;
      }
      case 'reject': dispatch(()=>LOGIC.reject(S,'human',val('reject-reason')),
        '人打回并给出修正意见，授权本阶段自动重做','REWORK_AUTHORIZED');break;
      // 每个 Task 独立评审：动作带上被评审的 Task ID，互不影响
      case 'review-ok': dispatch(()=>LOGIC.reviewTask(S,'human','ok','',el.dataset.id||null),
        '人 Review 签字通过（'+(el.dataset.id||'当前 Task')+'），授权后续自动执行','REVIEW_AUTHORIZED_NEXT_TASK');break;
      case 'review-no': dispatch(()=>LOGIC.reviewTask(S,'human','no',val('review-note-'+(el.dataset.id||''))||val('review-note'),el.dataset.id||null),
        '人 Review 打回（'+(el.dataset.id||'当前 Task')+'），授权 AI 按意见修订','REVIEW_REWORK_AUTHORIZED');break;
      case 'arbitrate': dispatch(()=>LOGIC.arbitrate(S,'human',el.dataset.id||null),
        '人裁决熔断异常（'+(el.dataset.id||'当前 Task')+'），授权恢复执行','ARBITRATION_AUTHORIZED');break;
      case 'inject-fail': dispatch(()=>LOGIC.simulateFail(S,'toolchain',el.dataset.id||null));break;
      case 'explain': dispatch(()=>LOGIC.explainOutOfScope(S,'human',val('scope-note-'+(el.dataset.id||''))||val('scope-note'),el.dataset.id||null));break;
      case 'mem-ok': dispatch(()=>LOGIC.confirmMemory(S,el.dataset.id,'human'));break;
      case 'mem-no': dispatch(()=>LOGIC.revokeMemory(S,el.dataset.id,'human'));break;
      // 开启下一轮 = 新建一个任务（不是把当前任务清空重跑）。
      // 源任务保持已闭环留档，新任务继承生效记忆并从 G0 重新开始。
      case 'next-round': {
        const from=activeInst();
        const name=String(val('next-task-name')||'').trim();
        const r=LOGIC.createNextTask(ROOT,from,'human',name?{name}:{});
        if(!r.ok){toast(r.msg,false);return;}
        syncCurrent();
        ROOT.instances.unshift(r.instance);
        ROOT.activeId=r.instance.id;
        S=r.instance.state;
        TAB='desk'; VIEW='human'; PLAY=null;
        pushNav();save(); render();
        toast(r.msg,true);
        startAutoRun('人开启下一轮：新建 '+r.instance.id+' 并授权 G0 自动加载继承的项目记忆','ROUND_AUTHORIZED');
        break;
      }
      // ---- 多任务管理：重命名 / 归档 / 恢复 / 删除 ----
      case 'rename-task': {
        const inst=ROOT.instances.find(x=>x.id===el.dataset.id);if(!inst)break;
        const name=prompt('修改任务名称：',inst.name);
        if(name===null)break;
        if(!name.trim()){toast('名称不能为空',false);break;}
        syncCurrent();inst.name=name.trim();save();render();toast('已重命名为「'+inst.name+'」',true);break;
      }
      case 'archive-task': {
        const inst=ROOT.instances.find(x=>x.id===el.dataset.id);if(!inst)break;
        syncCurrent();inst.archived=true;
        if(ROOT.activeId===inst.id){ROOT.activeId=null;S=activeInst()?activeInst().state:null;VIEW='overview';PLAY=null;}
        save();render();toast('已归档 '+inst.id+'，可在「已归档」区恢复',true);break;
      }
      case 'unarchive-task': {
        const inst=ROOT.instances.find(x=>x.id===el.dataset.id);if(!inst)break;
        syncCurrent();inst.archived=false;save();render();toast('已恢复 '+inst.id,true);break;
      }
      case 'del-task': {
        const inst=ROOT.instances.find(x=>x.id===el.dataset.id);if(!inst)break;
        if(!confirm('确定删除任务 '+inst.id+'「'+inst.name+'」？\n该任务的状态、工件、证据、审批与事件日志将一并删除，且不可恢复。\n如需保留痕迹，请使用「归档」。'))break;
        syncCurrent();ROOT.instances=ROOT.instances.filter(x=>x.id!==inst.id);
        if(ROOT.activeId===inst.id){ROOT.activeId=null;S=activeInst()?activeInst().state:null;}
        VIEW='overview';PLAY=null;save();render();toast('已删除 '+inst.id,true);break;
      }
      // ---- 数据安全：导出 / 导入 ----
      case 'export-data': {
        syncCurrent();
        const blob=new Blob([JSON.stringify({app:'gatekeeper',version:2,exportedAt:new Date().toISOString(),data:ROOT},null,1)],{type:'application/json'});
        const a=document.createElement('a');a.href=URL.createObjectURL(blob);
        a.download='gatekeeper-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();
        setTimeout(()=>URL.revokeObjectURL(a.href),4000);
        toast('备份已导出（'+ROOT.instances.length+' 个任务）',true);break;
      }
      case 'import-data': document.getElementById('importFile').click();break;
      case 'clear-ov-q': OV_Q='';render();break;
      // ---- 首次使用引导 ----
      case 'onboard-seed':
        try{localStorage.setItem(KEY_ONBOARD,'1');}catch(e){}
        hideModal();save();render();toast('已载入示例任务，可随时删除或归档',true);break;
      case 'onboard-blank':
        try{localStorage.setItem(KEY_ONBOARD,'1');}catch(e){}
        PLAY=null;ROOT=LOGIC.createEmptyRoot();S=null;VIEW='overview';TAB='desk';
        save();render();toast('已创建空白工作区，从下方新建第一个任务开始',true);break;
      case 'modal-close': hideModal();break;
      // ---- 内容存储（插件化）：切换外部存储 / 选目录 / 导出引用清单 ----
      case 'store-settings': showStoreSettings();break;
      case 'store-pick-dir': {
        const fs=GKSTORE.getPlugin('fs-dir');
        if(!fs){toast('当前浏览器不支持文件目录访问（File System Access API）',false);break;}
        fs.pick().then(name=>{GKSTORE.setActive('fs-dir');save();render();
          toast('已连接本地目录「'+name+'」，历史内容已同步写入，内容本体此后以真实文件保存',true);
          showStoreSettings();})
          .catch(err=>{if(err&&err.name!=='AbortError')toast('选择目录失败：'+err.message,false);});
        break;
      }
      case 'store-use-vfs': GKSTORE.setActive('virtual-fs');save();render();showStoreSettings();toast('已切换为虚拟内容仓',true);break;
      case 'store-export-manifest': {
        const m=GKSTORE.exportManifest();
        const blob=new Blob([JSON.stringify(m,null,1)],{type:'application/json'});
        const a=document.createElement('a');a.href=URL.createObjectURL(blob);
        a.download='gatekeeper-content-manifest.json';a.click();
        setTimeout(()=>URL.revokeObjectURL(a.href),4000);
        toast('引用清单已导出（'+m.entries.length+' 条内容引用）',true);break;
      }
      case 'reset': if(confirm('重置全部数据？所有任务的状态、工件、证据、执行过程、记忆与事件都会回到初始示例。')){PLAY=null;ROOT=LOGIC.createSeedRoot();S=activeInst().state;VIEW='overview';TAB='desk';save();render();toast('已重置为示例数据',true);}break;
    }
  });
  document.getElementById('modal').addEventListener('click',e=>{if(e.target.id==='modal')hideModal();});
  document.getElementById('importFile').addEventListener('change',e=>{
    const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;
    const rd=new FileReader();
    rd.onload=()=>{
      try{
        const obj=JSON.parse(String(rd.result));
        const x=sanitizeRoot(obj&&obj.data?obj.data:obj);
        if(!x)throw new Error('不是有效的 Gatekeeper 备份文件');
        if(!confirm('导入将覆盖当前全部任务数据（共 '+x.instances.length+' 个任务），确定继续？'))return;
        PLAY=null;ROOT=x;S=activeInst()?activeInst().state:null;VIEW='overview';TAB='desk';
        save();render();toast('备份已导入：'+x.instances.length+' 个任务',true);
      }catch(err){toast('导入失败：'+err.message,false);}
    };
    rd.readAsText(f);
  });
  function showModal(html){document.getElementById('modal-box').innerHTML=html;document.getElementById('modal').style.display='flex';}
  function hideModal(){document.getElementById('modal').style.display='none';}
  /* 内容存储设置：展示插件列表 / 状态，支持切换插件、连接真实目录、导出引用清单 */
  function showStoreSettings(){
    const ps=GKSTORE.plugins(),act=GKSTORE.active(),st=GKSTORE.stats();
    const canDir=!!GKSTORE.getPlugin('fs-dir');
    let h='<h3 style="margin:0 0 6px;font-size:17px">内容存储（插件化）</h3>'+
      '<p class="hint" style="margin:0 0 10px">系统状态里<b>只保存引用 {uri, hash, sizeBytes}</b>，不放内容本体。文档 / 产物 / 证据 / 执行凭证等内容一律由存储插件写入外部存储，凭 hash 校验完整性。对接新的外部模块（Git 仓库、日志仓库、对象存储…）只需注册新插件并切换，引用格式不变。</p>';
    h+='<div style="margin-bottom:10px">'+ps.map(p=>
      '<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--border);padding:7px 0">'+
      '<span><b>'+esc(p.name)+'</b><br><span class="hint">'+esc(p.desc)+'</span><br><span class="hint">状态：'+esc(p.status.desc)+'</span></span>'+
      (p.id===act.id?'<span class="badge green">当前</span>':(p.id==='fs-dir'?'<button class="mini" data-act="store-pick-dir">选择目录并切换</button>':(p.id==='virtual-fs'?'<button class="mini" data-act="store-use-vfs">切换</button>':'')))+
      '</div>').join('')+'</div>';
    h+='<div class="hint" style="margin-bottom:10px">当前插件「'+esc(act.name)+'」共 <b>'+st.count+'</b> 条内容 · '+st.bytes+' bytes</div>';
    h+='<div class="row" style="justify-content:flex-end;gap:8px">'+
      '<button data-act="store-export-manifest">导出引用清单</button>'+
      '<button class="primary" data-act="modal-close">完成</button></div>';
    showModal(h);
  }
  function showOnboard(){
    showModal(
      '<h3 style="margin:0 0 6px;font-size:17px">欢迎使用流程管控台 Gatekeeper</h3>'+
      '<p class="hint" style="margin:0 0 10px">这是一套「AI 参与的软件开发流程」的日常管理工具：每个开发任务是一个独立的 G0–G10 流程实例，AI 负责生成与验证，<b>每道门禁由你签署后才放行</b>，复盘教训沉淀为项目记忆供后续任务复用。</p>'+
      '<ul class="todo" style="margin:0 0 14px">'+
      '<li><span class="mk ck">✓</span><span class="txt"><b>人 · 工作台</b>：审批门禁、Review Diff、裁决异常、确认记忆</span></li>'+
      '<li><span class="mk dot2">·</span><span class="txt"><b>AI / 工具链观测区</b>：只读，查看每步执行凭证与证据</span></li>'+
      '<li><span class="mk dot2">·</span><span class="txt">数据保存在本机浏览器，建议定期「导出备份」</span></li></ul>'+
      '<div class="row" style="justify-content:flex-end;gap:8px">'+
      '<button data-act="onboard-blank">空白开始</button>'+
      '<button class="primary" data-act="onboard-seed">载入示例任务</button></div>');
  }
  render();
  if(canHistory()){
    // 初始条目入栈（replace，不产生新历史），此后浏览器返回键逐条回退站内页
    try{ window.history.replaceState({gk:1,view:VIEW,tab:TAB},''); }catch(e){}
    window.addEventListener('popstate',e=>{
      const st=e.state;
      if(st&&st.gk){VIEW=st.view;TAB=st.tab;}
      else{VIEW='overview';TAB='desk';}
      PLAY=null;
      render();
    });
  }
  if(FIRST_RUN&&!onboarded())showOnboard();
})();
