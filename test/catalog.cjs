const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const file = require('node:path').join(__dirname, '../src/warehouse.html');
const html = fs.readFileSync(file, 'utf8');
const core = html.match(/<script id="wl-model">([\s\S]*?)<\/script>/)[1];
const context = vm.createContext({});
vm.runInContext(core, context);
const M = context.WarehouseCatalog;
const c = M.createCatalog();
let checks = 0;
function check(name, test) { test(); checks++; console.log('PASS', name); }
check('Catalog ids and database counts are consistent', () => {
  assert.equal(c.tables.length, 2404);
  assert.equal(c.dbs.length, 12);
  assert.equal(c.byId.size, c.tables.length);
  assert.equal([...c.byDb.values()].reduce((n, v) => n + v.length, 0), 2404);
  c.edges.forEach(e => { assert(c.byId.has(e.from)); assert(c.byId.has(e.to)); });
});
check('ODS is sync and DWD mirrors ODS without field renaming', () => {
  c.tables.filter(t => t.zone === 'dwd').forEach(t => {
    const [e] = c.incoming.get(t.id);
    assert.equal(e.type, 'mirror');
    assert.equal(c.byId.get(e.from).zone, 'ods');
    assert.equal(JSON.stringify(t.fields), JSON.stringify(c.byId.get(e.from).fields));
    e.mapping.forEach(([a, b]) => assert.equal(a, b));
  });
  c.tables.filter(t => t.zone === 'ods').forEach(t => {
    const [e] = c.incoming.get(t.id);
    assert.equal(e.type, 'sync');
    assert.equal(c.byId.get(e.from).zone, 'tidb');
  });
});
check('Upstream traversal follows all three join inputs', () => {
  const g = M.neighborhood(c, 'hive_tmp.company_risk_001', 3, 'up');
  assert.equal(g.nodes.length, 10);
  assert.equal(g.edges.length, 9);
  for (const domain of ['enterprise', 'justice', 'ip']) {
    assert(g.nodes.some(id => id.startsWith('tidb_' + domain + '.')));
  }
});
check('Downstream traversal does not accidentally include co-input ancestors', () => {
  const g = M.neighborhood(c, 'tidb_enterprise.company_base', 3, 'down');
  assert.equal(g.nodes.length, 4);
  assert.equal(g.edges.length, 3);
  assert(g.nodes.includes('hive_tmp.company_risk_001'));
  assert(!g.nodes.some(id => id.includes('_justice.')));
});
check('Bidirectional exploration never zigzags through a sibling input', () => {
  const g = M.neighborhood(c, 'dwd_enterprise.company_base', 3, 'both');
  assert.equal(g.nodes.length, 4);
  assert(!g.nodes.some(id => id.includes('_justice.')));
});
check('Visible subgraphs obey node cap and retain valid endpoints', () => {
  const g = M.neighborhood(c, 'hive_tmp.company_risk_001', 3, 'up', 4);
  assert.equal(g.nodes.length, 4);
  assert.equal(g.total, 10);
  assert.equal(g.omitted, 6);
  g.edges.forEach(e => { assert(g.nodes.includes(e.from)); assert(g.nodes.includes(e.to)); });
});
check('Cycles terminate and deduplicate nodes', () => {
  const cyclic = M.createCatalog(12);
  const from = 'hive_tmp.company_risk_001', to = 'tidb_enterprise.company_base';
  const edge = {from, to, type: 'derive'};
  cyclic.edges.push(edge);
  cyclic.outgoing.get(from).push(edge);
  cyclic.incoming.get(to).push(edge);
  const g = M.neighborhood(cyclic, to, 50, 'both', 100);
  assert.equal(new Set(g.nodes).size, g.nodes.length);
  assert(g.nodes.length < 20);
});
check('Every mapped field exists on its endpoint', () => {
  c.edges.forEach(e => e.mapping.forEach(([a,b]) => {
    assert(c.byId.get(e.from).fields.some(f => f[0] === a));
    assert(c.byId.get(e.to).fields.some(f => f[0] === b));
  }));
});
check('Database pagination has no overlap and clamps invalid pages', () => {
  const first=M.list(c,{db:'hive_tmp',page:0}),second=M.list(c,{db:'hive_tmp',page:1});
  assert.equal(first.rows.length,12);
  assert.equal(first.pages,20);
  assert(!second.rows.some(t => first.rows.some(s => s.id === t.id)));
  assert.equal(M.list(c,{db:'hive_tmp',page:999}).page,19);
  assert.equal(M.list(c,{db:'hive_tmp',page:-3}).page,0);
});
check('Search matches fields and names across the entire catalog', () => {
  assert.equal(M.list(c,{query:'ENTERPRISE_NAME'}).total,240);
  assert.equal(M.list(c,{query:'companyName'}).total,2160);
  assert.equal(M.list(c,{query:'没有这张表'}).total,0);
  assert.equal(M.list(c,{query:'hive_tmp.company_risk_001'}).rows[0].id,'hive_tmp.company_risk_001');
});
check('Read and lineage exploration do not mutate source tables', () => {
  const before=JSON.stringify(c.tables);
  for(let i=0;i<100;i++) M.neighborhood(c,c.tables[i].id,3,'both');
  M.list(c,{query:'company',page:2});
  assert.equal(JSON.stringify(c.tables),before);
});
check('Legacy pedestrian transport carries copies and returns empty', () => {
  const carrying=M.transportAt(32*.25),returning=M.transportAt(32*.75);
  assert.equal(carrying.phase,'载货运输');
  assert.equal(carrying.cargo,true);
  assert.equal(carrying.returning,false);
  assert(carrying.lift<=.22);
  assert.equal(returning.phase,'空叉返程');
  assert.equal(returning.cargo,false);
  assert.equal(returning.returning,true);
  assert.equal(M.transportAt(32*.98).phase,'等待下一批');
});
check('Legacy pedestrian routes retain continuous positions', () => {
  for(const boundary of [.1,.46,.58,.94]){
    const before=M.transportAt(32*(boundary-.00001)),after=M.transportAt(32*(boundary+.00001));
    assert(Math.abs(before.fraction-after.fraction)<.0001);
    assert(Number.isFinite(before.lift)&&Number.isFinite(after.lift));
  }
  const points=[[-12.7,4.7],[-12.7,6],[-4.3,6],[-4.3,4.7]];
  const start=M.routeAt(points,0),end=M.routeAt(points,1);
  assert.equal(start.x,-12.7);assert.equal(start.z,4.7);
  assert(Math.abs(end.x+4.3)<1e-9);assert(Math.abs(end.z-4.7)<1e-9);
  assert.equal(M.routeAt(points,.5,true).angle-M.routeAt(points,.5,false).angle,Math.PI);
});
const plans=M.createFleetPlans();
const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
check('Dedicated vehicle swept envelopes are disjoint even at arbitrary phases', () => {
  assert.equal(plans.length,3);
  for(let i=0;i<plans.length-1;i++){
    const a=plans[i],b=plans[i+1];
    const gap=b.bounds.minX-a.bounds.maxX-a.radius-b.radius;
    assert(gap>=M.clearance,`${a.id}/${b.id} clearance ${gap}`);
  }
  for(const plan of plans)for(let t=0;t<plan.duration;t+=.005){
    const p=M.forkliftAt(plan,t);
    assert(p.x>=plan.bounds.minX-1e-8&&p.x<=plan.bounds.maxX+1e-8);
    assert(p.z>=plan.bounds.minZ-1e-8&&p.z<=plan.bounds.maxZ+1e-8);
    // All storage/racks/bollards are at z <= 4.65; vehicle envelope is >= 5.08.
    assert(p.z-plan.radius>4.65);
    // Parked delivery truck occupies z >= 11.46, outside the entire swept apron.
    assert(p.z+plan.radius<11.46);
  }
});
check('Pose, fork height and heading stay continuous at every phase and cycle boundary', () => {
  for(const plan of plans)for(const stage of plan.stages){
    const t=stage.start-plan.offset;
    const a=M.forkliftAt(plan,t-1e-6),b=M.forkliftAt(plan,t+1e-6);
    assert(Math.hypot(a.x-b.x,a.z-b.z)<1e-6,`${plan.id} position ${stage.phase}`);
    assert(Math.abs(angleDelta(a.angle,b.angle))<1e-6,`${plan.id} heading ${stage.phase}`);
    assert(Math.abs(a.lift-b.lift)<1e-6,`${plan.id} lift ${stage.phase}`);
  }
});
check('Vehicle translation follows heading, reversing only in explicit reverse phases', () => {
  for(const plan of plans)for(let t=0;t<plan.duration;t+=.017){
    const a=M.forkliftAt(plan,t),b=M.forkliftAt(plan,t+.00001);
    const dx=b.x-a.x,dz=b.z-a.z,dist=Math.hypot(dx,dz);
    if(dist<1e-9)continue;
    const alignment=(dx*Math.sin(a.angle)+dz*Math.cos(a.angle))/dist;
    assert(Math.abs(alignment-(a.reverse?-1:1))<1e-4);
    assert(Math.abs(angleDelta(a.angle,b.angle))/.00001<1.8,'Excessive yaw rate');
  }
});
check('Pickup and delivery change pallet ownership without position or height jumps', () => {
  for(const plan of plans){
    for(const phase of ['抬升副本','交付副本']){
      const s=plan.stages.find(s=>s.phase===phase),t=s.start-plan.offset;
      const a=M.forkliftAt(plan,t-1e-6),b=M.forkliftAt(plan,t+1e-6);
      assert.equal(a.cargo,phase==='交付副本');assert.equal(b.cargo,phase==='抬升副本');
      const x=phase==='抬升副本'?plan.sourceX:plan.targetX;
      for(const p of [a,b]){
        const palletX=p.x+Math.sin(p.angle)*1.51*plan.scale;
        const palletZ=p.z+Math.cos(p.angle)*1.51*plan.scale;
        assert(Math.abs(palletX-x)<1e-6);
        assert(Math.abs(palletZ-(plan.dock-1.51*plan.scale))<1e-6);
        assert(Math.abs(p.lift-.04)<1e-6);
      }
    }
    for(let t=0;t<plan.duration;t+=.01){
      const p=M.forkliftAt(plan,t);
      assert.equal(Number(p.cargo)+Number(p.source)+Number(p.target),1,'One task pallet owner at a time');
      if(p.phase.includes('空'))assert(!p.cargo);
      if(p.moving&&p.cargo)assert.equal(p.lift,.22);
    }
  }
});
check('Forward/reverse gear changes are stationary, not instant U turns', () => {
  for(const plan of plans)for(let i=1;i<plan.stages.length;i++){
    const stage=plan.stages[i],prev=plan.stages[i-1];
    if(stage.reverse===prev.reverse)continue;
    const t=stage.start-plan.offset;
    const a=M.forkliftAt(plan,t-.0001),b=M.forkliftAt(plan,t+.0001);
    assert(Math.hypot(b.x-a.x,b.z-a.z)/.0002<.001);
    assert(Math.abs(angleDelta(a.angle,b.angle))<.001);
  }
});
check('Round tires have no erroneous spin; both renderers use shared vehicle poses', () => {
  assert(!html.includes('w.rotation.y=motion.moving'));
  assert(html.includes("'dark',g,40)"));
  assert(html.includes('M.forkliftAt(actor.plan,simTime)'));
  assert(html.includes('M.forkliftAt(actor.plan,seconds)'));
  assert(html.includes('三维未启用'));
});
check('Outdoor databases contain permanent tables and isolated mock quality lineage', () => {
  assert.equal(c.byDb.get('demo_raw_capture').length,3);
  assert.equal(c.byDb.get('demo_quarantine').length,1);
  const incoming=c.incoming.get('demo_quarantine.rejected_records');
  assert.equal(incoming.length,3);
  incoming.forEach(e=>{assert(e.from.startsWith('demo_raw_capture.'));assert.equal(e.verified,false);assert.equal(e.type,'derive');});
  for(const t of c.byDb.get('demo_raw_capture')){
    assert.equal(t.zone,'intake');
    assert(t.fields.some(f=>f[0]==='batch_id'));
    const g=M.neighborhood(c,t.id,5,'down');
    assert(!g.nodes.some(id=>id.startsWith('tidb_')),'Do not invent production ingestion lineage');
  }
});
check('Outdoor circuit is closed, has continuous heading, and cannot intersect indoor routes', () => {
  for(const boundary of [0,5,15,21,31,39,48,52,55,61,64]){
    const a=M.outdoorAt(boundary-1e-7),b=M.outdoorAt(boundary+1e-7);
    assert(Math.hypot(a.x-b.x,a.z-b.z)<1e-5);
    assert(Math.abs(angleDelta(a.angle,b.angle))<1e-5);
  }
  for(let t=0;t<128;t+=.005){
    const p=M.outdoorAt(t),b=M.outdoorAt(t+.00001);
    assert(p.z>=23-1e-9&&p.z<=27+1e-9);
    assert(p.x>=-15-1e-9&&p.x<=15+1e-9);
    for(const plan of plans)assert(p.z-1.4>plan.bounds.maxZ+plan.radius+M.clearance);
    const distance=Math.hypot(b.x-p.x,b.z-p.z);
    if(distance>1e-9)assert((Math.sin(p.angle)*(b.x-p.x)+Math.cos(p.angle)*(b.z-p.z))/distance>.9999);
  }
  assert.equal(M.outdoorAt(54).cargo,false);
  assert.equal(M.outdoorAt(25).cargo,true);
});
check('All script blocks parse, static selectors exist, and HTML ids are unique', () => {
  for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) if(m[1].trim())new vm.Script(m[1]);
  const allIds=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  const ids=new Set(allIds);
  assert.equal(ids.size,allIds.length,'Duplicate HTML id');
  for(const m of html.matchAll(/\$\('#([^']+)'\)/g))assert(ids.has(m[1]),m[1]);
});
console.log(JSON.stringify({checks,tables:c.tables.length,databases:c.dbs.length,lineageEdges:c.edges.length,bytes:Buffer.byteLength(html)}));
