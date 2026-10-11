import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateEvent} from '../lib/validation.mjs';
import {tracker,connectTracking} from '../analytics.mjs';
import {settings,isOwner,setSession,readBody} from '../lib/server.mjs';
const app=()=>({event_id:randomUUID(),anonymous_install_id:randomUUID(),event_name:'app_open',app_version:'0.11.1',os_family:'windows'});
for(const field of ['video_path','filename','transcript','api_key','email','username','device_serial','mac_address','project_name','clipboard','ip','referrer','url','hardware_id']){
 test('reject sensitive field '+field,()=>assert.throws(()=>validateEvent({...app(),[field]:'private'})));
}
test('reject malformed identifiers, unknown events, arbitrary versions and timestamp abuse',()=>{
 for(const change of [{anonymous_install_id:'my-computer'},{event_id:'123'},{event_name:'upload'},{app_version:'a-user@example.com'},{os_family:'machine-name'},{timestamp:'2099-01-01T00:00:00Z'},{timestamp:'2000-01-01'}])assert.throws(()=>validateEvent({...app(),...change}));
});
test('website accepts only fixed page and optional known placement/version',()=>{
 const e={event_id:randomUUID(),visitor_id:randomUUID(),event_name:'download_click',page:'/',placement:'nav',version:'0.11.0'};assert.equal(validateEvent(e).kind,'website');
 for(const change of [{page:'/private?email=secret'},{placement:'username'},{version:'email'},{referrer:'private'}])assert.throws(()=>validateEvent({...e,...change}));
});
test('server keys are mandatory and owner requires both confirmed email and user ID',()=>{
 assert.throws(()=>settings({}));const c={OWNER_USER_ID:'owner',OWNER_EMAIL:'owner@example.com'};
 assert.equal(isOwner({id:'other',email:c.OWNER_EMAIL,email_confirmed_at:'now'},c),false);
 assert.equal(isOwner({id:'owner',email:'other@example.com',email_confirmed_at:'now'},c),false);
 assert.equal(isOwner({id:'owner',email:c.OWNER_EMAIL},c),false);
 assert.equal(isOwner({id:'owner',email:c.OWNER_EMAIL,email_confirmed_at:'now'},c),true);
});
test('sessions use Secure HttpOnly SameSite cookies and signout expires both',()=>{
 let cookies;const response={setHeader:(_,v)=>cookies=v};setSession(response,{access_token:'access',refresh_token:'refresh'});
 for(const cookie of cookies)assert.match(cookie,/Path=\/; HttpOnly; Secure; SameSite=Strict/);
 setSession(response,null);assert(cookies.every(c=>c.endsWith('Max-Age=0')));
});
test('oversized and malformed bodies are rejected without echo',async()=>{
 await assert.rejects(()=>readBody({headers:{'content-type':'application/json'},body:'x'.repeat(3000)}),/too large/);
 await assert.rejects(()=>readBody({headers:{'content-type':'text/plain'},body:'private malformed'}),/Invalid request/);
});
function browser(overrides={}){const events=[];let stored;return {events,crypto:{randomUUID},sessionStorage:{getItem:()=>stored,setItem:(_,v)=>stored=v},navigator:{sendBeacon:(_,body)=>{events.push(JSON.parse(body));return true;}},...overrides};}
test('tracking never captures URL or personal browser properties and deduplicates session ID',()=>{
 const win=browser({location:{href:'https://site/?email=secret'}}),track=tracker(win);track('pageview');track('download_click','0.11.0','hero');
 assert.equal(win.events[0].visitor_id,win.events[1].visitor_id);assert(!JSON.stringify(win.events).includes('secret'));win.events.forEach(validateEvent);
});
test('tracking respects Do Not Track and Global Privacy Control',()=>{
 for(const preference of [{doNotTrack:'1'},{globalPrivacyControl:true}]){const win=browser();Object.assign(win.navigator,preference);tracker(win)('pageview');assert.equal(win.events.length,0);}
});
test('tracking exceptions never interfere with all three anchor clicks',()=>{
 const callbacks={},win=browser({navigator:{sendBeacon(){throw Error('offline');}}});
 connectTracking({getElementById:id=>({addEventListener:(event,cb)=>callbacks[id]=cb})},win);
 assert.equal(Object.keys(callbacks).length,3);
 for(const cb of Object.values(callbacks))assert.doesNotThrow(()=>cb({currentTarget:{dataset:{version:'0.11.0'}}}));
});
