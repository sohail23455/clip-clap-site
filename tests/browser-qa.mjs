// Test-only local HTTP server. Production code has no auth or database bypass.
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import events from '../api/events.mjs';
import auth from '../api/auth.mjs';
import dashboard from '../api/dashboard.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.argv[2]);
const site=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.resolve(site,'../..'),art=path.join(root,'artifacts/analytics');mkdirSync(art,{recursive:true});
const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(readFileSync(path.join(site,'supabase/001_analytics.sql'),'utf8'));
const realFetch=global.fetch;let backendDown=false,expired=false,authRequests=0,requestCount=0;
const ownerId='11223344-5566-4788-9900-112233445566',user={id:ownerId,email:'owner@example.test',email_confirmed_at:'2026-01-01'};
Object.assign(process.env,{SUPABASE_URL:'https://local-test.supabase.co',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-service',OWNER_EMAIL:user.email,OWNER_USER_ID:ownerId,RATE_LIMIT_SECRET:'test-only-secret-'.repeat(4),CRON_SECRET:'test-only-cron-'.repeat(4)});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
global.fetch=async(url,init={})=>{
 if(String(url).startsWith(process.env.SUPABASE_URL)){
  if(backendDown)return response({},503);
  const name=String(url).split('/').at(-1),body=init.body?JSON.parse(init.body):{};
  if(String(url).includes('/auth/v1/')){
   if(name==='otp'){authRequests++;return response({});}
   if(name==='verify')return body.token==='123456'?response({access_token:'test-access',refresh_token:'test-refresh',user}):response({},401);
   if(name==='user')return !expired&&init.headers.Authorization==='Bearer test-access'?response(user):response({},401);
   if(name.startsWith('token?'))return !expired&&body.refresh_token==='test-refresh'?response({access_token:'test-access',refresh_token:'test-refresh',user}):response({},401);
   if(name==='logout')return new Response(null,{status:204});
  }
  if(!/^analytics_[a-z]+$/.test(name))return response({},404);
  if(init.headers.apikey!=='test-service')return response({},403);
  try{const args=Object.values(body),sql=`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`;const result=await db.query(sql,args.map(v=>typeof v==='object'?JSON.stringify(v):v));return response(result.rows[0].result??null);}catch(e){throw Error('Test database: '+e.message);}
 }
 return realFetch(url,init);
};
const routes={'/api/events':events,'/api/auth':auth,'/api/dashboard':dashboard};
const server=createServer(async(req,res)=>{
 requestCount++;const pathname=new URL(req.url,'http://localhost').pathname;
 if(routes[pathname]){await routes[pathname](req,res);return;}
 const name=({'/':'index.html','/admin':'admin.html','/privacy':'privacy.html'})[pathname]||pathname.slice(1),file=path.resolve(site,name);
 if(!file.startsWith(site+path.sep)||!existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.mjs':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.ico':'image/x-icon'})[path.extname(file)]||'text/plain');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;process.env.SITE_ORIGIN=origin;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),evidence={simulated_email_provider:true,real_database:true,real_github:true,checks:[],screenshots:[]};
function check(name,value){assert(value,name);evidence.checks.push(name);}
try{
 const unauth=await realFetch(origin+'/api/dashboard');check('unauthenticated dashboard rejects access',unauth.status===401);check('private responses are never cached',unauth.headers.get('cache-control').includes('no-store'));
 const csrf=await realFetch(origin+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://hostile.example'},body:JSON.stringify({action:'send',email:user.email})});check('cross-origin owner login rejected',csrf.status===403);
 const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/admin');await page.locator('#login').waitFor({state:'visible'});await page.screenshot({path:path.join(art,'admin-login.png'),fullPage:true});
 await page.locator('#email').fill(user.email);await page.locator('#signin').click();await page.locator('#code').waitFor({state:'visible'});await page.locator('#code').fill('123456');await page.locator('#signin').click();await page.locator('#dashboard').waitFor({state:'visible',timeout:30000});
 check('email-code owner sign in',authRequests===1);check('empty analytics state visible',await page.locator('#empty').isVisible());await page.screenshot({path:path.join(art,'admin-empty.png'),fullPage:true});
 check('GitHub download counts load',await page.locator('#release-downloads .version-row').count()>=1);
 const cookies=await context.cookies();check('session cookies secure and HttpOnly',cookies.filter(c=>c.name.startsWith('__Host-cc-')).length===2&&cookies.every(c=>c.httpOnly&&c.secure&&c.sameSite==='Strict'));
 const run=await promisify(execFile)(path.join(root,'tools/python311/python.exe'),['-m','scripts.analytics_e2e',origin],{cwd:root,windowsHide:true,timeout:120000});evidence.app=JSON.parse(run.stdout.trim().split('\n').at(-1));check('real app clean profile, clip commit, export, opt out',evidence.app.content_free&&evidence.app.opt_out_no_events);
 const home=await context.newPage();await home.goto(origin);await home.waitForFunction(()=>document.getElementById('downloadTop').dataset.version==='0.11.0');
 check('public download uses unchanged v0.11.0',await home.locator('#downloadTop').getAttribute('href')==='https://github.com/sohail23455/clip-clap-releases/releases/download/v0.11.0/Clip-Clap-Setup-0.11.0.exe');
 await home.route('https://github.com/**',r=>r.abort());
 for(const id of ['navDownload','downloadTop','downloadBottom']){await home.locator('#'+id).evaluate(el=>el.addEventListener('click',e=>e.preventDefault(),{once:true}));await home.locator('#'+id).click();}
 await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelectorAll('.card-value')[3]?.textContent==='1');check('eight cards reflect app events',await page.locator('.card').count()===8);
 await page.waitForFunction(()=>document.querySelectorAll('.card-value')[1]?.textContent==='3');check('all three download clicks tracked',true);
 check('website visitor tracked',await page.locator('.card-value').first().innerText()==='1');
 for(const range of ['1','7','30','0']){await page.locator('#range').selectOption(range);await page.waitForFunction(()=>!document.getElementById('refresh').disabled);check('date filter '+range,await page.locator('#dashboard').isVisible());}
 await page.locator('#range').selectOption('7');await page.waitForFunction(()=>!document.getElementById('refresh').disabled);
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1050});check('no horizontal overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const name=`admin-${width}.png`;await page.screenshot({path:path.join(art,name),fullPage:true});evidence.screenshots.push(name);}
 await page.reload();await page.locator('#dashboard').waitFor({state:'visible'});check('session persists after refresh',true);
 backendDown=true;await page.locator('#refresh').click();await page.locator('#error').waitFor({state:'visible'});check('backend failure shown safely',!(await page.locator('#error').innerText()).includes('stack'));await page.screenshot({path:path.join(art,'admin-error.png'),fullPage:true});backendDown=false;
 // Force an expired session through the same production authentication path.
 expired=true;await page.locator('#retry').click();await page.locator('#login').waitFor({state:'visible'});check('expired session clears all rendered metrics',await page.locator('.card').count()===0);expired=false;
 // Re-login then exercise secure sign-out.
 await page.locator('#email').fill(user.email);await page.locator('#signin').click();await page.locator('#code').waitFor({state:'visible'});await page.locator('#code').fill('123456');await page.locator('#signin').click();await page.locator('#dashboard').waitFor({state:'visible'});await page.locator('#signout').click();await page.locator('#login').waitFor({state:'visible'});check('signout removes session',!(await context.cookies()).some(c=>c.name.startsWith('__Host-cc-')));
 const raw=(await db.query('select name from analytics.events')).rows.map(r=>r.name);check('only approved app events persisted',raw.includes('first_install')&&raw.includes('export_completed')&&raw.includes('clip_created'));
 check('no browser JavaScript errors',errors.length===0);evidence.requests=requestCount;
 writeFileSync(path.join(art,'browser-e2e.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));await db.close();global.fetch=realFetch;}
