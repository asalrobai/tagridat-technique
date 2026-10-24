/* ===== Supabase setup ===== */
const SUPABASE_URL = 'https://mljbomwotnaxpkeyrism.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_be686h8b2JJBrcSXyySgMQ_qgGfsx4A';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ===== State ===== */
let currentUser = null;   // profile
let currentSession = null;
let postsCache = [];
let usersCache = [];
let currentView = 'home';
let currentFilter = 'all';
let currentSearch = '';
let authMode = 'login';
let editingId = null;
let adminTab = 'stats';

/* ===== Helpers ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function timeAgo(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} س`;
  const days = Math.floor(h / 24);
  if (days < 30) return `قبل ${days} ي`;
  return new Date(ts).toLocaleDateString('ar');
}
function avatarLetter(name) { return (name || '?').charAt(0).toUpperCase(); }

/* ===== Theme ===== */
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('tagridat_theme', t);
  const btn = $('#themeToggle');
  if (btn) btn.innerHTML = t === 'light' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}
function initTheme() { setTheme(localStorage.getItem('tagridat_theme') || 'dark'); }

/* ===== Mappers ===== */
function mapPost(row) {
  return {
    id: row.id, userId: row.user_id, username: row.username,
    title: row.title || '', content: row.content,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    pinned: !!row.pinned, featured: !!row.featured,
  };
}
function mapProfile(row) {
  return { id: row.id, username: row.username, email: row.email, role: row.role, banned: !!row.banned, createdAt: new Date(row.created_at).getTime() };
}

/* ===== Data access ===== */
async function fetchProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) return null;
  return data ? mapProfile(data) : null;
}
async function fetchPosts() {
  const { data, error } = await sb.from('posts').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapPost);
}
async function fetchUsers() {
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapProfile);
}
async function refreshData() {
  try { postsCache = await fetchPosts(); } catch (e) { postsCache = []; }
  try { usersCache = await fetchUsers(); } catch (e) { usersCache = []; }
}

function isAdmin(u) { return !!u && u.role === 'admin'; }

/* ===== Auth ===== */
async function login(identifier, password) {
  identifier = (identifier || '').trim();
  let email = identifier;
  if (!identifier.includes('@')) {
    const { data: prof } = await sb.from('profiles').select('email').eq('username', identifier).maybeSingle();
    if (!prof) throw new Error('المستخدم غير موجود');
    email = prof.email;
  }
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error('بيانات الدخول غير صحيحة');
  const profile = await fetchProfile(data.user.id);
  if (profile && profile.banned) {
    await sb.auth.signOut();
    throw new Error('هذا الحساب محظور');
  }
  return profile;
}
async function register(username, email, password) {
  username = (username || '').trim();
  email = (email || '').trim().toLowerCase();
  if (username.length < 3) throw new Error('اسم المستخدم يجب أن يكون 3 أحرف على الأقل');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('البريد الإلكتروني غير صالح');
  if (password.length < 6) throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
  const { data: existing } = await sb.from('profiles').select('id').eq('username', username).maybeSingle();
  if (existing) throw new Error('اسم المستخدم مستخدم بالفعل');
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
  if (error) throw new Error(error.message);
  // ensure profile exists (trigger may handle; fallback insert)
  if (data.user) {
    const p = await fetchProfile(data.user.id);
    if (!p) {
      await sb.from('profiles').insert({ id: data.user.id, username, email, role: 'user' });
    }
  }
  return data;
}
async function loadSession(session) {
  currentSession = session;
  if (session) {
    currentUser = await fetchProfile(session.user.id);
    if (!currentUser && session.user) {
      const username = session.user.user_metadata?.username || session.user.email.split('@')[0];
      await sb.from('profiles').insert({ id: session.user.id, username, email: session.user.email, role: 'user' });
      currentUser = await fetchProfile(session.user.id);
    }
  } else {
    currentUser = null;
  }
  refreshAuthUI();
}

