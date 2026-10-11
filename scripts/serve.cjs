const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../dist'),port=Number(process.env.PORT||4173);
if(!fs.existsSync(path.join(root,'index.html')))throw Error('Run npm run build first.');
http.createServer((req,res)=>{
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,body)=>{if(error){res.writeHead(404);res.end('Not found');return;}
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.txt':'text/plain; charset=utf-8'})[path.extname(file)]||'application/octet-stream');
    res.setHeader('X-Content-Type-Options','nosniff');res.end(body);
  });
}).listen(port,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:'+port));
