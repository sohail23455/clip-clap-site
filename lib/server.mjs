import {createHmac} from 'node:crypto';
import {Failure} from './validation.mjs';

export function settings(env=process.env){
 const origin=env.SITE_ORIGIN||'https://clipclap.mskmpt.pro';
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL||'')||!env.SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY||!env.OWNER_EMAIL||!env.OWNER_USER_ID||!env.RATE_LIMIT_SECRET||env.RATE_LIMIT_SECRET.length<32)throw new Failure(503,'Analytics setup is not finished.');
 return {...env,SITE_ORIGIN:origin};
}
export async function remote(url, init={}, auth=false){
 let response;
 try {response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(6000)});}catch{throw new Failure(503,'Service temporarily unavailable.');}
 if(!response.ok){
  if(auth&&[400,401,403].includes(response.status))throw new Failure(401,'Invalid or expired session.');
  throw new Failure(response.status===429?429:503,response.status===429?'Too many requests. Try again shortly.':'Service temporarily unavailable.');
 }
 try{return await response.json();}catch{throw new Failure(503,'Service temporarily unavailable.');}
}
export function rpc(config,name,args){return remote(config.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:config.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+config.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify(args)});}
export async function readBody(req){
 const type=(req.headers['content-type']||'').split(';')[0];
 if(!['application/json','text/plain'].includes(type))throw new Failure(415,'Use JSON.');
 if(Number(req.headers['content-length']||0)>2048)throw new Failure(413,'Request too large.');
 if(req.body!==undefined){
  if(Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(req.body))>2048)throw new Failure(413,'Request too large.');
  try{return typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{throw new Failure(400,'Invalid request.');}
 }
 let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>2048)throw new Failure(413,'Request too large.');}
 try{return JSON.parse(data);}catch{throw new Failure(400,'Invalid request.');}
}
export function sameOrigin(req,config){if(req.headers.origin!==config.SITE_ORIGIN)throw new Failure(403,'Request not allowed.');}
export function headers(res){res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type','application/json');}
export function reply(res,status,body){res.statusCode=status;res.end(JSON.stringify(body));}
export function error(res,e){reply(res,e instanceof Failure?e.status:503,{error:e instanceof Failure?e.message:'Service temporarily unavailable.'});}
export async function limit(req,config,scope,maximum){
 // Vercel overwrites x-vercel-forwarded-for. Raw addresses are never persisted or logged.
 const address=(req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
 const minute=Math.floor(Date.now()/60000);
 const key=createHmac('sha256',config.RATE_LIMIT_SECRET).update(`${minute}:${scope}:${address}`).digest('hex');
 const allowed=await rpc(config,'analytics_limit',{p_key:key,p_scope:scope,p_max:maximum});
 if(!allowed)throw new Failure(429,'Too many requests. Try again shortly.');
}
export function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')).filter(v=>v.length===2));}
export function setSession(res,session){
 const cookie=(name,value,age)=>`__Host-cc-${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
 res.setHeader('Set-Cookie',[cookie('access',session?.access_token||'',session?3600:0),cookie('refresh',session?.refresh_token||'',session?604800:0)]);
}
export async function authCall(config,path,body,access){
 return remote(config.SUPABASE_URL+'/auth/v1/'+path,{method:body?'POST':'GET',headers:{apikey:config.SUPABASE_ANON_KEY,'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},...(body?{body:JSON.stringify(body)}:{})},true);
}
export function isOwner(user,config){return user?.id===config.OWNER_USER_ID&&user?.email?.toLowerCase()===config.OWNER_EMAIL.toLowerCase()&&!!user.email_confirmed_at;}
export async function owner(req,res,config){
 const values=cookies(req);let user;
 if(values['__Host-cc-access'])try{user=await authCall(config,'user',null,values['__Host-cc-access']);}catch(e){if(e.status!==401)throw e;}
 if(!user&&values['__Host-cc-refresh']){
  try{const session=await authCall(config,'token?grant_type=refresh_token',{refresh_token:values['__Host-cc-refresh']});if(isOwner(session.user,config)){setSession(res,session);user=session.user;}}catch(e){if(e.status!==401)throw e;}
 }
 if(!isOwner(user,config)){setSession(res,null);throw new Failure(401,'Sign in to view the dashboard.');}
 return user;
}
