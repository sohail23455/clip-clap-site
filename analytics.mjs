// First-party counts only. No URL queries, referrers, browser/device attributes or content.
export function tracker(win=window){
 let memory;
 function visitor(){
  const day=new Date().toISOString().slice(0,10);
  if(memory?.day===day)return memory.id;
  try{
   const saved=JSON.parse(win.sessionStorage.getItem('cc-visit')||'null');
   if(saved?.day===day&&/^[a-f0-9-]{36}$/.test(saved.id)){memory=saved;return saved.id;}
  }catch{}
  memory={day,id:win.crypto.randomUUID()};
  try{win.sessionStorage.setItem('cc-visit',JSON.stringify(memory));}catch{}
  return memory.id;
 }
 return (event_name,version,placement)=>{
  try{
   if(win.navigator.doNotTrack==='1'||win.navigator.globalPrivacyControl===true)return;
   const event={event_id:win.crypto.randomUUID(),visitor_id:visitor(),event_name,page:'/',...(version?{version}:{}),...(placement?{placement}:{})};
   // text/plain avoids a navigation-delaying preflight; endpoint still enforces same origin.
   const body=JSON.stringify(event);
   if(win.navigator.sendBeacon?.('/api/events',body))return;
   void win.fetch('/api/events',{method:'POST',body,headers:{'Content-Type':'text/plain'},credentials:'omit',keepalive:true,signal:AbortSignal.timeout(2000)}).catch(()=>{});
  }catch{} // Counting can never prevent a download or page navigation.
 };
}
export function connectTracking(doc=document,win=window){
 const track=tracker(win);track('pageview');
 for(const [id,placement] of [['navDownload','nav'],['downloadTop','hero'],['downloadBottom','bottom']]){
  doc.getElementById(id)?.addEventListener('click',event=>track('download_click',event.currentTarget.dataset.version,placement));
 }
}
