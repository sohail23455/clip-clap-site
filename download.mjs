// The deployed site resolves to the desktop's canonical manifest. Local previews
// use their own prepared manifest instead of accidentally reading the live release.
export const manifestURL=new URL('./latest.json',import.meta.url).href;
export const releasesURL='https://github.com/sohail23455/clip-clap-releases/releases';
const stable=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function validateManifest(m){
 const allowed=['schema_version','channel','version','download_url','sha256','size_bytes','release_date','notes','minimum_supported_version','installer_filename','mandatory','release_notes_url','signature'];
 if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!allowed.includes(k))||m.schema_version!==1||!stable.test(m.version)||m.version.length>100||!stable.test(m.minimum_supported_version))throw Error('Invalid release');
 if(m.channel!==undefined&&m.channel!=='stable')throw Error('Invalid channel');
 if(m.mandatory!==undefined&&typeof m.mandatory!=='boolean')throw Error('Invalid policy');
 const a=m.minimum_supported_version.split('.').map(BigInt),b=m.version.split('.').map(BigInt);
 for(let i=0;i<3;i++){if(a[i]>b[i])throw Error('Invalid minimum');if(a[i]<b[i])break;}
 const file=`Clip-Clap-Setup-${m.version}.exe`;
 if(m.installer_filename!==file||m.download_url!==`${releasesURL}/download/v${m.version}/${file}`)throw Error('Invalid asset');
 if(m.release_notes_url!=null&&m.release_notes_url!==`${releasesURL}/tag/v${m.version}`)throw Error('Invalid notes link');
 if(typeof m.sha256!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256)||!Number.isSafeInteger(m.size_bytes)||m.size_bytes<1048576||m.size_bytes>2147483648)throw Error('Invalid integrity information');
 if(typeof m.notes!=='string'||!m.notes.length||m.notes.length>8000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(m.notes))throw Error('Invalid notes');
 if(typeof m.release_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(m.release_date)||new Date(m.release_date).toISOString().slice(0,10)!==m.release_date)throw Error('Invalid date');
 return m;
}
export async function connectDownloads(doc=document,fetcher=fetch){
 const links=['navDownload','downloadTop','downloadBottom'].map(id=>doc.getElementById(id)).filter(Boolean);
 const labels=['versionTop','versionBottom'].map(id=>doc.getElementById(id)).filter(Boolean);
 links.forEach(a=>{a.href=releasesURL+'/latest';a.rel='noopener noreferrer';});
 labels.forEach(el=>{el.textContent='Latest Windows release';});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetcher(manifestURL,{cache:'no-cache',credentials:'omit',redirect:'error',signal:controller.signal});
  if(!response.ok)throw Error('Unavailable');
  const text=await response.text();if(text.length>32768)throw Error('Too large');
  const m=validateManifest(JSON.parse(text.replace(/^\uFEFF/,'')));
  links.forEach(a=>{a.href=m.download_url;a.setAttribute('aria-label',`Download Clip Clap v${m.version} for Windows`);});
  labels.forEach(el=>{el.textContent=`Clip Clap v${m.version} · ${(m.size_bytes/1048576).toFixed(1)} MB`;});
  return true;
 }catch{return false;}finally{clearTimeout(timer);}
}
