import {exact,Failure} from '../lib/validation.mjs';
import {settings,readBody,headers,reply,error,limit,sameOrigin,authCall,isOwner,setSession,owner,cookies} from '../lib/server.mjs';
export default async function handler(req,res){
 headers(res);
 try{
  const config=settings();
  if(req.method==='GET'){await owner(req,res,config);return reply(res,200,{authenticated:true});}
  if(req.method!=='POST')throw new Failure(405,'Method not allowed.');
  sameOrigin(req,config);
  const body=await readBody(req);exact(body,['action','email','code']);
  if(body.action==='logout'){
   const token=cookies(req)['__Host-cc-access'];setSession(res,null);
   if(token)try{await fetch(config.SUPABASE_URL+'/auth/v1/logout',{method:'POST',headers:{apikey:config.SUPABASE_ANON_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(3000),redirect:'error'});}catch{}
   return reply(res,200,{ok:true});
  }
  if(!['send','verify'].includes(body.action)||typeof body.email!=='string'||body.email.length>254)throw new Failure(400,'Invalid request.');
  await limit(req,config,'auth',5);
  const matches=body.email.toLowerCase()===config.OWNER_EMAIL.toLowerCase();
  if(body.action==='send'){
   if(matches)await authCall(config,'otp',{email:config.OWNER_EMAIL,create_user:false});
   return reply(res,200,{message:'If this is the owner address, a sign-in code will arrive shortly.'});
  }
  if(!matches||typeof body.code!=='string'||!/^\d{6,8}$/.test(body.code))throw new Failure(401,'Invalid or expired sign-in code.');
  let session;try{session=await authCall(config,'verify',{email:config.OWNER_EMAIL,token:body.code,type:'email'});}catch(e){if(e.status!==401)throw e;throw new Failure(401,'Invalid or expired sign-in code.');}
  if(!isOwner(session.user,config))throw new Failure(403,'Owner access required.');
  setSession(res,session);reply(res,200,{authenticated:true});
 }catch(e){error(res,e);}
}
