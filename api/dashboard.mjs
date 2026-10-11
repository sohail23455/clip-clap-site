import {readFileSync} from 'node:fs';
import {Failure} from '../lib/validation.mjs';
import {settings,headers,reply,error,owner,rpc,limit} from '../lib/server.mjs';
import {github} from '../lib/github.mjs';
const latest=JSON.parse(readFileSync(new URL('../latest.json',import.meta.url),'utf8')).version;
export default async function handler(req,res){
 headers(res);
 try{
  if(req.method!=='GET')throw new Failure(405,'Method not allowed.');
  const config=settings();await owner(req,res,config);await limit(req,config,'admin',30);
  const range=new URL(req.url,'https://localhost').searchParams.get('range')||'7';
  if(!['1','7','30','0'].includes(range))throw new Failure(400,'Invalid date range.');
  const downloads=await github(config);
  const data=await rpc(config,'analytics_dashboard',{p_days:Number(range),p_latest:latest});
  reply(res,200,{...data,github:downloads});
 }catch(e){error(res,e);}
}
