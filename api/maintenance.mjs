import {timingSafeEqual} from 'node:crypto';
import {Failure} from '../lib/validation.mjs';
import {settings,headers,reply,error,rpc} from '../lib/server.mjs';
import {github} from '../lib/github.mjs';
export default async function handler(req,res){
 headers(res);
 try{
  const config=settings(),provided=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+(config.CRON_SECRET||''));
  if(req.method!=='GET'||!config.CRON_SECRET||config.CRON_SECRET.length<32||provided.length!==expected.length||!timingSafeEqual(provided,expected))throw new Failure(401,'Authentication required.');
  const data=await github(config);await rpc(config,'analytics_cleanup',{});
  if(data.error||data.stale)throw new Failure(503,'Download snapshot unavailable. Cleanup completed.');
  reply(res,200,{ok:true});
 }catch(e){error(res,e);}
}
