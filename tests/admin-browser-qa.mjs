// Local browser verification: real handlers, SDK and SQL; simulated Supabase Auth.
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import auth from '../api/auth.mjs';
import dashboard from '../api/dashboard.mjs';
const {chromium}=createRequire(import.meta.url)(process.argv[2]);
const site=fileURLToPath(new URL('../',import.meta.url)),art=path.resolve(site,'../../artifacts/admin-password');
mkdirSync(art,{recursive:true});
const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');
await db.exec(readFileSync(path.join(site,'supabase/001_analytics.sql'),'utf8'));
const user={id:'11223344-5566-4788-9900-112233445566',email:'owner@example.test',email_confirmed_at:'2026-01-01'};
Object.assign(process.env,{SUPABASE_URL:'https://test-auth.supabase.co',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'private-test-service',OWNER_EMAIL:user.email,OWNER_USER_ID:user.id,RATE_LIMIT_SECRET:'test-only-secret'.repeat(4)});
const realFetch=globalThis.fetch,json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
let accessExpired=false,sessionExpired=false,passwordRequests=0,refreshes=0,nonOwner=false;
const session=()=>({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user:nonOwner?{...user,id:'not-owner'}:user});
globalThis.fetch=async(url,init={})=>{
 url=String(url);const body=init.body?JSON.parse(init.body):{},headers=new Headers(init.headers);
 if(url.startsWith(process.env.SUPABASE_URL)){
  if(url.includes('/auth/v1/')){
   assert.equal(headers.get('apikey'),'test-anon');
   if(url.endsWith('grant_type=password')){passwordRequests++;return body.password==='test-password'?json(session()):json({msg:'Invalid credentials'},400);}
   if(url.endsWith('grant_type=refresh_token')){refreshes++;accessExpired=false;return sessionExpired?json({},401):json(session());}
   if(url.endsWith('/user'))return accessExpired||sessionExpired?json({},401):json(session().user);
   if(url.endsWith('/logout'))return new Response(null,{status:204});
   throw Error('Unexpected auth endpoint');
  }
  assert.equal(headers.get('apikey'),'private-test-service');
  const name=url.split('/').at(-1);assert.match(name,/^analytics_[a-z]+$/);
  const args=Object.values(body),sql=`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`;
  return json((await db.query(sql,args.map(v=>typeof v==='object'?JSON.stringify(v):v))).rows[0].result??null);
 }
 if(url.startsWith('https://api.github.com/'))return json([]);
 return realFetch(url,init);
};
const server=createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/api/auth')return auth(req,res);
 if(pathname==='/api/dashboard')return dashboard(req,res);
 const name=pathname==='/admin'?'admin.html':pathname.slice(1),file=path.resolve(site,'public',name);
 if(!file.startsWith(path.join(site,'public')+path.sep)||!existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.mjs':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;process.env.SITE_ORIGIN=origin;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const evidence={simulated_supabase_auth:true,real_sdk:true,real_sql:true,checks:[]},check=(name,value)=>{assert(value,name);evidence.checks.push(name);};
try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/admin');await page.locator('#login').waitFor({state:'visible'});
 check('only email, password and sign in in login form',await page.locator('#login-form input').count()===2&&await page.locator('#login-form button').count()===1);
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});check('login fits width '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(art,`login-${width}.png`),fullPage:true});}
 const login=async(password)=>{await page.locator('#email').fill(user.email);await page.locator('#password').fill(password);await page.locator('#signin').click();};
 await login('wrong-password');await page.locator('#error').waitFor({state:'visible'});
 check('wrong password shown generically',await page.locator('#error').innerText()==='Invalid email or password.');check('password cleared after rejection',await page.locator('#password').inputValue()==='');
 nonOwner=true;await login('test-password');await page.waitForFunction(()=>!document.getElementById('signin').disabled);
 check('valid non-owner denied with no session cookies',!(await context.cookies()).some(c=>c.name.startsWith('__Host-cc-'))&&await page.locator('#dashboard').isHidden());
 nonOwner=false;await login('test-password');await page.locator('#dashboard').waitFor({state:'visible'});
 check('confirmed owner reaches dashboard',true);check('password cleared after success',await page.locator('#password').inputValue()==='');
 const cookies=(await context.cookies()).filter(c=>c.name.startsWith('__Host-cc-'));
 check('persistent Secure HttpOnly Strict cookies',cookies.length===2&&cookies.every(c=>c.secure&&c.httpOnly&&c.sameSite==='Strict'&&c.expires>0));
 check('no token or service key in browser storage',await page.evaluate(()=>localStorage.length===0&&sessionStorage.length===0));
 await page.reload();await page.locator('#dashboard').waitFor({state:'visible'});check('session survives reload',true);
 accessExpired=true;await page.reload();await page.locator('#dashboard').waitFor({state:'visible'});check('expired access session refreshes securely',refreshes===1);
 sessionExpired=true;await page.locator('#refresh').click();await page.locator('#login').waitFor({state:'visible'});check('expired session clears metrics',await page.locator('.card').count()===0);sessionExpired=false;
 await login('test-password');await page.locator('#dashboard').waitFor({state:'visible'});await page.locator('#signout').click();await page.locator('#login').waitFor({state:'visible'});
 check('sign out clears cookies',!(await context.cookies()).some(c=>c.name.startsWith('__Host-cc-')));
 await login('wrong-password');await page.waitForFunction(()=>!document.getElementById('signin').disabled);
 const before=passwordRequests;await login('wrong-password');await page.waitForFunction(()=>document.getElementById('error').textContent==='Too many requests. Try again shortly.');
 check('sixth login attempt blocked by real database limit',passwordRequests===before);
 for(const route of ['/lib/password.mjs','/scripts/set-owner-password.ps1','/.env.example','/supabase/001_analytics.sql'])check('private asset excluded '+route,(await realFetch(origin+route)).status===404);
 check('desktop release stays 0.11.0',(await (await realFetch(origin+'/latest.json')).json()).version==='0.11.0');
 check('no browser JavaScript errors',errors.length===0);
 writeFileSync(path.join(art,'browser-qa.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));await db.close();globalThis.fetch=realFetch;}
