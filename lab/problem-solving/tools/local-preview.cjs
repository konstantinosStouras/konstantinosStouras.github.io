/* No-write local preview of the independent app with the imported dataset.
   node tools/local-preview.cjs PRIVATE_FIXTURE_DIR [port]
   The private workbook is never served; only the anonymous analytical rows.
*/
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),fixture=JSON.parse(fs.readFileSync(path.join(process.argv[2],'historical-import.json'),'utf8'));
const port=Number(process.argv[3]||8765);
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(req.method!=='GET'){res.writeHead(405);return res.end('Read-only preview');}
 if(url.pathname==='/_preview/history'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({headers:fixture.headers,rows:fixture.records.map(r=>r.row),excluded:0,fetchedAt:new Date().toISOString()}));return;}
 if(url.pathname.startsWith('/_')||url.pathname.includes('/.')){res.writeHead(404);res.end();return;}
 if(url.pathname==='/'&&url.searchParams.get('preview')!=='1'&&!url.searchParams.has('admin')){res.writeHead(302,{Location:'/?preview=1&key=stouras'});res.end();return;}
 const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{let data=fs.readFileSync(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'text/plain');
  if(url.pathname==='/data-store.js')data=Buffer.from(data.toString()+"\nProblemStore.load=()=>fetch('/_preview/history').then(r=>r.json());ProblemStore.save=async()=>{throw Error('Local preview cannot save responses');};\n");
  res.end(data);
 }catch{res.writeHead(404);res.end();}
});
server.listen(port,'127.0.0.1',()=>console.log('Local no-save preview: http://127.0.0.1:'+port+'/?preview=1&key=stouras'));