/* ===== Posts ===== */
async function createPost(data) {
  const u = currentUser;
  if (!u) throw new Error('يجب تسجيل الدخول');
  const content = (data.content || '').trim();
  if (!content) throw new Error('المحتوى مطلوب');
  if (content.length > 500) throw new Error('الحد الأقصى 500 حرف');
  const { data: row, error } = await sb.from('posts').insert({
    user_id: u.id, username: u.username,
    title: (data.title || '').trim().slice(0, 80),
    content, pinned: !!data.pinned, featured: !!data.featured,
  }).select().single();
  if (error) throw new Error(error.message);
  return mapPost(row);
}
async function updatePost(id, data) {
  const u = currentUser;
  if (!u) throw new Error('يجب تسجيل الدخول');
  const payload = {};
  if (data.content !== undefined) {
    const c = data.content.trim();
    if (!c) throw new Error('المحتوى مطلوب');
    if (c.length > 500) throw new Error('الحد الأقصى 500 حرف');
    payload.content = c;
  }
  if (data.title !== undefined) payload.title = data.title.trim().slice(0, 80);
  if (data.pinned !== undefined) payload.pinned = !!data.pinned;
  if (data.featured !== undefined) payload.featured = !!data.featured;
  payload.updated_at = new Date().toISOString();
  const { error } = await sb.from('posts').update(payload).eq('id', id);
  if (error) throw new Error(error.message);
}
async function deletePost(id) {
  const { error } = await sb.from('posts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
async function togglePin(id) {
  const p = postsCache.find(x => x.id === id);
  if (!p) return;
  await updatePost(id, { pinned: !p.pinned });
}
async function toggleFeature(id) {
  const p = postsCache.find(x => x.id === id);
  if (!p) return;
  await updatePost(id, { featured: !p.featured });
}

function sortPosts(list) {
  return list.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
}

/* ===== Admin ===== */
async function adminToggleRole(id) {
  if (!isAdmin(currentUser)) throw new Error('صلاحية مطلوبة');
  const t = usersCache.find(x => x.id === id);
  if (!t) throw new Error('المستخدم غير موجود');
  if (t.id === currentUser.id) throw new Error('لا يمكنك تغيير دورك');
  const newRole = t.role === 'admin' ? 'user' : 'admin';
  const { error } = await sb.from('profiles').update({ role: newRole }).eq('id', id);
  if (error) throw new Error(error.message);
}
async function adminToggleBan(id) {
  if (!isAdmin(currentUser)) throw new Error('صلاحية مطلوبة');
  const t = usersCache.find(x => x.id === id);
  if (!t) throw new Error('المستخدم غير موجود');
  if (t.id === currentUser.id) throw new Error('لا يمكنك حظر نفسك');
  const { error } = await sb.from('profiles').update({ banned: !t.banned }).eq('id', id);
  if (error) throw new Error(error.message);
}
async function adminDeleteUserPosts(id) {
  if (!isAdmin(currentUser)) throw new Error('صلاحية مطلوبة');
  const { error } = await sb.from('posts').delete().eq('user_id', id);
  if (error) throw new Error(error.message);
}

/* ===== UI ===== */
function refreshAuthUI() {
  const u = currentUser;
  $('#guestActions').classList.toggle('hidden', !!u);
  $('#userMenu').classList.toggle('hidden', !u);
  $('#composer').classList.toggle('hidden', !u);
  $('#adminQuick').classList.toggle('hidden', !isAdmin(u));
  $('#adminLink').classList.toggle('hidden', !isAdmin(u));
  if (u) {
    $('#userName').textContent = u.username;
    $('#userAvatar').textContent = avatarLetter(u.username);
    $('#composerName').textContent = u.username;
    $('#composerAvatar').textContent = avatarLetter(u.username);
  }
}

function extractTags(content) {
  const m = content.match(/#[\w\u0600-\u06FF]+/g);
  return m ? Array.from(new Set(m)).slice(0, 4) : [];
}

function filteredPosts() {
  let list = postsCache;
  if (currentView === 'featured') list = list.filter(p => p.featured);
  if (currentView === 'myPosts') list = list.filter(p => currentUser && p.userId === currentUser.id);
  if (currentView === 'home' || currentView === 'explore') {
    if (currentFilter === 'pinned') list = list.filter(p => p.pinned);
    if (currentFilter === 'featured') list = list.filter(p => p.featured);
    if (currentFilter === 'mine') list = list.filter(p => currentUser && p.userId === currentUser.id);
  }
  if (currentSearch.trim()) {
    const q = currentSearch.trim().toLowerCase();
    list = list.filter(p => (p.title + ' ' + p.content + ' ' + p.username).toLowerCase().includes(q));
  }
  return sortPosts(list);
}

function renderPostCard(p, u) {
  const card = document.createElement('article');
  card.className = 'post-card' + (p.pinned ? ' pinned' : '') + (p.featured ? ' featured' : '');
  const canEdit = u && (p.userId === u.id || isAdmin(u));
  const tags = extractTags(p.content);
  card.innerHTML = `
    <div class="post-header">
      <span class="avatar">${avatarLetter(p.username)}</span>
      <div class="post-author">
        <strong>${escapeHtml(p.username)}</strong>
        <span>${timeAgo(p.createdAt)}${p.updatedAt !== p.createdAt ? ' · معدّلة' : ''}</span>
      </div>
      <div class="post-badges">
        ${p.pinned ? '<span class="badge-pin" title="مثبتة"><i class="fa-solid fa-thumbtack"></i></span>' : ''}
        ${p.featured ? '<span class="badge-feature" title="مميزة"><i class="fa-solid fa-star"></i></span>' : ''}
      </div>
    </div>
    ${p.title ? `<div class="post-title">${escapeHtml(p.title)}</div>` : ''}
    <div class="post-content">${escapeHtml(p.content)}</div>
    <div class="post-footer">
      <div class="post-meta">
        <span><i class="fa-regular fa-clock"></i> ${new Date(p.createdAt).toLocaleString('ar')}</span>
        ${tags.length ? `<span><i class="fa-solid fa-hashtag"></i> ${tags.join(', ')}</span>` : ''}
      </div>
      <div class="post-actions">
        ${canEdit ? `
          <button class="action-btn ${p.pinned ? 'active-pin' : ''}" title="تثبيت" data-act="pin" data-id="${p.id}"><i class="fa-solid fa-thumbtack"></i></button>
          <button class="action-btn ${p.featured ? 'active-feat' : ''}" title="مميزة" data-act="feat" data-id="${p.id}"><i class="fa-solid fa-star"></i></button>
          <button class="action-btn" title="تعديل" data-act="edit" data-id="${p.id}"><i class="fa-solid fa-pen"></i></button>
          <button class="action-btn danger" title="حذف" data-act="del" data-id="${p.id}"><i class="fa-solid fa-trash"></i></button>
        ` : ''}
      </div>
    </div>
  `;
  card.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = btn.dataset.act; const id = btn.dataset.id;
      try {
        if (act === 'pin') { await togglePin(id); toast('تم تحديث التثبيت'); }
        if (act === 'feat') { await toggleFeature(id); toast('تم تحديث التمييز'); }
        if (act === 'edit') openEdit(id);
        if (act === 'del') {
          if (confirm('هل أنت متأكد من حذف هذه التدوينة؟')) { await deletePost(id); toast('تم الحذف'); }
        }
        await refreshData();
        renderPosts();
        if (currentView === 'admin') renderAdmin();
      } catch (ex) { toast(ex.message); }
    });
  });
  return card;
}

