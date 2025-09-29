const http = require('http');
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const port = process.env.PORT || 8080;

const mimeMap = {
  '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml'
};

const server = http.createServer((req,res)=>{
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0] || '/'));
  if (p.endsWith('/')) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data)=>{
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(p).toLowerCase();
    res.writeHead(200, {'Content-Type': mimeMap[ext] || 'application/octet-stream'});
    res.end(data);
  });
});

server.listen(port, ()=> console.log('static server listening on', port));

// allow graceful shutdown
process.on('SIGINT', ()=>{ server.close(()=>process.exit(0)); });
process.on('SIGTERM', ()=>{ server.close(()=>process.exit(0)); });
