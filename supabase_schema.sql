-- ============================================================
-- تغريدات تقنية — Supabase Schema + RLS
-- انسخ هذا الكود بالكامل والصقه في: Supabase Dashboard -> SQL Editor -> Run
-- ============================================================

-- 1) جدول الملفات الشخصية (profiles)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  email text,
  role text not null default 'user' check (role in ('user','admin')),
  banned boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2) جدول التدوينات (posts)
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text,
  title text,
  content text not null check (char_length(content) <= 500),
  pinned boolean not null default false,
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) تريغر: إنشاء profile تلقائياً عند تسجيل مستخدم جديد
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email,
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 4) تريغر: تحديث updated_at تلقائياً
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists posts_touch_updated_at on public.posts;
create trigger posts_touch_updated_at
before update on public.posts
for each row execute function public.touch_updated_at();

-- 5) تفعيل Row Level Security
alter table public.profiles enable row level security;
alter table public.posts enable row level security;

-- 6) سياسات profiles
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- 7) سياسات posts
drop policy if exists "posts_select_all" on public.posts;
create policy "posts_select_all" on public.posts
  for select using (true);

drop policy if exists "posts_insert_auth" on public.posts;
create policy "posts_insert_auth" on public.posts
  for insert with check (auth.uid() = user_id);

drop policy if exists "posts_update_owner_admin" on public.posts;
create policy "posts_update_owner_admin" on public.posts
  for update using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "posts_delete_owner_admin" on public.posts;
create policy "posts_delete_owner_admin" on public.posts
  for delete using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ============================================================
-- 8) (اختياري) تعيين مدير نظام: بعد إنشاء حسابك، شغّل:
-- update public.profiles set role = 'admin' where email = 'your@email.com';
-- ============================================================

-- 9) (اختياري) فهارس للأداء
create index if not exists posts_user_id_idx on public.posts(user_id);
create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists profiles_username_idx on public.profiles(username);
