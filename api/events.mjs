import {validateEvent,Failure} from '../lib/validation.mjs';
import {settings,readBody,headers,reply,error,limit,rpc,sameOrigin} from '../lib/server.mjs';
export default async function handler(req,res){
 headers(res);
 try{
  if(req.method!=='POST')throw new Failure(405,'Method not allowed.');
  const body=validateEvent(await readBody(req)),config=settings();
  if(body.kind==='website')sameOrigin(req,config);
  await limit(req,config,'ingest',120);
  await rpc(config,'analytics_ingest',{p_event:body});
  reply(res,202,{accepted:true});
 }catch(e){error(res,e);}
}
