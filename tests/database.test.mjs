import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {validateEvent} from '../lib/validation.mjs';
const db=new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role;');
await db.exec(readFileSync(new URL('../supabase/001_analytics.sql',import.meta.url),'utf8'));
const app=(name,id=randomUUID(),version='0.11.0',timestamp)=>({event_id:randomUUID(),anonymous_install_id:id,event_name:name,app_version:version,os_family:'windows',...(timestamp?{timestamp}:{})});
async function ingest(e){return db.query('select public.analytics_ingest($1::jsonb)',[JSON.stringify(validateEvent(e))]);}
async function dashboard(days=7){return (await db.query('select public.analytics_dashboard($1,$2) as data',[days,'0.11.0'])).rows[0].data;}
test('install deduplication across event IDs, and idempotent event retries',async()=>{
 const id=randomUUID(),event=app('first_install',id);await ingest(event);await ingest(event);await ingest(app('first_install',id));
 assert.equal((await dashboard()).cards.installs,1);
});
test('active today / rolling 7 / rolling 30 and version distribution',async()=>{
 const a=randomUUID(),b=randomUUID(),c=randomUUID();
 for(const id of [a,b,c])await ingest(app('first_install',id));
 await ingest(app('app_open',a));await ingest(app('app_open',a));await ingest(app('app_open',b,'0.10.1',new Date(Date.now()-2*86400000).toISOString()));
 await db.query('update analytics.installs set last_open=now()-interval \'10 days\' where id=$1',[c]);
 await ingest(app('version_seen',a));await ingest(app('version_seen',b,'0.10.1'));
 const data=await dashboard();assert.equal(data.cards.active_today,1);assert.equal(data.cards.active_7,2);assert.equal(data.cards.active_30,3);
 assert.equal(data.daily.at(-1).active,1);assert.equal(data.versions.find(v=>v.version==='0.10.1').users,1);
 assert.equal(data.cards.latest_users,1);
});
test('delayed version events cannot replace a newer version',async()=>{
 const id=randomUUID();await ingest(app('first_install',id));await ingest(app('version_seen',id,'0.11.1'));await ingest(app('version_seen',id,'0.10.1',new Date(Date.now()-100000).toISOString()));
 assert.equal((await db.query('select version from analytics.installs where id=$1',[id])).rows[0].version,'0.11.1');
});
test('website sessions deduplicate daily and download click retries deduplicate',async()=>{
 const visitor_id=randomUUID(),page={event_id:randomUUID(),visitor_id,event_name:'pageview',page:'/'};await ingest(page);await ingest({...page,event_id:randomUUID()});
 const click={...page,event_id:randomUUID(),event_name:'download_click',version:'0.11.0',placement:'hero'};await ingest(click);await ingest(click);
 const d=await dashboard();assert.equal(d.cards.visitors,1);assert.equal(d.cards.clicks,1);
});
test('date filters produce UTC daily series including zero days',async()=>{
 assert.equal((await dashboard(1)).daily.length,1);assert.equal((await dashboard(7)).daily.length,7);assert.equal((await dashboard(30)).daily.length,30);
 await assert.rejects(()=>dashboard(365));
});
test('atomic shared rate limit stops request max+1 and global flood',async()=>{
 const args=['abc','ingest',2];
 const hit=async()=> (await db.query('select public.analytics_limit($1,$2,$3) as allowed',args)).rows[0].allowed;
 assert.equal(await hit(),true);assert.equal(await hit(),true);assert.equal(await hit(),false);
 await db.exec("update analytics.limits set count=3000 where key like 'ingest:%'");assert.equal(await hit(),false);
});
test('anonymous and authenticated database roles cannot read or invoke private functions',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(()=>db.query('select * from analytics.events'));
  await assert.rejects(()=>dashboard());
  await assert.rejects(()=>db.query('select public.analytics_ingest($1)',[JSON.stringify({...app('app_open'),kind:'app'})]));
  await db.exec('reset role');
 }
});
test('SQL defense in depth rejects extra content',async()=>{
 await assert.rejects(()=>db.query('select public.analytics_ingest($1)',[JSON.stringify({...app('app_open'),kind:'app',filename:'private'})]));
 await assert.rejects(()=>db.query('select public.analytics_ingest($1)',[JSON.stringify({...app('app_open'),kind:'app',os_family:'private'})]));
});
test('GitHub baseline is not counted as daily downloads and later increases are',async()=>{
 await db.exec("insert into analytics.github_snapshots values ((now() at time zone 'UTC')::date-1,'0.11.0',19)");
 await db.query('select public.analytics_github($1)',[JSON.stringify([{version:'0.11.0',downloads:23}])]);
 const d=await dashboard();assert.equal(d.downloads.length,1);assert.equal(d.downloads[0].downloads,4);
});
test('retention removes identifiers and raw rows, preserving aggregate counts',async()=>{
 const before=(await dashboard()).cards.installs;
 await db.exec("update analytics.events set received_at=now()-interval '91 days'; update analytics.installs set last_seen=now()-interval '396 days'; update analytics.limits set expires=now()-interval '1 day'");
 await db.exec('select public.analytics_cleanup()');
 for(const table of ['events','installs','limits'])assert.equal((await db.query('select count(*)::int as n from analytics.'+table)).rows[0].n,0);
 assert.equal((await dashboard()).cards.installs,before);
});
test.after(async()=>db.close());
