/* ============================================================
   GKSTORE · 内容存储插件层
   ------------------------------------------------------------
   架构约束（重要）：
   系统状态（gatekeeper-v1）里【只放引用，不放内容本体】。
   文档 / 产物 / 上下文 / 证据载荷 / 执行凭证等内容，一律通过本层
   的插件写入外部存储；系统内只保留 {uri, hash, sizeBytes} 引用，
   凭 hash 可校验内容未被篡改，凭 uri 可随时取回。

   插件接口契约（实现以下字段即可接入）：
   {
     id: 'my-plugin',            // 唯一 ID
     name: '显示名',
     desc: '说明存到哪里',
     sync: true|false,           // true = get 可同步返回内容
     status(): {ok, desc},       // 当前可用性
     put(path, content): {hash, sizeBytes},        // 写入内容（path 如 'artifact/A-001.json'）
     get(path): string|null,     // 同步读取（sync 插件必须支持；异步插件可返回缓存或 null）
     read(path): Promise<string>,// 异步读取（所有插件必须支持）
     remove(path), list(): [{path,hash,sizeBytes}],
   }

   内置插件：
   · virtual-fs —— 虚拟内容仓（浏览器持久化在独立 localStorage 键，Node 为内存），
     作为默认 / 兜底插件；内容与流程状态分离，升级到真实文件系统插件后可整体迁移。
   · fs-dir —— 真实文件目录（File System Access API）：用户选定任务目录后，
     内容以真实文件写入磁盘（<目录>/<kind>/<id>），系统状态里依旧只有引用。

   升级方式：对接新的外部模块（Git 仓库 / 日志仓库 / 对象存储…）时，
   只需 registerPlugin 一个新适配器并 setActive，状态与引用格式不变。
   ============================================================ */
