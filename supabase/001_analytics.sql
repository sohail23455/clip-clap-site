-- Run once in the Supabase SQL editor. Only the server service role can use this schema.
create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;

create table analytics.installs (
 id uuid primary key, first_seen timestamptz, last_seen timestamptz not null,
 version text not null check (version ~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$'),
 version_at timestamptz not null, last_open timestamptz
);
create table analytics.events (
 id uuid primary key, install_id uuid not null, name text not null check(name in
 ('first_install','app_open','app_close','app_update','version_seen','clip_created','export_completed','update_check')),
 version text not null, occurred_at timestamptz not null, received_at timestamptz not null default now()
);
create index on analytics.events(received_at);
create index on analytics.installs(last_open);
create table analytics.active_days (day date not null, install_id uuid not null, primary key(day,install_id));
create table analytics.visitor_days (day date not null, visitor_id uuid not null, primary key(day,visitor_id));
create table analytics.website_events (
 id uuid primary key, name text not null check(name in ('pageview','download_click')),
 day date not null, version text, placement text check(placement in ('nav','hero','bottom')), received_at timestamptz not null default now()
);
create index on analytics.website_events(received_at);
create table analytics.daily (
 day date primary key, visitors bigint not null default 0, clicks bigint not null default 0,
 installs bigint not null default 0, active bigint not null default 0
);
create table analytics.version_days (
 day date not null, install_id uuid not null, version text not null, seen_at timestamptz not null,
 primary key(day,install_id)
);
create table analytics.github_snapshots (day date not null, version text not null, downloads bigint not null, primary key(day,version));
create table analytics.limits (key text primary key, count int not null, expires timestamptz not null);

alter table analytics.installs enable row level security;
alter table analytics.events enable row level security;
alter table analytics.active_days enable row level security;
alter table analytics.visitor_days enable row level security;
alter table analytics.website_events enable row level security;
alter table analytics.daily enable row level security;
alter table analytics.version_days enable row level security;
alter table analytics.github_snapshots enable row level security;
alter table analytics.limits enable row level security;
revoke all on all tables in schema analytics from public, anon, authenticated;

create function public.analytics_limit(p_key text,p_scope text,p_max int) returns boolean
language plpgsql security definer set search_path='' as $$
declare n int; total int; bucket text;
begin
 if p_scope not in ('ingest','auth','admin') or p_max not between 1 and 300 then return false; end if;
 delete from analytics.limits where expires < now();
 bucket := p_scope || ':' || floor(extract(epoch from now())/60)::text;
 insert into analytics.limits values(bucket,1,now()+interval '2 minutes')
 on conflict(key) do update set count=analytics.limits.count+1 returning count into total;
 if total > (case when p_scope='ingest' then 3000 when p_scope='auth' then 30 else 300 end) then return false; end if;
 insert into analytics.limits values(p_key,1,now()+interval '2 minutes')
 on conflict(key) do update set count=analytics.limits.count+1 returning count into n;
 return n <= p_max;
end $$;

create function public.analytics_ingest(p_event jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare t timestamptz; d date; fresh int; install uuid; v text; name text; event_id uuid;
begin
 -- Strict second validation layer, including direct service-RPC callers.
 name:=p_event->>'event_name'; event_id:=(p_event->>'event_id')::uuid;
 if event_id is null then raise exception 'Invalid event'; end if;
 if p_event->>'kind'='app' then
  if (p_event - array['kind','event_id','anonymous_install_id','event_name','app_version','os_family','timestamp']) <> '{}'::jsonb
    or name is null or name not in ('first_install','app_open','app_close','app_update','version_seen','clip_created','export_completed','update_check')
    or (p_event->>'os_family') is distinct from 'windows' then raise exception 'Invalid event'; end if;
  install:=(p_event->>'anonymous_install_id')::uuid; v:=p_event->>'app_version';
  if install is null or v is null or v !~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$' then raise exception 'Invalid event'; end if;
  t:=coalesce((p_event->>'timestamp')::timestamptz,now());
  if t < now()-interval '7 days' or t > now()+interval '5 minutes' then raise exception 'Invalid time'; end if;
  t:=least(t,now()); d:=(t at time zone 'UTC')::date;
  insert into analytics.events values(event_id,install,name,v,t,now()) on conflict do nothing;
  get diagnostics fresh = row_count;
  if fresh=0 then return; end if;
  insert into analytics.daily(day) values(d) on conflict do nothing;
  insert into analytics.installs(id,last_seen,version,version_at) values(install,t,v,'-infinity')
  on conflict(id) do update set last_seen=greatest(analytics.installs.last_seen,excluded.last_seen);
  if name='first_install' then
   update analytics.installs set first_seen=t where id=install and first_seen is null;
   get diagnostics fresh = row_count;
   if fresh=1 then update analytics.daily set installs=installs+1 where day=d; end if;
  elsif name='app_open' then
   update analytics.installs set last_open=greatest(last_open,t) where id=install;
   insert into analytics.active_days values(d,install) on conflict do nothing;
   get diagnostics fresh = row_count;
   if fresh=1 then update analytics.daily set active=active+1 where day=d; end if;
  end if;
  if name='version_seen' then
   update analytics.installs set version=v,version_at=t where id=install and version_at<=t;
   insert into analytics.version_days values(d,install,v,t) on conflict(day,install_id)
   do update set version=excluded.version,seen_at=excluded.seen_at where analytics.version_days.seen_at<=excluded.seen_at;
  end if;
 elsif p_event->>'kind'='website' then
  if (p_event - array['kind','event_id','visitor_id','event_name','page','version','placement']) <> '{}'::jsonb
    or name is null or name not in ('pageview','download_click') or (p_event->>'page') is distinct from '/'
    or (p_event ? 'version' and (p_event->>'version') !~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$')
    or (p_event ? 'placement' and (p_event->>'placement') not in ('nav','hero','bottom')) then raise exception 'Invalid event'; end if;
  install:=(p_event->>'visitor_id')::uuid;
  if install is null then raise exception 'Invalid visitor'; end if;
  d:=(now() at time zone 'UTC')::date;
  insert into analytics.website_events values(event_id,name,d,p_event->>'version',p_event->>'placement',now()) on conflict do nothing;
  get diagnostics fresh = row_count;
  if fresh=0 then return; end if;
  insert into analytics.daily(day) values(d) on conflict do nothing;
  if name='pageview' then
   insert into analytics.visitor_days values(d,install) on conflict do nothing;
   get diagnostics fresh = row_count;
   if fresh=1 then update analytics.daily set visitors=visitors+1 where day=d; end if;
  else update analytics.daily set clicks=clicks+1 where day=d;
  end if;
 else raise exception 'Invalid event';
 end if;
end $$;

create function public.analytics_dashboard(p_days int,p_latest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare start_day date; today date := (now() at time zone 'UTC')::date; result jsonb;
begin
 if p_days not in (0,1,7,30) then raise exception 'Invalid range'; end if;
 start_day:=case when p_days=0 then coalesce((select min(day) from analytics.daily),today) else today-(p_days-1) end;
 select jsonb_build_object(
  'range',p_days,'latest_version',p_latest,'as_of',now(),
  'cards',jsonb_build_object(
   'visitors',coalesce((select sum(visitors) from analytics.daily where day>=start_day),0),
   'clicks',coalesce((select sum(clicks) from analytics.daily where day>=start_day),0),
   'installs',coalesce((select sum(installs) from analytics.daily),0),
   'installs_in_range',coalesce((select sum(installs) from analytics.daily where day>=start_day),0),
   'active_today',(select count(*) from analytics.installs where last_open>=today::timestamp at time zone 'UTC'),
   'active_7',(select count(*) from analytics.installs where last_open >= now()-interval '7 days'),
   'active_30',(select count(*) from analytics.installs where last_open >= now()-interval '30 days'),
   'latest_users',(select count(*) from analytics.installs where version=p_latest and version_at > '-infinity'::timestamptz),
   'visitors_today',coalesce((select visitors from analytics.daily where day=today),0),
   'visitors_7',coalesce((select sum(visitors) from analytics.daily where day>=today-6),0),
   'visitors_30',coalesce((select sum(visitors) from analytics.daily where day>=today-29),0)),
  'daily',coalesce((select jsonb_agg(jsonb_build_object('day',dates.day,'visitors',coalesce(d.visitors,0),'clicks',coalesce(d.clicks,0),'installs',coalesce(d.installs,0),'active',coalesce(d.active,0)) order by dates.day)
    from (select generate_series(start_day,today,interval '1 day')::date as day) dates left join analytics.daily d using(day)),'[]'::jsonb),
  'versions',coalesce((select jsonb_agg(row_to_json(v) order by v.users desc) from
    (select version,count(*) as users from analytics.installs where version_at > '-infinity'::timestamptz group by version) v),'[]'::jsonb),
  'adoption',coalesce((select jsonb_agg(row_to_json(v) order by v.day) from
    (select day,count(*) filter(where version=p_latest) as latest,count(*) as total from analytics.version_days where day>=start_day group by day) v),'[]'::jsonb),
  'downloads',coalesce((select jsonb_agg(row_to_json(v) order by v.day) from
    (select day,sum(delta) as downloads from
      (select day,case when lag(downloads) over(partition by version order by day) is null then null else greatest(0,downloads-lag(downloads) over(partition by version order by day)) end as delta from analytics.github_snapshots) diffs
     where day>=start_day and delta is not null group by day) v),'[]'::jsonb)
 ) into result;
 return result;
end $$;

create function public.analytics_github(p_versions jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 for v in select * from jsonb_array_elements(p_versions) loop
  if (v->>'version') ~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$' and (v->>'downloads')::bigint>=0 then
   insert into analytics.github_snapshots values((now() at time zone 'UTC')::date,v->>'version',(v->>'downloads')::bigint)
   on conflict(day,version) do update set downloads=excluded.downloads;
  end if;
 end loop;
end $$;

create function public.analytics_cleanup() returns void
language plpgsql security definer set search_path='' as $$
begin
 delete from analytics.events where received_at < now()-interval '90 days';
 delete from analytics.website_events where received_at < now()-interval '90 days';
 delete from analytics.visitor_days where day < (now() at time zone 'UTC')::date-31;
 delete from analytics.active_days where day < (now() at time zone 'UTC')::date-35;
 delete from analytics.version_days where day < (now() at time zone 'UTC')::date-395;
 delete from analytics.installs where last_seen < now()-interval '395 days';
 delete from analytics.limits where expires < now();
end $$;

revoke all on function public.analytics_limit(text,text,int),public.analytics_ingest(jsonb),public.analytics_dashboard(int,text),public.analytics_github(jsonb),public.analytics_cleanup() from public, anon, authenticated;
grant execute on function public.analytics_limit(text,text,int),public.analytics_ingest(jsonb),public.analytics_dashboard(int,text),public.analytics_github(jsonb),public.analytics_cleanup() to service_role;
