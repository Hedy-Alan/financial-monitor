// 📈 Financial Monitor — Proxy server
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

async function gbk(url,hdrs={}){return iconv.decode(await get(url,hdrs),'gbk')}
function p(v){const n=parseFloat(v);return isNaN(n)?0:n}

const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://localhost:${PORT}`);const q=url.searchParams;
  const js=o=>{res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(o))};

  // ── Batch quotes ───────────────────────────────────────────
  if(url.pathname==='/api/quote'){
    const codes=(q.get('codes')||'').split(',').filter(Boolean);
    const results=[];
    for(const c of codes){
      try{let raw,str;
        if(c.startsWith('sh')||c.startsWith('sz')){
          raw=iconv.decode(await get(`http://qt.gtimg.cn/q=${c}`),'gbk');
          const m=raw.match(/"([^"]*)"/);if(!m)continue;const f=m[1].split('~');if(f.length<33)continue;
          results.push({c,n:f[1],price:p(f[3]),prev:p(f[4]),open:p(f[5]),high:p(f[33]),low:p(f[34]),vol:parseInt(f[6])||0,chgPct:p(f[32])||0,chg:+(p(f[3])-p(f[4])).toFixed(2),time:f[30]});
        }else if(c.startsWith('hk')){
          raw=await gbk(`http://hq.sinajs.cn/list=${c}`,{Referer:'https://finance.sina.com.cn'});
          const m=raw.match(/"([^"]*)"/);if(!m)continue;const f=m[1].split(',');if(f.length<2)continue;
          results.push({c,n:f[1]||f[0],price:p(f[6]),prev:p(f[3]),open:p(f[2]),high:p(f[4]),low:p(f[5]),chg:p(f[7]),chgPct:p(f[8]),vol:p(f[10]),time:f[f.length-3]});
        }else if(c.startsWith('gb_')){
          raw=await gbk(`http://hq.sinajs.cn/list=${c}`,{Referer:'https://finance.sina.com.cn'});
          const m=raw.match(/"([^"]*)"/);if(!m)continue;const f=m[1].split(',');if(f.length<2)continue;
          const price=p(f[1]),chgV=p(f[4]);
          results.push({c,n:f[0],price,prev:+(price-chgV).toFixed(2),open:p(f[5]),high:p(f[6]),low:p(f[7]),chg:chgV,chgPct:p(f[2]),time:f[3]});
        }else if(c.startsWith('fx_')){
          raw=await gbk(`http://hq.sinajs.cn/list=${c}`,{Referer:'https://finance.sina.com.cn'});
          const m=raw.match(/"([^"]*)"/);if(!m)continue;const f=m[1].split(',');if(f.length<2)continue;
          results.push({c,n:c,price:p(f[1]),time:f[0]});
        }else if(c.includes('_usdt')){
          const raw=await get(`https://data.gateapi.io/api2/1/ticker/${c}`);
          const d=JSON.parse(raw.toString());if(!d.result)continue;
          results.push({c,n:c.replace('_','/').toUpperCase(),price:p(d.last),high:p(d.high24hr),low:p(d.low24hr),chgPct:parseFloat(d.percentChange)||0,vol:p(d.baseVolume)});
        }
      }catch{}
    }
    return js(results);
  }

  // ── Indices ─────────────────────────────────────────────────
  if(url.pathname==='/api/indices'){
    const ids='s_sh000001,s_sz399001,s_sz399006,s_sh000688,int_dji,int_nasdaq,rt_hkHSI';
    const names=['上证指数','深证成指','创业板指','科创50','道琼斯','纳斯达克','恒生指数'];
    try{
      const raw=await gbk(`http://hq.sinajs.cn/list=${ids}`,{Referer:'https://finance.sina.com.cn'});
      const results=[];const lines=raw.split('\n');
      ids.split(',').forEach((id,i)=>{const line=lines.find(l=>l.includes(id));if(!line)return;const m=line.match(/"([^"]*)"/);if(!m)return;const f=m[1].split(',');results.push({c:id,n:names[i],price:p(f[1]),chg:p(f[2]),chgPct:p(f[3])})});
      return js(results);
    }catch{return js([])}
  }

  // ── K-line ──────────────────────────────────────────────────
  if(url.pathname==='/api/kline'){
    const code=q.get('code'),market=q.get('m')||'a';
    try{
      if(market==='cc'){
        const raw=await get(`https://data.gateapi.io/api2/1/candlestick2/${code}?group_sec=3600&range_hour=48`);
        const d=JSON.parse(raw.toString());if(!d.result||!d.data)return js([]);
        return js(d.data.map(x=>({t:+x[0],o:+x[2],h:+x[3],l:+x[4],c:+x[5],v:+x[1]})));
      }
      if(market==='a'){
        const url=`https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${code}&scale=60&datalen=60`;
        const raw=await get(url,{Referer:'https://finance.sina.com.cn'});
        const d=JSON.parse(raw.toString());if(!Array.isArray(d))return js([]);
        return js(d.map(x=>({t:new Date(x.day).getTime(),o:p(x.open),h:p(x.high),l:p(x.low),c:p(x.close),v:p(x.volume)})));
      }
      // HK/US: return empty — client will use synthetic K-line
      return js([]);
    }catch{return js([])}
  }

  // ── Funds ───────────────────────────────────────────────────
  if(url.pathname==='/api/funds'){
    const codes=['001186','005827','110011','161725','320007'];
    const results=[];
    for(const c of codes){
      try{const raw=await get(`http://fundgz.1234567.com.cn/js/${c}.js?rt=${Date.now()}`);const m=raw.toString().match(/jsonpgz\((.+)\)/);if(!m)continue;const d=JSON.parse(m[1]);results.push({c,n:d.name||c,price:p(d.gsz),prev:p(d.dwjz),chgPct:parseFloat(d.gszzl)||0,date:d.jzrq,time:d.gztime})}catch{}
    }
    return js(results);
  }

  // ── News (proxy Sina RSS — fixes CORS) ──────────────────────
  if(url.pathname==='/api/news'){
    try{
      const raw=await get('https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&k=&num=8&page=1');
      const j=JSON.parse(raw.toString());if(!j.result||!j.result.data)return js([]);
      return js(j.result.data.map(d=>({title:d.title,intro:d.intro||'',url:d.url})));
    }catch{return js([])}
  }

  // ── US market top stocks ────────────────────────────────────
  if(url.pathname==='/api/us-top'){
    const stocks=['gb_aapl','gb_msft','gb_goog','gb_amzn','gb_nvda','gb_tsla','gb_meta','gb_brka','gb_jpm','gb_v'];
    const results=[];
    for(const c of stocks){
      try{
        const raw=await gbk(`http://hq.sinajs.cn/list=${c}`,{Referer:'https://finance.sina.com.cn'});
        const m=raw.match(/"([^"]*)"/);if(!m)continue;const f=m[1].split(',');if(f.length<2)continue;
        results.push({c,n:f[0],price:p(f[1]),chgPct:p(f[2]),chg:p(f[4])});
      }catch{}
    }
    return js(results);
  }

  // ── HK market top stocks ────────────────────────────────────
  if(url.pathname==='/api/hk-top'){
    const stocks=['hk00700','hk09988','hk03690','hk00941','hk01299','hk02318','hk00388','hk01810','hk00175','hk09618'];
    const results=[];
    for(const c of stocks){
      try{
        const raw=await gbk(`http://hq.sinajs.cn/list=${c}`,{Referer:'https://finance.sina.com.cn'});
        const m=raw.match(/"([^"]*)"/);if(!m)continue;const f=m[1].split(',');if(f.length<2)continue;
        results.push({c,n:f[1]||f[0],price:p(f[6]),chgPct:p(f[8]),chg:p(f[7])});
      }catch{}
    }
    return js(results);
  }

  // ── Static ───────────────────────────────────────────────────
  let fp=url.pathname==='/'?'/index.html':url.pathname;fp=path.join(__dirname,fp);
  if(fs.existsSync(fp)&&fs.statSync(fp).isFile()){res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'});return res.end(fs.readFileSync(fp))}
  res.writeHead(404);res.end('Not Found');
});

server.listen(PORT,'127.0.0.1',()=>{
  console.log(`\n  📈 Financial Monitor  http://localhost:${PORT}\n`);
  if(process.argv.includes('--open'))require('child_process').execSync(`start msedge --app="http://localhost:${PORT}" --window-size=1080,700`,{shell:'cmd.exe',windowsHide:true});
});
