const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');
const ROOT = __dirname;

async function testServiceWorker() {
  const data={squareApiKey:'user-square-key-1234567890',enabled:true};
  const listeners={};
  let fetchCount=0, lastHeaders=null, riskNext=false, rejectNext=null;
  const publishBodies=[];
  const downloadedImages=[];
  const uploadedImages=[];
  const chrome={
    storage:{local:{
      async get(keys){if(typeof keys==='string') return {[keys]:data[keys]}; const out={}; for(const k of keys||Object.keys(data)) out[k]=data[k]; return out;},
      async set(values){Object.assign(data,values);},
      async remove(key){delete data[key];}
    }},
    runtime:{
      onMessage:{addListener(fn){listeners.message=fn}},
      onInstalled:{addListener(fn){listeners.installed=fn}},
      onStartup:{addListener(fn){listeners.startup=fn}},
      async openOptionsPage(){}
    },
    alarms:{async create(){},onAlarm:{addListener(fn){listeners.alarm=fn}}},
    action:{async setBadgeText(){},async setBadgeBackgroundColor(){}}
  };
  function jsonResponse(payload,status=200){
    return {
      ok:status>=200&&status<300,
      status,
      headers:{get(){return 'application/json';}},
      async text(){return JSON.stringify(payload);}
    };
  }
  const context={chrome,console,setTimeout,clearTimeout,URL,fetch:async(_url,opts={})=>{
    fetchCount++;
    const url=String(_url);
    if(url.startsWith('https://pbs.twimg.com/media/')){
      downloadedImages.push(url);
      return {
        ok:true,
        status:200,
        headers:{get(name){return String(name).toLowerCase()==='content-type'?'image/jpeg':null;}},
        async blob(){return {size:4,type:'image/jpeg'};}
      };
    }
    if(url.endsWith('/image/presignedUrl')){
      return jsonResponse({code:'000000',data:{
        presignedUrl:'https://square-test.s3.amazonaws.com/upload/photo.jpg?signature=test',
        fileTicket:'ticket-1'
      }});
    }
    if(url.startsWith('https://square-test.s3.amazonaws.com/')){
      uploadedImages.push({url,body:opts.body,contentType:opts.headers['Content-Type']});
      return {ok:true,status:200};
    }
    if(url.endsWith('/image/imageStatus')){
      return jsonResponse({code:'000000',data:{status:1,imageUrl:'https://public.bnbstatic.com/image/ready.jpg'}});
    }
    lastHeaders=opts.headers;
    const body=JSON.parse(opts.body);
    publishBodies.push(body);
    if(riskNext){riskNext=false;return jsonResponse({code:'20041',message:'Potential security risk with the URL'});}
    if(rejectNext){const code=rejectNext;rejectNext=null;return jsonResponse({code,message:'Rejected by Binance'});}
    return jsonResponse({code:'000000',data:{id:'sq123',shareLink:'https://www.binance.com/square/post/sq123'}});
  }};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'service-worker.js'),'utf8'),context);
  async function runtimeMessage(message){return new Promise(resolve=>listeners.message(message,null,resolve));}
  async function message(payload){return runtimeMessage({type:'SYNC_MANUAL_POST',payload:JSON.parse(JSON.stringify(payload))});}
  const fullText='第一段\n\n最后一段\n\n#Acurast $ACU';
  const payload={event_id:'x:1',tweet_id:'1',username:'Alice',current_username:'Alice',text:fullText,source_url:'https://x.com/Alice/status/1'};
  let legacyCallbackCalled=false;
  const legacyReturn=listeners.message({type:'QUEUE_X_POST',payload},null,()=>{legacyCallbackCalled=true;});
  assert.equal(legacyReturn,undefined,'legacy automatic events must not be accepted');
  assert.equal(legacyCallbackCalled,false,'legacy automatic events must not receive a publish response');
  const firstResult=await message(payload);
  assert.equal(firstResult.ok,true);
  assert.equal(firstResult.status,'published');
  assert.equal(fetchCount,1);
  assert.equal(publishBodies[0].bodyTextOnly,fullText,'full text, line breaks, hashtags and cashtags must be preserved');
  assert.equal(lastHeaders['X-Square-OpenAPI-Key'],'user-square-key-1234567890');
  assert.equal(data.boundUsername,'alice');
  assert.equal(data.queue['x:1'].status,'published');
  assert.equal(data.queue['x:1'].source,'manual');
  assert.equal(data.queue['x:1'].payload.current_username,undefined,'current login identity must not be retained in the queue');
  await message(payload);
  assert.equal(fetchCount,1,'same tweet must not publish twice');
  const expandedText=`${fullText}\n\n补全的结尾 #DePIN`;
  const expandedResult=await message({...payload,text:expandedText});
  assert.equal(expandedResult.ok,true);
  assert.equal(fetchCount,2,'a previously truncated post must be republished when its extracted content becomes complete');
  assert.equal(publishBodies.at(-1).bodyTextOnly,expandedText);
  assert.equal(data.queue['x:1'].payload.text,expandedText);
  const notOwn=await message({...payload,event_id:'x:not-own',tweet_id:'not-own',username:'Bob',current_username:'Alice'});
  assert.equal(notOwn.ignored,true);
  assert.equal(notOwn.reason,'not_own_post');
  assert.equal(data.queue['x:not-own'],undefined,'another account post must never enter the queue');
  assert.equal(fetchCount,2,'another account post must not reach Binance');
  const skippedByKeyword=await message({
    ...payload,
    event_id:'x:8',
    tweet_id:'8',
    text:'New oKx Wallet update',
    image_urls:['https://pbs.twimg.com/media/blocked-photo.jpg']
  });
  assert.equal(skippedByKeyword.skipped,true);
  assert.equal(skippedByKeyword.keyword,'OKX');
  assert.equal(data.queue['x:8'],undefined,'keyword-matched posts must not enter the queue');
  assert.equal(data.lastStatus.status,'skipped_keyword');
  assert.equal(data.lastStatus.matched_keyword,'OKX');
  assert.equal(fetchCount,2,'keyword filtering must happen before downloads or Binance requests');
  const ignored=await message({...payload,event_id:'x:2',tweet_id:'2',username:'Bob',current_username:'Bob'});
  assert.equal(ignored.ignored,true);
  assert.equal(fetchCount,2,'different X account must be ignored after binding');

  riskNext=true;
  const linked={...payload,event_id:'x:3',tweet_id:'3',text:'项目地址 https://example.com/path\n正文保留'};
  const linkedResult=await message(linked);
  assert.equal(linkedResult.ok,true);
  assert.equal(linkedResult.status,'published');
  assert.equal(fetchCount,4,'URL risk must retry exactly once');
  assert.equal(publishBodies.at(-2).bodyTextOnly,'项目地址 https://example.com/path\n正文保留');
  assert.equal(publishBodies.at(-1).bodyTextOnly,'项目地址\n正文保留');
  assert.equal(data.queue['x:3'].status,'published');
  assert.equal(data.queue['x:3'].links_removed,true);
  assert.equal(data.lastStatus.links_removed,true);

  rejectNext='20002';
  const rejected={...payload,event_id:'x:4',tweet_id:'4',text:'被拒正文 https://risky.example/path'};
  const rejectedResult=await message(rejected);
  assert.equal(rejectedResult.ok,false);
  assert.equal(rejectedResult.status,'blocked');
  assert.equal(data.queue['x:4'].status,'blocked');
  assert.equal(data.queue['x:4'].error_code,'20002');
  assert.ok(data.queue['x:4'].rejected_at);
  assert.equal(data.lastStatus.ok,false);
  assert.equal(data.lastStatus.status,'blocked');
  assert.equal(data.lastStatus.error_code,'20002');

  const retried=await runtimeMessage({type:'RETRY_WITHOUT_LINKS'});
  assert.equal(retried.ok,true);
  assert.equal(retried.links_removed_count,1);
  assert.equal(publishBodies.at(-1).bodyTextOnly,'被拒正文');
  assert.equal(data.queue['x:4'].status,'published');
  assert.equal(data.queue['x:4'].links_removed,true);
  assert.equal(data.lastStatus.links_removed,true);

  rejectNext='10004';
  const withImage={
    ...payload,
    event_id:'x:6',
    tweet_id:'6',
    text:'image post',
    image_urls:[
      'https://pbs.twimg.com/media/photo-one.jpg?format=jpg&name=small',
      'https://evil.example/not-allowed.jpg'
    ]
  };
  const imageResult=await message(withImage);
  assert.equal(imageResult.ok,false);
  assert.equal(imageResult.status,'pending');
  assert.equal(data.queue['x:6'].status,'pending','temporary publish failure must remain retryable');
  assert.deepEqual(data.queue['x:6'].uploaded_image_urls,['https://public.bnbstatic.com/image/ready.jpg']);
  assert.equal(downloadedImages.length,1);
  assert.match(downloadedImages[0],/[?&]name=orig(?:&|$)/);
  assert.equal(uploadedImages.length,1);
  assert.equal(uploadedImages[0].contentType,'image/jpeg');
  assert.deepEqual(publishBodies.at(-1).imageList,['https://public.bnbstatic.com/image/ready.jpg']);
  const retryWithCachedUpload=await runtimeMessage({type:'RETRY_ALL'});
  assert.equal(retryWithCachedUpload.ok,true);
  assert.equal(data.queue['x:6'].status,'published');
  assert.equal(data.queue['x:6'].image_count,1);
  assert.equal(data.lastStatus.image_count,1);
  assert.equal(downloadedImages.length,1,'publish retry must reuse the uploaded Binance image');

  const beforeImageOnly=fetchCount;
  const imageOnly=await message({
    ...payload,
    event_id:'x:7',
    tweet_id:'7',
    text:'',
    image_urls:['https://pbs.twimg.com/media/image-only.jpg']
  });
  assert.equal(imageOnly.error,'image caption required');
  assert.equal(data.lastStatus.error_code,'IMAGE_CAPTION_REQUIRED');
  assert.equal(fetchCount,beforeImageOnly,'image-only posts must not upload when Binance requires text');

  data.queue['x:5']={payload:{...payload,event_id:'x:5',tweet_id:'5',text:'https://only.example/path'},source:'manual',status:'blocked',attempts:1,created_at:Date.now()};
  const beforeUrlOnly=fetchCount;
  const emptyRetry=await runtimeMessage({type:'RETRY_WITHOUT_LINKS'});
  assert.equal(emptyRetry.skipped_empty_count,1);
  assert.equal(fetchCount,beforeUrlOnly,'URL-only content must never be sent empty');
  assert.equal(data.queue['x:5'].status,'blocked');

  delete data.queue['x:5'];
  data.queue['x:legacy']={payload:{...payload,event_id:'x:legacy',tweet_id:'legacy'},status:'pending',attempts:0,created_at:Date.now()};
  const beforeLegacyRetry=fetchCount;
  await runtimeMessage({type:'RETRY_ALL'});
  assert.equal(fetchCount,beforeLegacyRetry,'queues from old automatic versions must never be retried');
  assert.equal(data.queue['x:legacy'].status,'pending');
}

(async()=>{await testServiceWorker();console.log('manual extension simulations: PASS');})().catch(e=>{console.error(e);process.exit(1)});
