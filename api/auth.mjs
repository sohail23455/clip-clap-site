import {exact,Failure} from '../lib/validation.mjs';
import {settings,readBody,headers,reply,error,limit,sameOrigin,isOwner,setSession,owner,cookies} from '../lib/server.mjs';
import {signInWithPassword} from '../lib/password.mjs';
export default async function handler(req,res){
 headers(res);
 try{
  const config=settings();
  if(req.method==='GET'){await owner(req,res,config);return reply(res,200,{authenticated:true});}
  if(req.method!=='POST')throw new Failure(405,'Method not allowed.');
  sameOrigin(req,config);
  const body=await readBody(req);exact(body,['action','email','password']);
  if(body.action==='logout'){
   const token=cookies(req)['__Host-cc-access'];setSession(res,null);
   if(token)try{await fetch(config.SUPABASE_URL+'/auth/v1/logout',{method:'POST',headers:{apikey:config.SUPABASE_ANON_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(3000),redirect:'error'});}catch{}
   return reply(res,200,{ok:true});
  }
  if(body.action!=='login')throw new Failure(400,'Invalid request.');
  // Count every login attempt, including malformed credentials and non-owner users.
  // The database also enforces a shared auth limit across addresses.
  await limit(req,config,'auth',5);
  if(typeof body.email!=='string'||!body.email.trim()||body.email.length>254||typeof body.password!=='string'||!body.password||body.password.length>1024)throw new Failure(401,'Invalid email or password.');
  const session=await signInWithPassword(config,body.email.trim(),body.password);
  if(!isOwner(session.user,config))throw new Failure(401,'Invalid email or password.');
  setSession(res,session);reply(res,200,{authenticated:true});
 }catch(e){error(res,e);}
}
