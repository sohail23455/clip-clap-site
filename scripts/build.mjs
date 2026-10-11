import {mkdir,copyFile,readdir} from 'node:fs/promises';
await mkdir('public',{recursive:true});
for(const name of await readdir('.')){
 if(/\.(html|css|png|ico|svg)$/.test(name)||['download.mjs','analytics.mjs','admin.mjs','latest.json','latest.schema.json','RELEASE-NOTES-v0.11.0.md'].includes(name))await copyFile(name,'public/'+name);
}
