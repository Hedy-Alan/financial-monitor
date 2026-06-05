// 📈 Financial Monitor — Thin proxy server
const http=require('http'),https=require('https'),fs=require('fs'),path=require('path');
const iconv=require('iconv-lite');
const PORT=9877;

function get(url,hdrs={},to=8000){return new Promise((ok,no)=>{
  const m=url.startsWith('https')?https:http;
  m.get(url,{headers:hdrs,timeout:to},res=>{
    if(res.statusCode>=300&&res.statusCode<400&&res.headers.location)return get(new URL(res.headers.location,url).href,hdrs,to).then(ok,no);
    const c=[];res.on('data',x=>c.push(x));res.on('end',()=>ok(Buffer.concat(c)));res.on('error',no);
  }).on('timeout',function(){this.destroy();no(new Error('to'))}).on('error',no);
})}

const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://localhost:${PORT}`);const q=url.searchParams;
  const js=o=>{res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(o))};

  // ── Proxy: batch stock quotes ───────────────────────────────
  if(url.pathname==='/api/quote'){
    const codes=(q.get('codes')||'').split(',').filter(Boolean);
    const results=[];
    for(const c of codes){
      try{
        let raw,str;
        if(c.startsWith('sh')||c.startsWith('sz')){
          raw=iconv.decode(await get(`http://qt.gtimg.cn/q=${c}`),'gbk');
          const m=raw.match(/"([^"]*)"/);if(!m)continue;const f=m[1].split('~');if(f.length<33)continue;
          results.push({c,n:f[1],price:+f[3],prev:+f[4],open:+f[5],high:+f[33],low:+f[34],vol:parseInt(f[6])||0,chgPct:+f[32]||0,chg:+(+f[3]-+f[4]).toFixed(2),time:f[30]});
        }else if(c.startsWith('hk')){
          raw=iconv.decode(await get(`http://hq.sinajs.cn/list=${c}`,{Referer:'https://finance.sina.com.cn'}),'gbk');
          const m=raw.match(/"([^"]*)"/);if(!m)continue;const f=m[1].split(',');if(f.length<2)continue;
          results.push({c,n:f[1]||f[0],price:+f[6],prev:+f[3],open:+f[2],high:+f[4],low:+f[5],chg:+f[7],chgPct:+f[8],vol:+f[10],time:f[f.length-3]});
        }else if(c.startsWith('gb_')){
          raw=iconv.decode(await get(`http://hq.sinajs.cn/list=${c}`,{Referer:'https://finance.sina.com.cn'}),'gbk');
          const m=raw.match(/"([^"]*)"/);if(!m)continue;const f=m[1].split(',');if(f.length<2)continue;
          results.push({c,n:f[0],price:+f[1],prev:+f[2],open:+f[5],high:+f[6],low:+f[7],chg:+f[4],chgPct:parseFloat(f[3])||0,time:f[f.length-2]});
        }else if(c.startsWith('fx_')){
          raw=iconv.decode(await get(`http://hq.sinajs.cn/list=${c}`,{Referer:'https://finance.sina.com.cn'}),'gbk');
          const m=raw.match(/"([^"]*)"/);if(!m)continue;const f=m[1].split(',');if(f.length<2)continue;
          results.push({c,n:c,price:+f[1],time:f[0]});
        }else if(c.includes('_usdt')){
          const raw=await get(`https://data.gateapi.io/api2/1/ticker/${c}`);
          const d=JSON.parse(raw.toString());if(!d.result)continue;
          results.push({c,n:c.replace('_','/').toUpperCase(),price:+d.last,high:+d.high24hr,low:+d.low24hr,chgPct:parseFloat(d.percentChange)||0,vol:+d.baseVolume});
        }
        if(results.length>0&&!results[results.length-1].n)results.pop();
      }catch{}
    }
    return js(results);
  }

  // ── Proxy: indices ──────────────────────────────────────────
  if(url.pathname==='/api/indices'){
    const ids=['s_sh000001','s_sz399001','s_sz399006','s_sh000688','int_dji','int_nasdaq','rt_hkHSI'];
    const names=['上证指数','深证成指','创业板指','科创50','道琼斯','纳斯达克','恒生指数'];
    try{
      const raw=iconv.decode(await get('http://hq.sinajs.cn/list='+ids.join(','),{Referer:'https://finance.sina.com.cn'}),'gbk');
      const results=[];
      ids.forEach((id,i)=>{
        const line=raw.split('\n').find(l=>l.includes(id));if(!line)return;
        const m=line.match(/"([^"]*)"/);if(!m)return;const f=m[1].split(',');
        results.push({c:id,n:names[i],price:+f[1],chg:+f[2],chgPct:+f[3]});
      });
      return js(results);
    }catch{return js([])}
  }

  // ── Proxy: K-line ───────────────────────────────────────────
  if(url.pathname==='/api/kline'){
    const code=q.get('code'),market=q.get('m')||'a';
    try{
      if(market==='cc'){
        const raw=await get(`https://data.gateapi.io/api2/1/candlestick2/${code}?group_sec=3600&range_hour=48`);
        const d=JSON.parse(raw.toString());if(!d.result||!d.data)return js([]);
        return js(d.data.map(x=>({t:+x[0],o:+x[2],h:+x[3],l:+x[4],c:+x[5],v:+x[1]})));
      }
      const url=`https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${code}&scale=60&datalen=60`;
      const raw=await get(url,{Referer:'https://finance.sina.com.cn'});
      const d=JSON.parse(raw.toString());if(!Array.isArray(d))return js([]);
      return js(d.map(x=>({t:new Date(x.day).getTime(),o:+x.open,h:+x.high,l:+x.low,c:+x.close,v:+x.volume})));
    }catch{return js([])}
  }

  // ── Proxy: funds ────────────────────────────────────────────
  if(url.pathname==='/api/funds'){
    const fundCodes=['001186','005827','110011','161725','320007'];
    const results=[];
    for(const c of fundCodes){
      try{
        const raw=await get(`http://fundgz.1234567.com.cn/js/${c}.js?rt=${Date.now()}`);
        const m=raw.toString().match(/jsonpgz\((.+)\)/);if(!m)continue;
        const d=JSON.parse(m[1]);
        results.push({c,n:d.name||c,price:+d.gsz,prev:+d.dwjz,chgPct:parseFloat(d.gszzl)||0,date:d.jzrq,time:d.gztime});
      }catch{}
    }
    return js(results);
  }

  // ── Static files ─────────────────────────────────────────────
  let fp=url.pathname==='/'?'/index.html':url.pathname;fp=path.join(__dirname,fp);
  if(fs.existsSync(fp)&&fs.statSync(fp).isFile()){
    res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'});
    return res.end(fs.readFileSync(fp));
  }
  res.writeHead(404);res.end('Not Found');
});

server.listen(PORT,'127.0.0.1',()=>{
  console.log(`\n  📈 Financial Monitor  http://localhost:${PORT}\n`);
  if(process.argv.includes('--open')) require('child_process').execSync(`start msedge --app="http://localhost:${PORT}" --window-size=1080,700`,{shell:'cmd.exe',windowsHide:true});
});
