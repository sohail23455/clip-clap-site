import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import auth from '../api/auth.mjs';

const realFetch=globalThis.fetch,originalEnv={...process.env};
const owner={id:'11223344-5566-4788-9900-112233445566',email:'owner@example.test',email_confirmed_at:'2026-01-01'};
const session={access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user:owner};
let calls,loginUser,loginStatus,allowed,refreshValid,accessValid;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{
 calls=[];loginUser={...owner};loginStatus=200;allowed=true;refreshValid=true;accessValid=true;
 Object.assign(process.env,{SUPABASE_URL:'https://auth-test.supabase.co',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'private-service-key',OWNER_EMAIL:owner.email,OWNER_USER_ID:owner.id,RATE_LIMIT_SECRET:'test-secret'.repeat(4),SITE_ORIGIN:'https://clipclap.mskmpt.pro'});
 globalThis.fetch=async(url,init={})=>{
  url=String(url);const headers=new Headers(init.headers),body=init.body?JSON.parse(init.body):null;
  calls.push({url,headers,body});
  if(url.endsWith('/rpc/analytics_limit'))return json(allowed);
  assert.equal(headers.get('apikey'),'test-anon','auth never uses the service-role key');
  if(url.endsWith('token?grant_type=password'))return loginStatus===200?json({...session,user:loginUser}):json({error_code:'invalid_credentials',msg:'PRIVATE PROVIDER DETAIL'},loginStatus);
  if(url.endsWith('token?grant_type=refresh_token'))return refreshValid?json({...session,user:loginUser}):json({},401);
  if(url.endsWith('/user'))return accessValid?json(loginUser):json({},401);
  if(url.endsWith('/logout'))return new Response(null,{status:204});
  throw Error('Unexpected auth request: '+url);
 };
});
afterEach(()=>{globalThis.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in originalEnv))delete process.env[k];Object.assign(process.env,originalEnv);});
async function request(body={action:'login',email:owner.email,password:'test-password'},options={}){
 const headers={'content-type':'application/json',origin:process.env.SITE_ORIGIN,...options.headers};
 const req={method:options.method||'POST',headers,body,socket:{remoteAddress:'127.0.0.1'}};
 const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(v){this.body=JSON.parse(v);}};
 await auth(req,res);return res;
}
const passwordCalls=()=>calls.filter(c=>c.url.endsWith('grant_type=password'));
test('confirmed configured owner signs in with the SDK password grant and private persistent cookies',async()=>{
 const res=await request();assert.equal(res.statusCode,200);assert.deepEqual(res.body,{authenticated:true});
 assert.equal(passwordCalls().length,1);assert.equal(passwordCalls()[0].body.password,'test-password');
 assert.equal(passwordCalls()[0].body.email,owner.email);
 assert(calls[0].url.endsWith('/rpc/analytics_limit'));assert.equal(calls[0].body.p_scope,'auth');assert.equal(calls[0].body.p_max,5);
 assert.equal(res.headers['cache-control'],'private, no-store');
 assert.equal(res.headers['set-cookie'].length,2);
 for(const cookie of res.headers['set-cookie'])assert.match(cookie,/^__Host-cc-.*Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=[1-9]/);
 assert(!JSON.stringify(res.body).includes('token'));
});
test('incorrect password returns only a simple generic error without setting a session',async()=>{
 loginStatus=400;const res=await request();assert.equal(res.statusCode,401);assert.deepEqual(res.body,{error:'Invalid email or password.'});assert.equal(res.headers['set-cookie'],undefined);
});
for(const [name,change] of [['different UUID',{id:'non-owner'}],['different email',{email:'other@example.test'}],['unconfirmed email',{email_confirmed_at:null}]]){
 test('valid password denied for '+name,async()=>{
  Object.assign(loginUser,change);const res=await request();assert.equal(res.statusCode,401);assert.equal(res.body.error,'Invalid email or password.');assert.equal(res.headers['set-cookie'],undefined);
 });
}
test('failed attempts are throttled before Supabase authentication',async()=>{
 let attempts=0;const stub=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/rpc/analytics_limit'))allowed=++attempts<=5;return stub(url,init);};
 loginStatus=400;for(let i=0;i<5;i++)assert.equal((await request()).statusCode,401);
 const res=await request();assert.equal(res.statusCode,429);assert.equal(passwordCalls().length,5);
});
test('missing credentials count against the auth limiter and never reach Supabase Auth',async()=>{
 const res=await request({action:'login',email:owner.email,password:''});assert.equal(res.statusCode,401);assert.equal(calls.length,1);assert.equal(passwordCalls().length,0);
});
test('cross-origin login and obsolete OTP actions cannot authenticate or send email',async()=>{
 assert.equal((await request(undefined,{headers:{origin:'https://hostile.example'}})).statusCode,403);
 for(const action of ['send','verify'])assert.equal((await request({action,email:owner.email})).statusCode,400);
 assert.equal(calls.length,0);
});
test('expired access session refreshes only the confirmed owner and rotates cookies',async()=>{
 accessValid=false;const res=await request(undefined,{method:'GET',headers:{cookie:'__Host-cc-access=expired; __Host-cc-refresh=test-refresh'}});
 assert.equal(res.statusCode,200);assert.equal(res.headers['set-cookie'].length,2);assert(calls.some(c=>c.url.endsWith('grant_type=refresh_token')));
});
test('non-owner refresh session is denied and both cookies are expired',async()=>{
 loginUser.id='non-owner';const res=await request(undefined,{method:'GET',headers:{cookie:'__Host-cc-refresh=test-refresh'}});
 assert.equal(res.statusCode,401);assert(res.headers['set-cookie'].every(c=>c.endsWith('Max-Age=0')));
});
test('sign out revokes the access session and clears both cookies',async()=>{
 const res=await request({action:'logout'},{headers:{cookie:'__Host-cc-access=test-access'}});
 assert.equal(res.statusCode,200);assert(res.headers['set-cookie'].every(c=>c.endsWith('Max-Age=0')));assert(calls.some(c=>c.url.endsWith('/logout')));
});
test('Supabase outage and provider rate limits stay safe and do not create sessions',async()=>{
 for(const status of [500,429]){loginStatus=status;const res=await request();assert.equal(res.statusCode,status===429?429:503);assert(!JSON.stringify(res.body).includes('PRIVATE'));assert.equal(res.headers['set-cookie'],undefined);}
});
test('login markup has only email/password and sign in, with no OTP workflow or client credentials',()=>{
 const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8'),js=readFileSync(new URL('../admin.mjs',import.meta.url),'utf8');
 const form=html.match(/<form id="login-form">(.*?)<\/form>/s)[1];
 assert.equal((form.match(/<input /g)||[]).length,2);assert.equal((form.match(/<button /g)||[]).length,1);
 assert.match(form,/type="password" autocomplete="current-password"/);
 assert.doesNotMatch(html+js,/one-time-code|code-field|codeSent|sign-in code|SUPABASE_SERVICE_ROLE_KEY|localStorage/);
});