async function renderPosts() {
  const container = currentView === 'myPosts' ? $('#myPostsList') : $('#postsList');
  if (!container) return;
  $('#loadingState').classList.remove('hidden');
  $('#emptyState').classList.add('hidden');
  await refreshData();
  $('#loadingState').classList.add('hidden');
  container.innerHTML = '';
  const list = filteredPosts();
  if (list.length === 0) {
    if (currentView !== 'myPosts') $('#emptyState').classList.remove('hidden');
    else container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-feather-pointed"></i><h3>لا توجد تدوينات</h3><p>ابدأ بكتابة أول تدوينة!</p></div>';
    updateStats();
    renderTagCloud();
    return;
  }
  $('#emptyState').classList.add('hidden');
  const u = currentUser;
  list.forEach(p => container.appendChild(renderPostCard(p, u)));
  updateStats();
  renderTagCloud();
}

function updateStats() {
  const posts = postsCache;
  $('#statPosts').textContent = posts.length;
  $('#statUsers').textContent = usersCache.length;
  $('#statFeatured').textContent = posts.filter(p => p.featured).length;
}

function renderTagCloud() {
  const tags = {};
  postsCache.forEach(p => extractTags(p.content + ' ' + (p.title || '')).forEach(t => tags[t] = (tags[t] || 0) + 1));
  const el = $('#tagCloud');
  if (!el) return;
  const sorted = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 12);
  el.innerHTML = sorted.map(([t]) => `<span class="tag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('') || '<span class="tag">لا توجد وسوم</span>';
  el.querySelectorAll('.tag').forEach(tg => tg.addEventListener('click', () => {
    $('#searchInput').value = tg.dataset.tag;
    currentSearch = tg.dataset.tag;
    renderPosts();
  }));
}

/* ===== Auth modal ===== */
function openAuth(mode) {
  authMode = mode || 'login';
  updateAuthUI();
  $('#authModal').classList.remove('hidden');
}
function closeAuth() { $('#authModal').classList.add('hidden'); $('#authError').classList.add('hidden'); }
function updateAuthUI() {
  const isReg = authMode === 'register';
  $$('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === authMode));
  $('#emailField').style.display = isReg ? '' : 'none';
  $('#confirmField').style.display = isReg ? '' : 'none';
  $('#usernameField').querySelector('label').textContent = isReg ? 'اسم المستخدم' : 'اسم المستخدم أو البريد';
  $('#authSubmit').textContent = isReg ? 'إنشاء حساب' : 'دخول';
  $('#authHint').textContent = isReg ? 'أدخل بياناتك لإنشاء حساب جديد' : 'استخدم بريدك الإلكتروني أو اسم المستخدم';
}

/* ===== Edit modal ===== */
function openEdit(id) {
  const p = postsCache.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  $('#editTitle').value = p.title || '';
  $('#editContent').value = p.content;
  $('#editPin').checked = !!p.pinned;
  $('#editFeature').checked = !!p.featured;
  $('#editModal').classList.remove('hidden');
}
function closeEdit() { $('#editModal').classList.add('hidden'); editingId = null; }

/* ===== Views ===== */
function showView(name) {
  $('#hero').classList.toggle('hidden', name !== 'home' && name !== 'explore' && name !== 'featured');
  const main = $('main.main');
  const adminView = $('#adminView');
  const profileView = $('#profileView');
  const myPostsView = $('#myPostsView');
  main.classList.toggle('hidden', name === 'admin' || name === 'profile' || name === 'myPosts');
  adminView.classList.toggle('hidden', name !== 'admin');
  profileView.classList.toggle('hidden', name !== 'profile');
  myPostsView.classList.toggle('hidden', name !== 'myPosts');
  const titles = { home: 'آخر التدوينات', explore: 'استكشاف', featured: 'التدوينات المميزة' };
  if (titles[name]) $('#feedTitle').textContent = titles[name];
  $$('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.route === name));
  currentView = name;
  if (name === 'admin') renderAdmin();
  if (name === 'profile') renderProfile();
  if (name === 'myPosts') renderMyPosts();
  renderPosts();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function handleRoute() {
  const hash = (location.hash || '#home').replace('#', '');
  const name = ['home','explore','featured','profile','myPosts','admin'].includes(hash) ? hash : 'home';
  showView(name);
}

/* ===== Admin render ===== */
async function renderAdmin() {
  const content = $('#adminContent');
  const u = currentUser;
  if (!isAdmin(u)) { content.innerHTML = '<div class="empty-state"><i class="fa-solid fa-lock"></i><h3>غير مصرح</h3><p>هذه الصفحة للمدير فقط.</p></div>'; return; }
  await refreshData();
  if (adminTab === 'stats') renderAdminStats(content);
  else if (adminTab === 'users') renderAdminUsers(content);
  else if (adminTab === 'posts') renderAdminPosts(content);
  else if (adminTab === 'settings') renderAdminSettings(content);
}
function renderAdminStats(content) {
  const users = usersCache; const posts = postsCache;
  const admins = users.filter(u => u.role === 'admin').length;
  const banned = users.filter(u => u.banned).length;
  const pinned = posts.filter(p => p.pinned).length;
  const featured = posts.filter(p => p.featured).length;
  content.innerHTML = `
    <div class="stat-grid">
      <div class="stat-box"><div class="num">${users.length}</div><div class="lbl">المستخدمون</div></div>
      <div class="stat-box"><div class="num">${admins}</div><div class="lbl">المدراء</div></div>
      <div class="stat-box"><div class="num">${banned}</div><div class="lbl">المحظورون</div></div>
      <div class="stat-box"><div class="num">${posts.length}</div><div class="lbl">التدوينات</div></div>
      <div class="stat-box"><div class="num">${pinned}</div><div class="lbl">المثبتة</div></div>
      <div class="stat-box"><div class="num">${featured}</div><div class="lbl">المميزة</div></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px">آخر المستخدمين</h3>
      <table class="admin-table">
        <thead><tr><th>اسم المستخدم</th><th>البريد</th><th>الدور</th><th>تاريخ الإنشاء</th></tr></thead>
        <tbody>
          ${users.slice(0, 5).map(u => `<tr>
            <td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.email)}</td>
            <td><span class="role-badge ${u.role === 'admin' ? 'role-admin' : 'role-user'}">${u.role === 'admin' ? 'مدير' : 'مستخدم'}</span></td>
            <td>${new Date(u.createdAt).toLocaleDateString('ar')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}
function renderAdminUsers(content) {
  const users = usersCache;
  const u = currentUser;
  content.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:12px">إدارة المستخدمين (${users.length})</h3>
      <div style="overflow-x:auto">
      <table class="admin-table">
        <thead><tr><th>اسم المستخدم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>تدوينات</th><th>إجراءات</th></tr></thead>
        <tbody>
          ${users.map(x => {
            const pc = postsCache.filter(p => p.userId === x.id).length;
            return `<tr>
              <td><strong>${escapeHtml(x.username)}</strong>${x.id === u.id ? ' <em>(أنت)</em>' : ''}</td>
              <td>${escapeHtml(x.email)}</td>
              <td><span class="role-badge ${x.role === 'admin' ? 'role-admin' : 'role-user'}">${x.role === 'admin' ? 'مدير' : 'مستخدم'}</span></td>
              <td>${x.banned ? '<span style="color:var(--danger)">محظور</span>' : '<span style="color:var(--success)">نشط</span>'}</td>
              <td>${pc}</td>
              <td>
                <div class="admin-actions">
                  <button class="btn btn-sm btn-ghost" data-act="role" data-id="${x.id}" ${x.id === u.id ? 'disabled' : ''} title="تبديل الدور"><i class="fa-solid fa-user-shield"></i></button>
                  <button class="btn btn-sm btn-ghost" data-act="ban" data-id="${x.id}" ${x.id === u.id ? 'disabled' : ''} title="${x.banned ? 'إلغاء الحظر' : 'حظر'}"><i class="fa-solid fa-ban"></i></button>
                  <button class="btn btn-sm btn-danger" data-act="delposts" data-id="${x.id}" ${x.id === u.id ? 'disabled' : ''} title="حذف تدويناته"><i class="fa-solid fa-trash"></i></button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
    </div>
  `;
  content.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act; const id = btn.dataset.id;
      try {
        if (act === 'role') { await adminToggleRole(id); toast('تم تغيير الدور'); }
        if (act === 'ban') { await adminToggleBan(id); toast('تم تحديث الحظر'); }
        if (act === 'delposts') {
          if (confirm('حذف جميع تدوينات هذا المستخدم؟')) { await adminDeleteUserPosts(id); toast('تم الحذف'); }
        }
        await refreshData();
        renderAdmin();
      } catch (e) { toast(e.message); }
    });
  });
}
function renderAdminPosts(content) {
  const posts = sortPosts(postsCache);
  content.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:12px">إدارة التدوينات (${posts.length})</h3>
      <div style="overflow-x:auto">
      <table class="admin-table">
        <thead><tr><th>العنوان/المحتوى</th><th>المؤلف</th><th>مثبتة</th><th>مميزة</th><th>التاريخ</th><th>إجراءات</th></tr></thead>
        <tbody>
          ${posts.map(p => `<tr>
            <td style="max-width:320px">${escapeHtml((p.title ? p.title + ' — ' : '') + p.content.slice(0, 60))}${p.content.length > 60 ? '…' : ''}</td>
            <td>${escapeHtml(p.username)}</td>
            <td>${p.pinned ? '<i class="fa-solid fa-check" style="color:var(--success)"></i>' : '—'}</td>
            <td>${p.featured ? '<i class="fa-solid fa-check" style="color:var(--success)"></i>' : '—'}</td>
            <td>${new Date(p.createdAt).toLocaleDateString('ar')}</td>
            <td>
              <div class="admin-actions">
                <button class="action-btn ${p.pinned ? 'active-pin' : ''}" data-act="pin" data-id="${p.id}" title="تثبيت"><i class="fa-solid fa-thumbtack"></i></button>
                <button class="action-btn ${p.featured ? 'active-feat' : ''}" data-act="feat" data-id="${p.id}" title="مميزة"><i class="fa-solid fa-star"></i></button>
                <button class="action-btn danger" data-act="del" data-id="${p.id}" title="حذف"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>
  `;
  content.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act; const id = btn.dataset.id;
      try {
        if (act === 'pin') await togglePin(id);
        if (act === 'feat') await toggleFeature(id);
        if (act === 'del') { if (confirm('حذف؟')) await deletePost(id); }
        await refreshData();
        renderAdmin();
        renderPosts();
      } catch (e) { toast(e.message); }
    });
  });
}
function renderAdminSettings(content) {
  content.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:12px">إعدادات النظام</h3>
      <div class="profile-info">
        <div class="info-row"><span>اسم التطبيق</span><strong>تغريدات تقنية</strong></div>
        <div class="info-row"><span>قاعدة البيانات</span><strong>Supabase (PostgreSQL)</strong></div>
        <div class="info-row"><span>الإصدار</span><strong>2.0.0</strong></div>
        <div class="info-row"><span>اللغة</span><strong>العربية (RTL)</strong></div>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
      <p style="color:var(--text-muted);font-size:.9rem">لتصدير/مسح البيانات استخدم لوحة تحكم Supabase.</p>
    </div>
  `;
}

function renderProfile() {
  const u = currentUser;
  const card = $('#profileCard');
  if (!u) { card.innerHTML = '<div class="empty-state"><i class="fa-solid fa-user"></i><h3>غير مسجل</h3></div>'; return; }
  const pc = postsCache.filter(p => p.userId === u.id).length;
  card.innerHTML = `
    <div class="profile-head">
      <span class="avatar">${avatarLetter(u.username)}</span>
      <div>
        <h2 style="font-weight:800">${escapeHtml(u.username)}</h2>
        <p style="color:var(--text-muted)">${escapeHtml(u.email)}</p>
      </div>
    </div>
    <div class="profile-info">
      <div class="info-row"><span>الدور</span><strong>${u.role === 'admin' ? 'مدير النظام' : 'مستخدم'}</strong></div>
      <div class="info-row"><span>التدوينات</span><strong>${pc}</strong></div>
      <div class="info-row"><span>تاريخ الانضمام</span><strong>${new Date(u.createdAt).toLocaleDateString('ar')}</strong></div>
      <div class="info-row"><span>الحالة</span><strong>${u.banned ? 'محظور' : 'نشط'}</strong></div>
    </div>
  `;
}
function renderMyPosts() { renderPosts(); }

/* ===== Init ===== */
async function init() {
  initTheme();

  // auth modal
  $('#openLogin').addEventListener('click', () => openAuth('login'));
  $('#openRegister').addEventListener('click', () => openAuth('register'));
  $('#heroStart').addEventListener('click', () => { if (currentUser) showView('home'); else openAuth('register'); });
  $('#heroExplore').addEventListener('click', () => showView('explore'));
  $('#modalBackdrop').addEventListener('click', closeAuth);
  $('#modalClose').addEventListener('click', closeAuth);
  $$('.modal-tab').forEach(t => t.addEventListener('click', () => { authMode = t.dataset.mode; updateAuthUI(); }));

  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#authError');
    err.classList.add('hidden');
    try {
      if (authMode === 'register') {
        const username = $('#authUsername').value;
        const email = $('#authEmail').value;
        const password = $('#authPassword').value;
        const confirm = $('#authConfirm').value;
        if (password !== confirm) throw new Error('كلمتا المرور غير متطابقتين');
        await register(username, email, password);
        // if email confirmation required, session may be null
        const { data } = await sb.auth.getSession();
        if (!data.session) {
          toast('تم إرسال رابط التأكيد إلى بريدك الإلكتروني');
        } else {
          await loadSession(data.session);
          toast('تم إنشاء الحساب');
        }
      } else {
        await login($('#authUsername').value, $('#authPassword').value);
        const { data } = await sb.auth.getSession();
        await loadSession(data.session);
        toast('مرحباً!');
      }
      closeAuth();
      await refreshData();
      renderPosts();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });

  $('#userChip').addEventListener('click', () => $('#userDropdown').classList.toggle('hidden'));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu')) $('#userDropdown').classList.add('hidden');
  });
  $('#logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    toast('تم تسجيل الخروج');
  });

  $$('[data-route]').forEach(el => el.addEventListener('click', (e) => {
    e.preventDefault();
    const r = el.dataset.route;
    if (r) location.hash = r;
  }));
  window.addEventListener('hashchange', handleRoute);

  $$('.filter-btn').forEach(b => b.addEventListener('click', () => {
    $$('.filter-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentFilter = b.dataset.filter;
    renderPosts();
  }));

  $('#searchInput').addEventListener('input', (e) => { currentSearch = e.target.value; renderPosts(); });

  $('#postContent').addEventListener('input', (e) => { $('#charCount').textContent = e.target.value.length; });
  $('#publishBtn').addEventListener('click', async () => {
    try {
      await createPost({
        title: $('#postTitle').value,
        content: $('#postContent').value,
        pinned: $('#postPin').checked,
        featured: $('#postFeature').checked,
      });
      $('#postTitle').value = ''; $('#postContent').value = '';
      $('#postPin').checked = false; $('#postFeature').checked = false;
      $('#charCount').textContent = '0';
      toast('تم نشر التدوينة');
      await refreshData();
      renderPosts();
    } catch (e) { toast(e.message); }
  });

  $('#editClose').addEventListener('click', closeEdit);
  $('#editBackdrop').addEventListener('click', closeEdit);
  $('#saveEditBtn').addEventListener('click', async () => {
    try {
      await updatePost(editingId, {
        title: $('#editTitle').value,
        content: $('#editContent').value,
        pinned: $('#editPin').checked,
        featured: $('#editFeature').checked,
      });
      closeEdit();
      toast('تم الحفظ');
      await refreshData();
      renderPosts();
      if (currentView === 'admin') renderAdmin();
    } catch (e) { toast(e.message); }
  });

  $$('.tab-btn').forEach(b => b.addEventListener('click', () => {
    $$('.tab-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    adminTab = b.dataset.tab;
    renderAdmin();
  }));

  $('#themeToggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(cur === 'light' ? 'dark' : 'light');
  });

  // auth state
  sb.auth.onAuthStateChange(async (_event, session) => {
    await loadSession(session);
    await refreshData();
    renderPosts();
    if (currentView === 'admin') renderAdmin();
    if (currentView === 'profile') renderProfile();
  });

  const { data: { session } } = await sb.auth.getSession();
  await loadSession(session);
  await refreshData();
  handleRoute();
  updateStats();
}

document.addEventListener('DOMContentLoaded', init);
