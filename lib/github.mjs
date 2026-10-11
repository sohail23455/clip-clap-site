import {remote,rpc} from './server.mjs';
import {Failure} from './validation.mjs';
let cached;
export async function github(config,now=Date.now()){
 if(cached&&now-cached.time<15*60000)return cached.data;
 const versions=[];
 try{
  for(let page=1;page<=20;page++){
   const releases=await remote(`https://api.github.com/repos/sohail23455/clip-clap-releases/releases?per_page=100&page=${page}`,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'ClipClap-Owner-Analytics',...(config.GITHUB_TOKEN?{Authorization:'Bearer '+config.GITHUB_TOKEN}:{})}});
   if(!Array.isArray(releases))throw new Failure(503,'GitHub downloads are unavailable.');
   for(const release of releases){
    if(release.draft||release.prerelease||!/^v?\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(release.tag_name))continue;
    const version=release.tag_name.replace(/^v/,'');
    const downloads=(release.assets||[]).filter(a=>a.name===`Clip-Clap-Setup-${version}.exe`).reduce((n,a)=>n+(Number.isSafeInteger(a.download_count)?a.download_count:0),0);
    versions.push({version,downloads});
   }
   if(releases.length<100)break;
   if(page===20)throw new Failure(503,'GitHub release list is incomplete.');
  }
  const data={versions,total:versions.reduce((n,v)=>n+v.downloads,0),as_of:new Date(now).toISOString(),stale:false};
  await rpc(config,'analytics_github',{p_versions:versions});cached={time:now,data};return data;
 }catch{
  if(cached)return {...cached.data,stale:true};
  return {error:'GitHub downloads are temporarily unavailable.',versions:[],total:null};
 }
}
