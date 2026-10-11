/* Generated metadata adapter: bounded allocations, not a real database connector. */
(()=>{
  const M=globalThis.WarehouseCatalog;
  const originalList=M.list;
  const int=(value,min,max)=>Math.max(min,Math.min(max,Number.isFinite(value)?Math.trunc(value):min));
  M.createLazyCatalog=function(perDb=1000000){
    if(!Number.isSafeInteger(perDb)||perDb<12||perDb>100000000)throw new RangeError('perDb must be an integer between 12 and 100000000');
    const seed=M.createCatalog(12),cache=new Map(),limit=512;
    const dbs=seed.dbs,dbMap=new Map(dbs.map(db=>[db.id,db]));
    const count=db=>db.zone==='intake'?seed.byDb.get(db.id).length:perDb;
    const tableCount=dbs.reduce((sum,db)=>sum+count(db),0);
    const makeId=(db,i)=>{
      if(db.zone==='intake')return seed.byDb.get(db.id)[i]?.id;
      if(db.zone==='tmp')return db.id+'.company_risk_'+String(i+1).padStart(3,'0');
      const names=seed.domains.find(d=>d[0]===db.domain)[2],part=Math.floor(i/names.length);
      return db.id+'.'+names[i%names.length]+(part?'_'+String(part).padStart(2,'0'):'');
    };
    function resolve(id){
      if(typeof id!=='string')return null;
      const dot=id.indexOf('.'),db=dbMap.get(id.slice(0,dot)),name=id.slice(dot+1);
      if(!db)return null;
      if(db.zone==='intake')return seed.byId.has(id)?{db,index:seed.byId.get(id).index}:null;
      let index=-1;
      if(db.zone==='tmp'){const match=/^company_risk_(\d+)$/.exec(name);if(match)index=Number(match[1])-1;}
      else{const names=seed.domains.find(d=>d[0]===db.domain)[2];for(let k=0;k<names.length;k++){
        const base=names[k];if(name===base){index=k;break;}
        if(name.startsWith(base+'_')&&/^\d+$/.test(name.slice(base.length+1))){index=Number(name.slice(base.length+1))*names.length+k;break;}
      }}
      return Number.isSafeInteger(index)&&index>=0&&index<perDb&&makeId(db,index)===id?{db,index}:null;
    }
    function get(id){
      if(cache.has(id)){const value=cache.get(id);cache.delete(id);cache.set(id,value);return value;}
      const hit=resolve(id);if(!hit)return undefined;
      const {db,index}=hit,template=seed.byDb.get(db.id)[index%12];
      const value=db.zone==='intake'?seed.byId.get(id):{...template,id,name:id.slice(id.indexOf('.')+1),index,doc:[...template.doc.slice(0,-1),id.slice(id.indexOf('.')+1)]};
      cache.set(id,value);if(cache.size>limit)cache.delete(cache.keys().next().value);return value;
    }
    const byDb=new Map(dbs.map(db=>[db.id,db.zone==='intake'?seed.byDb.get(db.id):new Proxy({},{
      get(_target,key){
        if(key==='length')return perDb;
        if(key==='slice')return (from=0,to=perDb)=>{const a=int(from<0?perDb+from:from,0,perDb),b=int(to<0?perDb+to:to,0,perDb);if(b-a>1000)throw new RangeError('Page size exceeds 1000');return Array.from({length:Math.max(0,b-a)},(_,i)=>get(makeId(db,a+i)));};
        if(typeof key==='string'&&/^\d+$/.test(key)){const i=Number(key);return i<perDb?get(makeId(db,i)):undefined;}
      }
    })]));
    const identity=[['company_id','company_id'],['companyName','companyName'],['data_date','data_date'],['updated_at','updated_at']];
    const edge=(from,to,type,domain)=>({id:from+'>'+to,from,to,type,verified:false,provenance:'按需生成的模拟调度元数据',mapping:type!=='derive'?identity:domain==='enterprise'?[['company_id','company_id'],['companyName','enterprise_name'],['data_date','data_date']]:domain==='justice'?[['company_id','company_id'],['company_id','risk_count']]:[['company_id','company_id']]});
    function adjacent(id,direction){
      const t=get(id);if(!t)return [];
      if(t.zone==='intake')return seed[direction].get(id);
      const index=t.index,ref=(zone,domain=t.domain)=>makeId(dbMap.get(zone==='tmp'?'hive_tmp':zone+'_'+domain),index);
      if(direction==='incoming'){
        if(t.zone==='tidb')return [];
        if(t.zone==='ods')return [edge(ref('tidb'),id,'sync')];
        if(t.zone==='dwd')return [edge(ref('ods'),id,'mirror')];
        return ['enterprise','justice',...(index%3===0?['ip']:[])].map(domain=>edge(ref('dwd',domain),id,'derive',domain));
      }
      if(t.zone==='tidb')return [edge(id,ref('ods'),'sync')];
      if(t.zone==='ods')return [edge(id,ref('dwd'),'mirror')];
      if(t.zone==='dwd'&&(t.domain!=='ip'||index%3===0))return [edge(id,ref('tmp'),'derive',t.domain)];
      return [];
    }
    const catalog={...seed,lazy:true,perDb,tables:{length:tableCount},edges:{length:8*perDb+Math.ceil(perDb/3)+3},
      byId:{get,has:id=>!!resolve(id),size:tableCount},byDb,
      incoming:{get:id=>adjacent(id,'incoming')},outgoing:{get:id=>adjacent(id,'outgoing')},
      cacheInfo:()=>({size:cache.size,limit}),
      query({db='',zone='',query='',page=0,size=12}={}){
        size=int(size,1,100);page=int(page,0,Number.MAX_SAFE_INTEGER);
        const scope=dbs.filter(d=>(!db||db===d.id)&&(!zone||zone===d.zone)),totalScope=scope.reduce((n,d)=>n+count(d),0),q=String(query).trim().toLowerCase().slice(0,100);
        if(!q){
          const pages=Math.max(1,Math.ceil(totalScope/size)),p=Math.min(page,pages-1),rows=[];let skip=p*size;
          for(const d of scope){if(skip>=count(d)){skip-=count(d);continue;}for(let i=skip;i<count(d)&&rows.length<size;i++)rows.push(get(makeId(d,i)));skip=0;if(rows.length===size)break;}
          return {rows,total:totalScope,totalScope,page:p,pages,truncated:false,scanned:rows.length};
        }
        const exact=get(q);
        if(exact&&scope.some(d=>d.id===exact.db))return {rows:[exact],total:1,totalScope,page:0,pages:1,truncated:false,scanned:1};
        // Bounded local preview search. Production search belongs on a metadata service.
        const matches=[],budget=10000;let scanned=0;
        outer:for(const d of scope)for(let i=0;i<count(d);i++){
          if(scanned===budget)break outer;scanned++;
          const t=get(makeId(d,i));
          if([t.id,t.cn,...t.fields.map(f=>f[0])].some(s=>s.toLowerCase().includes(q)))matches.push(t.id);
        }
        const pages=Math.max(1,Math.ceil(matches.length/size)),p=Math.min(page,pages-1);
        return {rows:matches.slice(p*size,(p+1)*size).map(get),total:matches.length,totalScope,page:p,pages,truncated:scanned<totalScope,scanned};
      }};
    return catalog;
  };
  M.list=(catalog,options)=>catalog.lazy?catalog.query(options):originalList(catalog,options);
  // Never scan the global edge list to draw a small local neighborhood.
  M.neighborhood=function(c,id,depth=2,direction='both',cap=24){
    if(!c.byId.has(id))return {nodes:[],edges:[],total:0,omitted:0,omittedEdges:0,truncated:false};
    depth=int(depth,0,50);cap=int(cap,1,256);
    const all=new Set([id]),relations=new Map(),nodeBudget=256,edgeBudget=1024;let visits=0,truncated=false;
    for(const dir of direction==='both'?['up','down']:[direction]){
      const seen=new Set([id]);let frontier=[id];
      outer:for(let level=0;level<depth;level++){
        const next=[];
        for(const node of frontier)for(const e of (dir==='up'?c.incoming:c.outgoing).get(node)||[]){
          if(visits++>=edgeBudget){truncated=true;break outer;}
          const other=dir==='up'?e.from:e.to;
          if(!c.byId.has(other))continue;
          if(!all.has(other)&&all.size>=nodeBudget){truncated=true;break outer;}
          relations.set(e.id,e);all.add(other);if(!seen.has(other)){seen.add(other);next.push(other);}
        }
        frontier=next;if(!frontier.length)break;
      }
      if(truncated)break;
    }
    const nodes=[...all].slice(0,cap),visible=new Set(nodes);
    const edges=[...relations.values()].filter(e=>visible.has(e.from)&&visible.has(e.to));
    return {nodes,edges:edges.slice(0,64),total:all.size,omitted:Math.max(0,all.size-cap),omittedEdges:Math.max(0,edges.length-64),truncated,visitedEdges:Math.min(visits,edgeBudget)};
  };
})();
