export const appEvents = new Set(['first_install','app_open','app_close','app_update','version_seen','clip_created','export_completed','update_check']);
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const version = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export class Failure extends Error { constructor(status,message){super(message);this.status=status;} }
export function exact(body, allowed){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))throw new Failure(400,'Invalid request.');
}
export function validateEvent(body, now=Date.now()){
 const app=appEvents.has(body?.event_name);
 exact(body,app?['event_id','anonymous_install_id','event_name','app_version','os_family','timestamp']:['event_id','visitor_id','event_name','page','version','placement']);
 if(typeof body.event_id!=='string'||!uuid.test(body.event_id))throw new Failure(400,'Invalid event.');
 if(app){
  if(typeof body.anonymous_install_id!=='string'||!uuid.test(body.anonymous_install_id)||typeof body.app_version!=='string'||!version.test(body.app_version)||body.os_family!=='windows')throw new Failure(400,'Invalid event.');
  if(body.timestamp!==undefined&&(typeof body.timestamp!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(body.timestamp)||!Number.isFinite(Date.parse(body.timestamp))||Date.parse(body.timestamp)>now+300000||Date.parse(body.timestamp)<now-7*86400000))throw new Failure(400,'Invalid event time.');
 }else{
  if(!['pageview','download_click'].includes(body.event_name)||typeof body.visitor_id!=='string'||!uuid.test(body.visitor_id)||body.page!=='/')throw new Failure(400,'Invalid event.');
  if(body.version!==undefined&&(typeof body.version!=='string'||!version.test(body.version)))throw new Failure(400,'Invalid version.');
  if(body.placement!==undefined&&!['nav','hero','bottom'].includes(body.placement))throw new Failure(400,'Invalid placement.');
  if(body.event_name==='pageview'&&(body.version!==undefined||body.placement!==undefined))throw new Failure(400,'Invalid pageview.');
 }
 return {kind:app?'app':'website',...body};
}
