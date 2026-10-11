// DOM/scene-graph smoke checks only. No browser, GPU, or screenshot is used.
// npm packages: jsdom@26.1.0 and three@0.160.1 (resolve via NODE_PATH).
const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const THREE=require('three');
const file = require('node:path').join(__dirname, '../src/warehouse.html');
const html=fs.readFileSync(file,'utf8');
function setup(mode){
  const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e));
  const built=fs.readFileSync(require('node:path').join(__dirname,'../dist/index.html'),'utf8');
  const dom=new JSDOM(built,{runScripts:'outside-only',virtualConsole:console});
  const w=dom.window;let callback=null,scene=null,now=0;
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  w.ResizeObserver=class{observe(){}disconnect(){}};
  w.requestAnimationFrame=fn=>{callback=fn;return 1;};w.performance.now=()=>now;
  w.openai={setWidgetState:()=>Promise.resolve()};
  Object.defineProperty(w.HTMLElement.prototype,'clientWidth',{get:()=>1024});
  Object.defineProperty(w.HTMLElement.prototype,'clientHeight',{get:()=>650});
  const computed=w.getComputedStyle.bind(w);w.getComputedStyle=el=>el.tagName==='SPAN'?{color:'#eef1f2'}:computed(el);
  if(mode!=='missing')w.THREE={...THREE,WebGLRenderer:class{
    constructor(){if(mode==='webgl-error')throw Error('WebGL deliberately unavailable');this.domElement=w.document.createElement('canvas');this.shadowMap={};}
    setPixelRatio(){}setSize(){}dispose(){}render(s){scene=s;s.updateMatrixWorld(true);}
  }};
  for(const script of w.document.querySelectorAll('script')){
    if(script.getAttribute('src')==='./lazy-catalog.js')w.eval(fs.readFileSync(require('node:path').join(__dirname,'../src/lazy-catalog.js'),'utf8'));
    else if(!script.hasAttribute('src'))w.eval(script.textContent);
  }
  return {w,errors,get scene(){return scene;},advance(seconds=.06){for(let t=0;t<seconds-1e-9;t+=.05){now+=50;callback(now);}},close:()=>dom.window.close()};
}
for(const mode of ['missing','webgl-error']){
  const r=setup(mode),d=r.w.document;r.advance();
  assert.equal(d.querySelector('#warehouse-lineage').dataset.renderer,'fallback');
  assert.equal(d.querySelectorAll('[data-vehicle]').length,3);
  assert(d.querySelector('#wl-total').textContent.includes('10,000,004'));
  assert(d.querySelector('#wl-scope').textContent.includes('三维未启用'));
  assert(d.querySelector('#wl-camera').disabled);
  const vehicle=d.querySelector('[data-outdoor-vehicle="collector"]');
  const before=vehicle.getAttribute('transform');r.advance(8);assert.notEqual(vehicle.getAttribute('transform'),before);
  d.querySelector('#wl-play').click();const paused=vehicle.getAttribute('transform');r.advance(2);assert.equal(vehicle.getAttribute('transform'),paused);
  d.querySelector('#wl-catalog-toggle').click();assert(!d.querySelector('#wl-catalog').hidden);
  d.querySelector('[data-table]').click();assert(!d.querySelector('#wl-inspector').hidden);
  assert(d.querySelector('#wl-copy').disabled);
  d.querySelector('[data-operation="source"]').click();assert(d.querySelector('#wl-op-title').textContent.includes('来源'));
  d.querySelector('#wl-op-note [data-table]').click();assert(d.querySelector('#wl-fqn').textContent.includes('demo_raw_capture.company_payload'));
  d.querySelector('[data-detail="relations"]').click();assert(d.querySelector('#wl-detail').textContent.includes('demo_quarantine'));
  d.querySelector('#wl-outdoor').click();assert.equal(d.querySelector('#wl-outdoor').getAttribute('aria-pressed'),'false');
  assert.equal(r.errors.length,0);r.close();process.stdout.write(`PASS ${mode}: shared motion, pause, catalog, honest fallback\n`);
}
const r=setup('webgl'),d=r.w.document;r.advance();
assert.equal(d.querySelector('#warehouse-lineage').dataset.renderer,'webgl');
const scene=r.scene;
// Discover by operation tags, avoiding assumptions about light / group indices.
const groups=scene.children.filter(o=>o.isGroup);
const worldGroup=groups[0],contentGroup=groups[1],machineGroup=groups[3];
const vehicles=machineGroup.children.filter(o=>['sync','mirror','analysis'].includes(o.userData.operation));
assert.equal(vehicles.length,3);
const outdoor=worldGroup.getObjectByName('outdoor-intake'),truck=worldGroup.getObjectByName('collection-vehicle');assert(outdoor&&truck);
const M=r.w.WarehouseCatalog,vector=new THREE.Vector3();
for(const vehicle of vehicles){
  let radius=0;vehicle.traverse(mesh=>{if(!mesh.isMesh)return;const points=mesh.geometry.attributes.position;
    for(let i=0;i<points.count;i++){vector.fromBufferAttribute(points,i).applyMatrix4(mesh.matrixWorld);radius=Math.max(radius,Math.hypot(vector.x-vehicle.position.x,vector.z-vehicle.position.z));}
  });assert(radius<=M.forkliftRadius,`${vehicle.userData.operation} actual mesh radius ${radius}`);
}
const obstacles=[];
for(const group of [worldGroup,contentGroup])group.traverse(mesh=>{
  for(let node=mesh;node;node=node.parent)if(node===truck)return;
  if(!mesh.isMesh)return;for(let node=mesh;node;node=node.parent)if(!node.visible)return;const bounds=new THREE.Box3().setFromObject(mesh);
  if(bounds.max.y>.15&&bounds.min.y<1.7)obstacles.push(bounds);
});
const tireRotations=vehicles.flatMap(g=>{const result=[];g.traverse(m=>{if(m.geometry?.type==='CylinderGeometry'&&m.geometry.parameters.radiusTop===.27)result.push({m,rotation:m.rotation.clone()});});return result;});
assert.equal(tireRotations.length,12);
for(let i=0;i<2400;i++){
  r.advance(.05);
  for(const vehicle of vehicles)for(const box of obstacles){
    const dx=Math.max(box.min.x-vehicle.position.x,0,vehicle.position.x-box.max.x),dz=Math.max(box.min.z-vehicle.position.z,0,vehicle.position.z-box.max.z);
    assert(Math.hypot(dx,dz)>M.forkliftRadius,`static obstacle near ${vehicle.userData.operation}: ${JSON.stringify({position:vehicle.position,box})}`);
  }
  for(const box of obstacles){
    const dx=Math.max(box.min.x-truck.position.x,0,truck.position.x-box.max.x),dz=Math.max(box.min.z-truck.position.z,0,truck.position.z-box.max.z);
    assert(Math.hypot(dx,dz)>1.4,`Outdoor truck obstacle: ${JSON.stringify({position:truck.position,box})}`);
  }
}
for(const {m,rotation}of tireRotations)assert(m.rotation.equals(rotation),'A tire changed its fixed mounting angle');
d.querySelector('#wl-play').click();const paused=[...vehicles,truck].map(g=>g.position.clone());r.advance(1);[...vehicles,truck].forEach((g,i)=>assert(g.position.equals(paused[i])));
d.querySelector('[data-view="lineage"]').click();assert.equal(machineGroup.visible,false);assert.equal(outdoor.visible,false);
d.querySelector('[data-view="warehouse"]').click();assert.equal(machineGroup.visible,true);
d.querySelector('#wl-catalog-toggle').click();assert(!d.querySelector('#wl-catalog').hidden);
d.querySelector('[data-operation="quarantine"]').click();d.querySelector('#wl-op-note [data-table]').click();assert(d.querySelector('#wl-fqn').textContent.includes('demo_quarantine.rejected_records'));
d.querySelector('[data-view="lineage"]').click();r.advance();assert(d.querySelector('#wl-graph-count').textContent.includes('4 表 / 3 条血缘'));
d.querySelector('#wl-outdoor').click();r.advance();assert.equal(outdoor.visible,true);assert.equal(d.querySelector('#wl-outdoor').getAttribute('aria-pressed'),'true');
assert.equal(r.errors.length,0);r.close();
process.stdout.write('PASS scene graph: real mesh envelopes, 120 seconds static-obstacle clearance, fixed round wheels, pause, view switching\n');
