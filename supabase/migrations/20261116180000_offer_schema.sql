-- ════════════════════════════════════════════════════════════════════
-- Maslulim ("offer pages"): client-facing package/price pages.
-- Lives in the "WebSite" Supabase project (org: Shani Nissinboiem Interior Design)
-- next to the site's contact form, using only its own offer_* tables,
-- its own storage bucket and its own admin list.
-- Pages are served by the Vercel site (repo itai360/maslulim) and edited at /admin.
-- ════════════════════════════════════════════════════════════════════

-- Who may manage the offer pages (matched against the verified login email).
create table public.offer_admins (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

-- Shared content used by every page (brand, contact, about, process, gallery...).
create table public.offer_site (
  id         smallint primary key default 1 check (id = 1),
  content    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- One row per offer page (e.g. "maslulim", "home-styling").
create table public.offer_pages (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  title      text not null default '',          -- internal name shown in the admin
  content    jsonb not null default '{}'::jsonb,
  is_public  boolean not null default false,    -- true = opens without a client link
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Previous versions, saved automatically on every change (last 100 per item).
create table public.offer_history (
  id       bigint generated always as identity primary key,
  kind     text not null check (kind in ('page', 'site')),
  page_id  uuid references public.offer_pages(id) on delete cascade,
  title    text,
  content  jsonb not null,
  saved_at timestamptz not null default now(),
  saved_by uuid
);
create index offer_history_lookup on public.offer_history (kind, page_id, saved_at desc);

create or replace function public.offer_new_token() returns text
language sql volatile set search_path = '' as $$
  select replace(replace(rtrim(encode(extensions.gen_random_bytes(9), 'base64'), '='), '+', '-'), '/', '_');
$$;

-- Personal client links with an expiry date (replaces the old client-side "?k=" gate).
create table public.offer_links (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique default public.offer_new_token(),
  page_id         uuid not null references public.offer_pages(id) on delete cascade,
  client_name     text not null default '',
  note            text not null default '',
  expires_at      timestamptz,                 -- null = never expires
  revoked_at      timestamptz,
  open_count      int not null default 0,
  first_opened_at timestamptz,
  last_opened_at  timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid()
);
create index offer_links_page on public.offer_links (page_id);

-- ── helpers ─────────────────────────────────────────────────────────
create or replace function public.is_offer_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join public.offer_admins a on a.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

create or replace function public.offer_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create or replace function public.offer_keep_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := case when tg_table_name = 'offer_pages' then 'page' else 'site' end;
  v_page uuid := case when tg_table_name = 'offer_pages' then old.id else null end;
  v_title text := case when tg_table_name = 'offer_pages' then old.title else null end;
begin
  if old.content is distinct from new.content then
    insert into public.offer_history (kind, page_id, title, content, saved_by)
    values (v_kind, v_page, v_title, old.content, old.updated_by);
    delete from public.offer_history h
    where h.kind = v_kind and h.page_id is not distinct from v_page
      and h.id not in (
        select h2.id from public.offer_history h2
        where h2.kind = v_kind and h2.page_id is not distinct from v_page
        order by h2.saved_at desc limit 100);
  end if;
  return new;
end $$;

create trigger offer_site_touch  before update on public.offer_site  for each row execute function public.offer_touch();
create trigger offer_pages_touch before update on public.offer_pages for each row execute function public.offer_touch();
create trigger offer_site_hist   after update on public.offer_site   for each row execute function public.offer_keep_history();
create trigger offer_pages_hist  after update on public.offer_pages  for each row execute function public.offer_keep_history();

-- ── public entry point used by the website ─────────────────────────
-- Returns the page only for a valid (not expired, not revoked) client link,
-- for pages marked public, or for a signed-in admin (preview).
create or replace function public.get_offer(p_slug text, p_token text default null, p_track boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_site jsonb;
  v_page public.offer_pages%rowtype;
  v_link public.offer_links%rowtype;
begin
  select content into v_site from public.offer_site where id = 1;

  -- A valid client link opens its page even if the page address (slug) changed later.
  if coalesce(p_token, '') <> '' then
    select * into v_link from public.offer_links where token = p_token;
    if found and v_link.revoked_at is null and (v_link.expires_at is null or v_link.expires_at > now()) then
      select * into v_page from public.offer_pages where id = v_link.page_id;
      if p_track then
        update public.offer_links
           set open_count = open_count + 1,
               first_opened_at = coalesce(first_opened_at, now()),
               last_opened_at = now()
         where id = v_link.id;
      end if;
      return jsonb_build_object('status', 'ok', 'site', v_site, 'page', v_page.content,
                                'slug', v_page.slug, 'expires_at', v_link.expires_at);
    end if;
  end if;

  select * into v_page from public.offer_pages where slug = lower(coalesce(p_slug, ''));
  if not found then
    return jsonb_build_object('status', case when coalesce(p_token, '') <> '' then 'expired' else 'not_found' end, 'site', v_site);
  end if;

  if v_page.is_public or public.is_offer_admin() then
    return jsonb_build_object('status', 'ok', 'site', v_site, 'page', v_page.content, 'slug', v_page.slug);
  end if;

  return jsonb_build_object('status', 'expired', 'site', v_site);
end $$;

-- ── security ───────────────────────────────────────────────────────
alter table public.offer_admins  enable row level security;
alter table public.offer_site    enable row level security;
alter table public.offer_pages   enable row level security;
alter table public.offer_history enable row level security;
alter table public.offer_links   enable row level security;

revoke all on public.offer_admins, public.offer_site, public.offer_pages, public.offer_history, public.offer_links from anon;

create policy offer_admins_read on public.offer_admins for select to authenticated using (public.is_offer_admin());
create policy offer_site_admin  on public.offer_site   for all to authenticated using (public.is_offer_admin()) with check (public.is_offer_admin());
create policy offer_pages_admin on public.offer_pages  for all to authenticated using (public.is_offer_admin()) with check (public.is_offer_admin());
create policy offer_links_admin on public.offer_links  for all to authenticated using (public.is_offer_admin()) with check (public.is_offer_admin());
create policy offer_history_read on public.offer_history for select to authenticated using (public.is_offer_admin());

revoke all on function public.get_offer(text, text, boolean) from public;
grant execute on function public.get_offer(text, text, boolean) to anon, authenticated;
revoke all on function public.is_offer_admin() from public, anon;
grant execute on function public.is_offer_admin() to authenticated;
revoke all on function public.offer_touch() from public, anon, authenticated;
revoke all on function public.offer_keep_history() from public, anon, authenticated;
revoke all on function public.offer_new_token() from public, anon;
grant execute on function public.offer_new_token() to authenticated;

-- ── images ─────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('offer-media', 'offer-media', true, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy offer_media_admin_read   on storage.objects for select to authenticated using (bucket_id = 'offer-media' and public.is_offer_admin());
create policy offer_media_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'offer-media' and public.is_offer_admin());
create policy offer_media_admin_update on storage.objects for update to authenticated using (bucket_id = 'offer-media' and public.is_offer_admin());
create policy offer_media_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'offer-media' and public.is_offer_admin());

-- ── admins ─────────────────────────────────────────────────────────
-- Admin emails are added directly in the database (kept out of git):
--   insert into public.offer_admins (email) values ('someone@example.com');
