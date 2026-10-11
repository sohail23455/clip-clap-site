import {createClient} from '@supabase/supabase-js';
import {Failure} from './validation.mjs';

// A separate, non-persistent SDK client for each request prevents session sharing
// between users in a warm server function. Only our HttpOnly cookies persist it.
export async function signInWithPassword(config,email,password){
 const client=createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:(url,init)=>fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(6000)})}
 });
 const {data,error}=await client.auth.signInWithPassword({email,password});
 if(error){
  if(error.status===429)throw new Failure(429,'Too many requests. Try again shortly.');
  if([400,401,403,422].includes(error.status))throw new Failure(401,'Invalid email or password.');
  throw new Failure(503,'Service temporarily unavailable.');
 }
 if(!data.session?.access_token||!data.session?.refresh_token||!data.user)throw new Failure(503,'Service temporarily unavailable.');
 return {...data.session,user:data.user};
}
