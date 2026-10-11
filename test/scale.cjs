const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const html=fs.readFileSync(path.join(__dirname,'../src/warehouse.html'),'utf8'),context=vm.createContext({});
vm.runInContext(html.match(/<script id="wl-model">([\s\S]*?)<\/script>/)[1],context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/lazy-catalog.js'),'utf8'),context);
const M=context.WarehouseCatalog,started=performance.now(),c=M.createLazyCatalog(1000000);
assert.equal(c.tables.length,10000004);assert.equal(c.edges.length,8333337);
assert(c.cacheInfo().size===0);
let checks=0;function check(name,fn){fn();checks++;console.log('PASS',name);}
check('Deep pagination allocates only the requested page',()=>{
  const p=M.list(c,{db:'tidb_enterprise',page:80000});
  assert.equal(p.rows.length,12);assert.equal(p.rows[0].index,960000);assert.equal(p.total,1000000);
  assert(c.cacheInfo().size<=12);
});
check('Virtual names and adjacency match the small reference catalog',()=>{
  const eager=M.createCatalog(24),lazy=M.createLazyCatalog(24);
  for(const t of eager.tables){
    const actual=lazy.byId.get(t.id);assert(actual);assert.equal(actual.name,t.name);assert.equal(actual.index,t.index);
    for(const key of ['incoming','outgoing'])assert.equal(JSON.stringify(lazy[key].get(t.id).map(e=>[e.id,e.type,e.mapping])),JSON.stringify(eager[key].get(t.id).map(e=>[e.id,e.type,e.mapping])));
  }
  assert.equal(lazy.byId.get('hive_tmp.company_risk_000'),undefined);
  assert.equal(lazy.byId.get('tidb_enterprise.company_base_0001'),undefined);
});
check('Exact full-name lookup reaches the last table without scanning',()=>{
  const p=M.list(c,{query:'hive_tmp.company_risk_1000000'});
  assert.equal(p.rows[0].index,999999);assert.equal(p.scanned,1);assert(!p.truncated);
});
check('Search exposes truncation and respects the scan budget',()=>{
  const p=M.list(c,{query:'company'});
  assert(p.truncated);assert.equal(p.scanned,10000);assert(p.rows.length<=12);
  assert(c.cacheInfo().size<=512);
  const all=M.list(c,{db:'demo_raw_capture',query:'payload'});assert.equal(all.total,3);assert(!all.truncated);
});
check('Late-table lineage stays local and does not enumerate global edges',()=>{
  const g=M.neighborhood(c,'hive_tmp.company_risk_1000000',3,'up');
  assert.equal(g.nodes.length,10);assert.equal(g.edges.length,9);assert(g.visitedEdges<20);
  assert(c.cacheInfo().size<=512);
});
check('Traversal hard caps apply even to pathological fanout',()=>{
  const fanout={byId:{has:()=>true},incoming:{get:()=>[]},outgoing:{get:id=>id==='root'?Array.from({length:10000},(_,i)=>({id:'e'+i,from:'root',to:'n'+i})):[]}};
  const g=M.neighborhood(fanout,'root',3,'down',24);
  assert(g.truncated);assert.equal(g.nodes.length,24);assert(g.total<=256);assert(g.visitedEdges<=1024);assert(g.edges.length<=64);
});
check('Lazy adapter rejects unsafe scale and unbounded page allocation',()=>{
  assert.throws(()=>M.createLazyCatalog(Infinity));assert.throws(()=>c.byDb.get('tidb_enterprise').slice(0,1000000));
  assert.equal(M.list(c,{db:'missing'}).rows.length,0);
});
console.log(JSON.stringify({scaleChecks:checks,virtualTables:c.tables.length,virtualEdges:c.edges.length,cache:c.cacheInfo(),elapsedMs:Math.round(performance.now()-started),note:'Generated metadata model only; not a real database performance benchmark'}));
