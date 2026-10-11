const $=id=>document.getElementById(id),number=v=>v==null?'—':Number(v).toLocaleString();
let pending=false,codeSent=false,generation=0;
async function api(path,body){
 const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error||'Service temporarily unavailable.'),{status:r.status});return data;
}
function showError(error){$('error').textContent=error.message||'Service temporarily unavailable. Try again.';$('error').hidden=false;$('retry').hidden=false;}
function clearError(){$('error').hidden=true;$('retry').hidden=true;}
function signedOut(){generation++;$('dashboard').hidden=true;$('cards').replaceChildren();$('charts').replaceChildren();$('versions').replaceChildren();$('release-downloads').replaceChildren();$('signout').hidden=true;$('login').hidden=false;$('status').hidden=true;}
function element(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function card(label,value,note){const node=element('article',undefined,'card');node.append(element('div',label,'card-label'),element('div',number(value),'card-value'),element('div',note,'card-note'));return node;}
function chart(title,rows,key,note){
 const panel=element('section',undefined,'panel chart');panel.append(element('h2',title),element('p',note,'sub'));
 if(!rows.length){panel.append(element('p','No observations yet.'));return panel;}
 const values=rows.map(r=>Number(r[key])||0),max=Math.max(1,...values),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 500 160');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${title}: ${values.reduce((a,b)=>a+b,0)} total across ${rows.length} days. Data table below.`);
 const points=values.map((v,i)=>[rows.length===1?250:10+i*480/(rows.length-1),145-v/max*120]);
 const shape=(name,attrs)=>{const el=document.createElementNS(svg.namespaceURI,name);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));svg.append(el);};
 for(const y of [25,85,145])shape('line',{x1:0,x2:500,y1:y,y2:y,class:'gridline'});
 if(points.length>1){shape('polygon',{points:`${points[0][0]},145 ${points.map(p=>p.join(',')).join(' ')} ${points.at(-1)[0]},145`,class:'area'});shape('polyline',{points:points.map(p=>p.join(',')).join(' '),class:'sparkline'});}else shape('circle',{cx:250,cy:points[0][1],r:4,class:'point'});
 panel.append(svg);const axis=element('div',undefined,'axis');axis.append(element('span',rows[0].day),element('span',`Peak ${number(Math.max(...values))}`),element('span',rows.at(-1).day));panel.append(axis);
 const details=element('details'),table=element('table'),head=element('tr');head.append(element('th','UTC date'),element('th',title));table.append(head);rows.forEach((r,i)=>{const tr=element('tr');tr.append(element('td',r.day),element('td',number(values[i])));table.append(tr);});const scroll=element('div',undefined,'table-scroll');scroll.append(table);details.append(element('summary','View daily values'),scroll);panel.append(details);return panel;
}
export function render(data){
 const c=data.cards,g=data.github,latest=data.latest_version;
 const current=g.versions.find(v=>v.version===latest)?.downloads;
 $('cards').replaceChildren(card('Website visitors · estimated',c.visitors,`Today ${number(c.visitors_today)} · 7d ${number(c.visitors_7)} · 30d ${number(c.visitors_30)}`),card('Download button clicks',c.clicks,'Selected date range'),card('Installer downloads',g.total,`Lifetime · v${latest}: ${number(current)}`),card('Unique installs',c.installs,`Lifetime observed · ${number(c.installs_in_range)} in range`),card('Active today',c.active_today,'Unique app opens · UTC day'),card('Active 7 days',c.active_7,'Unique app opens · rolling 7 days'),card('Active 30 days',c.active_30,'Unique app opens · rolling 30 days'),card('Latest version users',c.latest_users,`Most recent version seen · v${latest}`));
 $('charts').replaceChildren(chart('Daily website visitors',data.daily,'visitors','Estimated daily browser sessions'),chart('Daily download clicks',data.daily,'clicks','Nav, hero and bottom download buttons'),chart('Daily installs',data.daily,'installs','First observation of a consenting installation'),chart('Daily active users',data.daily,'active','Unique installations that opened Clip Clap'),chart('Daily installer downloads',data.downloads,'downloads','Observed GitHub snapshot increases; baseline excluded'),chart('Latest version adoption',data.adoption.map(r=>({...r,percent:r.total?Math.round(100*r.latest/r.total):0})),'percent',`Percent of daily version-seen installations on v${latest}`));
 $('versions').replaceChildren();const total=data.versions.reduce((n,v)=>n+v.users,0);
 for(const v of data.versions){const row=element('div',undefined,'version-row'),percent=total?100*v.users/total:0;row.append(element('span','v'+v.version),element('span',`${number(v.users)} · ${percent.toFixed(1)}%`));const bar=element('div',undefined,'bar'),fill=element('div');fill.style.width=percent+'%';bar.append(fill);$('versions').append(row,bar);}
 if(!total)$('versions').append(element('p','No version observations yet.'));
 $('release-downloads').replaceChildren();for(const v of g.versions){const row=element('div',undefined,'version-row');row.append(element('span','v'+v.version),element('span',number(v.downloads)));$('release-downloads').append(row);}
 if(!g.versions.length)$('release-downloads').append(element('p',g.error||'No release assets yet.'));
 $('github-error').hidden=!g.error&&!g.stale;$('github-error').textContent=g.error||(g.stale?'GitHub is unavailable. Showing the last cached download counts.':'');
 $('empty').hidden=!!(c.installs||c.visitors||c.clicks||c.active_30);
 $('updated').textContent='Updated '+new Date(data.as_of).toLocaleString()+(g.as_of?' · GitHub checked '+new Date(g.as_of).toLocaleTimeString():'');
 $('dashboard').hidden=false;$('login').hidden=true;$('signout').hidden=false;
}
async function load(){
 if(pending)return;pending=true;clearError();$('refresh').disabled=true;$('range').disabled=true;$('status').hidden=false;$('status').textContent='Loading your dashboard…';const ticket=generation;
 try{const data=await api('/api/dashboard?range='+$('range').value);if(ticket===generation)render(data);}catch(e){if(e.status===401)signedOut();else showError(e);}finally{pending=false;$('refresh').disabled=false;$('range').disabled=false;$('status').hidden=true;}
}
$('login-form').addEventListener('submit',async event=>{
 event.preventDefault();clearError();$('signin').disabled=true;
 try{const data=await api('/api/auth',{action:codeSent?'verify':'send',email:$('email').value,...(codeSent?{code:$('code').value}:{})});
  if(codeSent){$('code').value='';await load();}else{codeSent=true;$('code-field').hidden=false;$('code').required=true;$('email').readOnly=true;$('signin').textContent='Sign in';$('resend').hidden=false;$('login-note').textContent=data.message;$('code').focus();}
 }catch(e){showError(e);}finally{$('signin').disabled=false;}
});
$('resend').addEventListener('click',()=>{codeSent=false;$('code-field').hidden=true;$('code').required=false;$('code').value='';$('email').readOnly=false;$('signin').textContent='Send sign-in code';$('resend').hidden=true;$('login-note').textContent='';});
$('signout').addEventListener('click',async()=>{try{await api('/api/auth',{action:'logout'});signedOut();}catch(e){showError(e);}});
$('range').addEventListener('change',load);$('refresh').addEventListener('click',load);$('retry').addEventListener('click',load);
void load();