const GKSTORE = (() => {
  const LS_VFS = 'gkstore-vfs';           // virtual-fs 的内容持久化键（独立于流程状态）
  const plugins = [];
  let active = null;

  function hash(str){
    let h = 2166136261;
    for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h,16777619); }
    return (h>>>0).toString(16).padStart(8,'0') + 'c0';
  }
  function byteLen(str){ let n=0; for(let i=0;i<str.length;i++) n += str.charCodeAt(i)>255?3:1; return n; }

  /* ---- 内置：虚拟内容仓 ---- */
  const vfs = (() => {
    let m = null;
    try{ const raw = localStorage.getItem(LS_VFS); if(raw) m = new Map(Object.entries(JSON.parse(raw))); }catch(e){}
    if(!m) m = new Map();
    let dirty = false;
    return {
      id:'virtual-fs', name:'虚拟内容仓（内置兜底）', sync:true,
      desc:'内容与流程状态分离，持久化在浏览器独立存储区；升级到文件目录插件后可整体导出迁移',
      status(){ return {ok:true, desc:'可用 · 共 '+m.size+' 条内容'}; },
      put(path, content){ m.set(path, content); dirty = true; persist(); return {hash:hash(content), sizeBytes:byteLen(content)}; },
      get(path){ return m.has(path) ? m.get(path) : null; },
      read(path){ return Promise.resolve(this.get(path)); },
      remove(path){ m.delete(path); dirty = true; persist(); },
      list(){ const a=[]; m.forEach((v,k)=>a.push({path:k,hash:hash(v),sizeBytes:byteLen(v)})); return a; },
      _flush(){ if(dirty) persist(); },
    };
    function persist(){
      if(dirty && typeof localStorage!=='undefined'){
        try{ localStorage.setItem(LS_VFS, JSON.stringify(Object.fromEntries(m))); dirty = false; }catch(e){}
      }
    }
  })();

  /* ---- 内置：真实文件目录（File System Access API） ----
     put 先写内存缓存（保证同会话内同步可读），实际落盘排队异步执行；
     刷新 / 导出前由 UI 调 flush() 落盘。 */
  const fsDir = (typeof window!=='undefined' && window.showDirectoryPicker) ? {
    id:'fs-dir', name:'本地任务目录（真实文件）', sync:true,
    desc:'内容以真实文件写入你选定的目录（<目录>/<类型>/<ID>.json|.md），可纳入 Git / 同步盘管理',
    dir:null, cache:new Map(), queue:new Map(),
    status(){ return {ok:!!this.dir, desc:this.dir?('已连接目录 · 待落盘 '+this.queue.size+' 个文件'):'尚未选择目录'}; },
    async pick(){
      this.dir = await window.showDirectoryPicker({mode:'readwrite'});
      // 已有内容迁移：把 virtual-fs 里的内容整体写入新目录
      vfs.list().forEach(e=>{ if(!this.queue.has(e.path)) this.queue.set(e.path, vfs.get(e.path)); });
      return this.flush().then(()=>this.dir.name);
    },
    put(path, content){
      this.cache.set(path, content); this.queue.set(path, content);
      return {hash:hash(content), sizeBytes:byteLen(content)};
    },
    get(path){ return this.cache.has(path) ? this.cache.get(path) : null; },
    async read(path){
      if(this.cache.has(path)) return this.cache.get(path);
      if(!this.dir) return null;
      try{
        const seg = path.split('/'); const name = seg.pop();
        let dir = this.dir;
        for(const s of seg) dir = await dir.getDirectoryHandle(s, {create:false});
        const fh = await dir.getFileHandle(name, {create:false});
        const c = await fh.text();
        this.cache.set(path, c);
        return c;
      }catch(e){ return null; }
    },
    remove(path){ this.cache.delete(path); this.queue.delete(path); },
    list(){ const a=[]; this.cache.forEach((v,k)=>a.push({path:k,hash:hash(v),sizeBytes:byteLen(v)})); return a; },
    async flush(){
      if(!this.dir) return 0;
      const jobs = Array.from(this.queue.entries()); this.queue.clear();
      for(const [path, content] of jobs){
        try{
          const seg = path.split('/'); const name = seg.pop();
          let dir = this.dir;
          for(const s of seg) dir = await dir.getDirectoryHandle(s, {create:true});
          const fh = await dir.getFileHandle(name, {create:true});
          const w = await fh.createWritable(); await w.write(content); await w.close();
        }catch(e){ this.queue.set(path, content); }   // 失败重新排队，不丢内容
      }
      return jobs.length;
    },
  } : null;

  function register(p){
    if(!p||!p.id||typeof p.put!=='function'||typeof p.read!=='function') throw new Error('存储插件接口不完整：需要 id/put/read');
    if(!plugins.some(x=>x.id===p.id)) plugins.push(p);
    if(!active) active = p;
    return p;
  }
  register(vfs);
  if(fsDir) register(fsDir);
  try{ const sel = localStorage.getItem('gkstore-active'); if(sel){ const p = plugins.find(x=>x.id===sel); if(p) active = p; } }catch(e){}

  function setActive(id){
    const p = plugins.find(x=>x.id===id);
    if(!p) return {ok:false, msg:'未注册的存储插件：'+id};
    active = p;
    try{ localStorage.setItem('gkstore-active', id); }catch(e){}
    return {ok:true, msg:'内容存储已切换为「'+p.name+'」'};
  }
  function put(path, content){
    const str = (typeof content==='string') ? content : JSON.stringify(content,null,1);
    const r = active.put(path, str);
    return {uri:'gk://'+path, path, hash:r.hash, sizeBytes:r.sizeBytes, plugin:active.id};
  }
  function pathOf(uri){ return typeof uri==='string' && uri.indexOf('gk://')===0 ? uri.slice(5) : (uri||null); }
  function get(uri){ const p=pathOf(uri); return p===null?null:active.get(p); }
  function read(uri){ const p=pathOf(uri); return p===null?Promise.resolve(null):active.read(p); }
  function hydrate(ref){ // {uri,hash} → string|null（同步；取不到返回 null，由调用方走异步 read）
    if(!ref||!ref.uri) return null;
    const c = get(ref.uri);
    return c!==null && ref.hash ? (hash(c)===ref.hash ? c : c) : c;
  }
  function remove(uri){ const p=pathOf(uri); if(p!==null) active.remove(p); }
  function flush(){ if(active._flush) active._flush(); if(active.flush) return active.flush(); return Promise.resolve(0); }
  function stats(){
    const l = active.list();
    return {plugin:active.id, count:l.length, bytes:l.reduce((n,e)=>n+e.sizeBytes,0)};
  }
  function exportManifest(){
    return {app:'gatekeeper-content-manifest', version:1, exportedAt:new Date().toISOString(),
      plugin:active.id, entries:active.list()};
  }
  return {hash, registerPlugin:register, plugins:()=>plugins.map(p=>({id:p.id,name:p.name,desc:p.desc,status:p.status(),sync:p.sync})),
    getPlugin:id=>plugins.find(p=>p.id===id)||null,
    active:()=>active, setActive, put, get, read, hydrate, remove, flush, stats, exportManifest, pathOf,
    _vfs:vfs};
})();
if(typeof module!=='undefined') module.exports = GKSTORE;
