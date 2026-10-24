/* ===== Data layer (localStorage) ===== */
const K = {
  users: 'tagridat_users',
  posts: 'tagridat_posts',
  session: 'tagridat_session',
  theme: 'tagridat_theme',
};

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}
function write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function uid() { return 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function now() { return Date.now(); }

function getUsers() { return read(K.users, []); }
function saveUsers(u) { write(K.users, u); }
function getPosts() { return read(K.posts, []); }
function savePosts(p) { write(K.posts, p); }
function getSession() { return read(K.session, null); }
function setSession(id) { write(K.session, id); }
function clearSession() { localStorage.removeItem(K.session); }

/* Seed admin */
function seed() {
  const users = getUsers();
  if (!users.some(u => u.role === 'admin')) {
    users.push({
      id: uid(), username: 'admin', email: 'admin@tagridat.com',
      password: 'admin123', role: 'admin', createdAt: now(), banned: false,
    });
    saveUsers(users);
  }
  // seed sample posts if empty
  if (getPosts().length === 0) {
    const admin = users.find(u => u.role === 'admin');
    const samples = [
      { title: 'مرحباً بكم في تغريدات تقنية!', content: 'منصة عربية لمشاركة الأفكار التقنية. اكتب، ثبّت، واجعل الأفضل مميزاً. نرحب بجميع المطورين والمهتمين بالتقنية.', pinned: true, featured: true },
      { title: 'نصيحة: ابدأ بمشروع صغير', content: 'أفضل طريقة لتعلم البرمجة هي بناء مشاريع صغيرة ومتكررة. لا تنتظر "الفكرة المثالية" — ابدأ اليوم.', pinned: false, featured: true },
      { title: 'CSS Grid vs Flexbox', content: 'استخدم Flexbox للتخطيطات أحادية البعد، وGrid للتخطيطات двумерной. معاً يشكلان duo قوياً لأي واجهة.', pinned: false, featured: false },
    ];
    const posts = samples.map(s => ({
      id: uid(), userId: admin.id, username: admin.username, title: s.title,
      content: s.content, createdAt: now() - Math.random()*100000, updatedAt: now(),
      pinned: s.pinned, featured: s.featured,
    }));
    savePosts(posts);
  }
}
seed();

/* ===== Auth ===== */
function currentUser() {
  const sid = getSession();
  if (!sid) return null;
  return getUsers().find(u => u.id === sid) || null;
}
function isAdmin(u) { return !!u && u.role === 'admin'; }

function register(username, email, password) {
  username = (username || '').trim();
  email = (email || '').trim().toLowerCase();
  if (username.length < 3) throw new Error('اسم المستخدم يجب أن يكون 3 أحرف على الأقل');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('البريد الإلكتروني غير صالح');
  if (password.length < 6) throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
  const users = getUsers();
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('اسم المستخدم مستخدم بالفعل');
  if (users.some(u => u.email === email)) throw new Error('البريد الإلكتروني مستخدم بالفعل');
  const u = { id: uid(), username, email, password, role: 'user', createdAt: now(), banned: false };
  users.push(u); saveUsers(users);
  setSession(u.id);
  return u;
}
function login(identifier, password) {
  identifier = (identifier || '').trim().toLowerCase();
  const users = getUsers();
  const u = users.find(x => x.username.toLowerCase() === identifier || x.email === identifier);
  if (!u) throw new Error('المستخدم غير موجود');
  if (u.banned) throw new Error('هذا الحساب محظور');
  if (u.password !== password) throw new Error('كلمة المرور غير صحيحة');
  setSession(u.id);
  return u;
}
function logout() { clearSession(); }

/* ===== Posts ===== */
function createPost(data) {
  const u = currentUser();
  if (!u) throw new Error('يجب تسجيل الدخول');
  const content = (data.content || '').trim();
  if (!content) throw new Error('المحتوى مطلوب');
  if (content.length > 500) throw new Error('الحد الأقصى 500 حرف');
  const posts = getPosts();
  const p = {
    id: uid(), userId: u.id, username: u.username,
    title: (data.title || '').trim().slice(0, 80),
    content, createdAt: now(), updatedAt: now(),
    pinned: !!data.pinned, featured: !!data.featured,
  };
  posts.unshift(p); savePosts(posts); return p;
}
function updatePost(id, data) {
  const u = currentUser();
  if (!u) throw new Error('يجب تسجيل الدخول');
  const posts = getPosts();
  const p = posts.find(x => x.id === id);
  if (!p) throw new Error('التدوينة غير موجودة');
  if (p.userId !== u.id && !isAdmin(u)) throw new Error('لا تملك صلاحية التعديل');
  if (data.content !== undefined) {
    const c = data.content.trim();
    if (!c) throw new Error('المحتوى مطلوب');
    if (c.length > 500) throw new Error('الحد الأقصى 500 حرف');
    p.content = c;
  }
  if (data.title !== undefined) p.title = data.title.trim().slice(0, 80);
  if (data.pinned !== undefined) p.pinned = !!data.pinned;
  if (data.featured !== undefined) p.featured = !!data.featured;
  p.updatedAt = now();
  savePosts(posts); return p;
}
function deletePost(id) {
  const u = currentUser();
  if (!u) throw new Error('يجب تسجيل الدخول');
  const posts = getPosts();
  const p = posts.find(x => x.id === id);
  if (!p) throw new Error('التدوينة غير موجودة');
  if (p.userId !== u.id && !isAdmin(u)) throw new Error('لا تملك صلاحية الحذف');
  savePosts(posts.filter(x => x.id !== id));
}
function togglePin(id) {
  const posts = getPosts();
  const p = posts.find(x => x.id === id);
  if (!p) return;
  p.pinned = !p.pinned; p.updatedAt = now(); savePosts(posts);
}
function toggleFeature(id) {
  const posts = getPosts();
  const p = posts.find(x => x.id === id);
  if (!p) return;
  p.featured = !p.featured; p.updatedAt = now(); savePosts(posts);
}

function sortPosts(list) {
  return list.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
}

/* ===== Admin ===== */
function adminDeleteUser(id) {
  const u = currentUser();
  if (!isAdmin(u)) throw new Error('صلاحية مطلوبة');
  if (id === u.id) throw new Error('لا يمكنك حذف حسابك');
  const users = getUsers().filter(x => x.id !== id);
  saveUsers(users);
  // remove their posts? keep but mark? We'll remove posts too for cleanliness
  savePosts(getPosts().filter(p => p.userId !== id));
}
function adminToggleRole(id) {
  const u = currentUser();
  if (!isAdmin(u)) throw new Error('صلاحية مطلوبة');
  const users = getUsers();
  const t = users.find(x => x.id === id);
  if (!t) throw new Error('المستخدم غير موجود');
  if (t.id === u.id) throw new Error('لا يمكنك تغيير دورك');
  t.role = t.role === 'admin' ? 'user' : 'admin';
  saveUsers(users);
}
function adminToggleBan(id) {
  const u = currentUser();
  if (!isAdmin(u)) throw new Error('صلاحية مطلوبة');
  const users = getUsers();
  const t = users.find(x => x.id === id);
  if (!t) throw new Error('المستخدم غير موجود');
  if (t.id === u.id) throw new Error('لا يمكنك حظر نفسك');
  t.banned = !t.banned;
  saveUsers(users);
  if (t.banned) clearSessionIf(id);
}
function clearSessionIf(id) { if (getSession() === id) clearSession(); }

/* ===== UI helpers ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function toast(msg, type = 'info') {
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

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(K.theme, t);
  const btn = $('#themeToggle');
  if (btn) btn.innerHTML = t === 'light' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}
function initTheme() {
  const saved = localStorage.getItem(K.theme) || 'dark';
  setTheme(saved);
}

/* ===== Routing / views ===== */
const views = ['home', 'explore', 'featured', 'profile', 'myPosts', 'admin'];
let currentView = 'home';
let currentFilter = 'all';
let currentSearch = '';

function showView(name) {
  // hide all sections
  $('#hero').classList.toggle('hidden', name !== 'home' && name !== 'explore' && name !== 'featured');
  // main feed shown for home/explore/featured/myPosts? We'll manage
  const main = $('main.main');
  const adminView = $('#adminView');
  const profileView = $('#profileView');
  const myPostsView = $('#myPostsView');

  main.classList.toggle('hidden', name === 'admin' || name === 'profile' || name === 'myPosts');
  adminView.classList.toggle('hidden', name !== 'admin');
  profileView.classList.toggle('hidden', name !== 'profile');
  myPostsView.classList.toggle('hidden', name !== 'myPosts');

  // feed title
  const titles = { home: 'آخر التدوينات', explore: 'استكشاف', featured: 'التدوينات المميزة' };
  if (titles[name]) $('#feedTitle').textContent = titles[name];

  // nav active
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
  const name = views.includes(hash) ? hash : 'home';
  showView(name);
}

/* ===== Render posts ===== */
function filteredPosts() {
  const u = currentUser();
  let list = getPosts();
  // view-based
  if (currentView === 'featured') list = list.filter(p => p.featured);
  if (currentView === 'myPosts') list = list.filter(p => p.userId === (u && u.id));
  // sidebar filter
  if (currentView === 'home' || currentView === 'explore') {
    if (currentFilter === 'pinned') list = list.filter(p => p.pinned);
    if (currentFilter === 'featured') list = list.filter(p => p.featured);
    if (currentFilter === 'mine') list = list.filter(p => u && p.userId === u.id);
  }
  // search
  if (currentSearch.trim()) {
    const q = currentSearch.trim().toLowerCase();
    list = list.filter(p => (p.title + ' ' + p.content + ' ' + p.username).toLowerCase().includes(q));
  }
  return sortPosts(list);
}

function renderPosts() {
  const container = currentView === 'myPosts' ? $('#myPostsList') : $('#postsList');
  if (!container) return;
  // ensure right container visible
  const list = filteredPosts();
  container.innerHTML = '';
  if (list.length === 0) {
    if (currentView !== 'myPosts') $('#emptyState').classList.remove('hidden');
    else container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-feather-pointed"></i><h3>لا توجد تدوينات</h3><p>ابدأ بكتابة أول تدوينة!</p></div>';
    return;
  }
  $('#emptyState').classList.add('hidden');
  const u = currentUser();
  list.forEach(p => container.appendChild(renderPostCard(p, u)));
  updateStats();
  renderTagCloud();
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
  // bind actions
  card.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = btn.dataset.act; const id = btn.dataset.id;
      if (act === 'pin') { togglePin(id); toast('تم تحديث التثبيت'); renderPosts(); }
      if (act === 'feat') { toggleFeature(id); toast('تم تحديث التمييز'); renderPosts(); }
      if (act === 'edit') openEdit(id);
      if (act === 'del') {
        if (confirm('هل أنت متأكد من حذف هذه التدوينة؟')) { deletePost(id); toast('تم الحذف'); renderPosts(); }
      }
    });
  });
  return card;
}

function extractTags(content) {
  const m = content.match(/#[\w\u0600-\u06FF]+/g);
  return m ? Array.from(new Set(m)).slice(0, 4) : [];
}

function renderTagCloud() {
  const posts = getPosts();
  const tags = {};
  posts.forEach(p => extractTags(p.content + ' ' + (p.title||'')).forEach(t => tags[t] = (tags[t]||0)+1));
  const el = $('#tagCloud');
  if (!el) return;
  const sorted = Object.entries(tags).sort((a,b)=>b[1]-a[1]).slice(0,12);
  el.innerHTML = sorted.map(([t]) => `<span class="tag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('') || '<span class="tag">لا توجد وسوم</span>';
  el.querySelectorAll('.tag').forEach(tg => tg.addEventListener('click', () => {
    $('#searchInput').value = tg.dataset.tag;
    currentSearch = tg.dataset.tag;
    renderPosts();
  }));
}

function updateStats() {
  const posts = getPosts(); const users = getUsers();
  $('#statPosts').textContent = posts.length;
  $('#statUsers').textContent = users.length;
  $('#statFeatured').textContent = posts.filter(p=>p.featured).length;
}

/* ===== Auth modal ===== */
let authMode = 'login';
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
  $('#authHint').textContent = isReg ? 'أدخل بياناتك لإنشاء حساب جديد' : 'تجربة: admin / admin123';
}

/* ===== Edit modal ===== */
let editingId = null;
function openEdit(id) {
  const p = getPosts().find(x => x.id === id);
  if (!p) return;
  editingId = id;
  $('#editTitle').value = p.title || '';
  $('#editContent').value = p.content;
  $('#editPin').checked = !!p.pinned;
  $('#editFeature').checked = !!p.featured;
  $('#editModal').classList.remove('hidden');
}
function closeEdit() { $('#editModal').classList.add('hidden'); editingId = null; }

/* ===== Admin render ===== */
let adminTab = 'stats';
function renderAdmin() {
  const content = $('#adminContent');
  const u = currentUser();
  if (!isAdmin(u)) { content.innerHTML = '<div class="empty-state"><i class="fa-solid fa-lock"></i><h3>غير مصرح</h3><p>هذه الصفحة للمدير فقط.</p></div>'; return; }
  if (adminTab === 'stats') renderAdminStats(content);
  else if (adminTab === 'users') renderAdminUsers(content);
  else if (adminTab === 'posts') renderAdminPosts(content);
  else if (adminTab === 'settings') renderAdminSettings(content);
}

function renderAdminStats(content) {
  const users = getUsers(); const posts = getPosts();
  const admins = users.filter(u=>u.role==='admin').length;
  const banned = users.filter(u=>u.banned).length;
  const pinned = posts.filter(p=>p.pinned).length;
  const featured = posts.filter(p=>p.featured).length;
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
          ${users.slice(-5).reverse().map(u=>`<tr>
            <td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.email)}</td>
            <td><span class="role-badge ${u.role==='admin'?'role-admin':'role-user'}">${u.role==='admin'?'مدير':'مستخدم'}</span></td>
            <td>${new Date(u.createdAt).toLocaleDateString('ar')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminUsers(content) {
  const users = getUsers();
  const u = currentUser();
  content.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:12px">إدارة المستخدمين (${users.length})</h3>
      <div style="overflow-x:auto">
      <table class="admin-table">
        <thead><tr><th>اسم المستخدم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>تدوينات</th><th>إجراءات</th></tr></thead>
        <tbody>
          ${users.map(x => {
            const pc = getPosts().filter(p=>p.userId===x.id).length;
            return `<tr>
              <td><strong>${escapeHtml(x.username)}</strong>${x.id===u.id?' <em>(أنت)</em>':''}</td>
              <td>${escapeHtml(x.email)}</td>
              <td><span class="role-badge ${x.role==='admin'?'role-admin':'role-user'}">${x.role==='admin'?'مدير':'مستخدم'}</span></td>
              <td>${x.banned?'<span style="color:var(--danger)">محظور</span>':'<span style="color:var(--success)">نشط</span>'}</td>
              <td>${pc}</td>
              <td>
                <div class="admin-actions">
                  <button class="btn btn-sm btn-ghost" data-act="role" data-id="${x.id}" ${x.id===u.id?'disabled':''} title="تبديل الدور"><i class="fa-solid fa-user-shield"></i></button>
                  <button class="btn btn-sm btn-ghost" data-act="ban" data-id="${x.id}" ${x.id===u.id?'disabled':''} title="${x.banned?'إلغاء الحظر':'حظر'}"><i class="fa-solid fa-ban"></i></button>
                  <button class="btn btn-sm btn-danger" data-act="deluser" data-id="${x.id}" ${x.id===u.id?'disabled':''} title="حذف"><i class="fa-solid fa-trash"></i></button>
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
    btn.addEventListener('click', () => {
      const act = btn.dataset.act; const id = btn.dataset.id;
      try {
        if (act === 'role') { adminToggleRole(id); toast('تم تغيير الدور'); }
        if (act === 'ban') { adminToggleBan(id); toast('تم تحديث الحظر'); }
        if (act === 'deluser') {
          if (confirm('حذف المستخدم وجميع تدويناته؟')) { adminDeleteUser(id); toast('تم الحذف'); }
        }
        renderAdmin();
      } catch (e) { toast(e.message, 'err'); }
    });
  });
}

function renderAdminPosts(content) {
  const posts = sortPosts(getPosts());
  content.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:12px">إدارة التدوينات (${posts.length})</h3>
      <div style="overflow-x:auto">
      <table class="admin-table">
        <thead><tr><th>العنوان/المحتوى</th><th>المؤلف</th><th>مثبتة</th><th>مميزة</th><th>التاريخ</th><th>إجراءات</th></tr></thead>
        <tbody>
          ${posts.map(p => `<tr>
            <td style="max-width:320px">${escapeHtml((p.title? p.title+' — ':'') + p.content.slice(0,60))}${p.content.length>60?'…':''}</td>
            <td>${escapeHtml(p.username)}</td>
            <td>${p.pinned?'<i class="fa-solid fa-check" style="color:var(--success)"></i>':'—'}</td>
            <td>${p.featured?'<i class="fa-solid fa-check" style="color:var(--success)"></i>':'—'}</td>
            <td>${new Date(p.createdAt).toLocaleDateString('ar')}</td>
            <td>
              <div class="admin-actions">
                <button class="action-btn ${p.pinned?'active-pin':''}" data-act="pin" data-id="${p.id}" title="تثبيت"><i class="fa-solid fa-thumbtack"></i></button>
                <button class="action-btn ${p.featured?'active-feat':''}" data-act="feat" data-id="${p.id}" title="مميزة"><i class="fa-solid fa-star"></i></button>
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
    btn.addEventListener('click', () => {
      const act = btn.dataset.act; const id = btn.dataset.id;
      if (act === 'pin') togglePin(id);
      if (act === 'feat') toggleFeature(id);
      if (act === 'del') { if (confirm('حذف؟')) deletePost(id); }
      renderAdmin();
      renderPosts();
    });
  });
}

function renderAdminSettings(content) {
  content.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:12px">إعدادات النظام</h3>
      <div class="profile-info">
        <div class="info-row"><span>اسم التطبيق</span><strong>تغريدات تقنية</strong></div>
        <div class="info-row"><span>التخزين</span><strong>localStorage (محلي)</strong></div>
        <div class="info-row"><span>الإصدار</span><strong>1.0.0</strong></div>
        <div class="info-row"><span>اللغة</span><strong>العربية (RTL)</strong></div>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-danger" id="clearDataBtn"><i class="fa-solid fa-triangle-exclamation"></i> مسح جميع البيانات</button>
        <button class="btn btn-ghost" id="exportDataBtn"><i class="fa-solid fa-download"></i> تصدير JSON</button>
      </div>
    </div>
  `;
  $('#clearDataBtn').addEventListener('click', () => {
    if (confirm('سيتم حذف جميع البيانات (مستخدمون، تدوينات). متابعة؟')) {
      localStorage.removeItem(K.users); localStorage.removeItem(K.posts); localStorage.removeItem(K.session);
      seed(); location.reload();
    }
  });
  $('#exportDataBtn').addEventListener('click', () => {
    const data = { users: getUsers(), posts: getPosts() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'tagridat-backup.json'; a.click();
    URL.revokeObjectURL(url);
    toast('تم التصدير');
  });
}

function renderProfile() {
  const u = currentUser();
  const card = $('#profileCard');
  if (!u) { card.innerHTML = '<div class="empty-state"><i class="fa-solid fa-user"></i><h3>غير مسجل</h3></div>'; return; }
  const pc = getPosts().filter(p=>p.userId===u.id).length;
  card.innerHTML = `
    <div class="profile-head">
      <span class="avatar">${avatarLetter(u.username)}</span>
      <div>
        <h2 style="font-weight:800">${escapeHtml(u.username)}</h2>
        <p style="color:var(--text-muted)">${escapeHtml(u.email)}</p>
      </div>
    </div>
    <div class="profile-info">
      <div class="info-row"><span>الدور</span><strong>${u.role==='admin'?'مدير النظام':'مستخدم'}</strong></div>
      <div class="info-row"><span>التدوينات</span><strong>${pc}</strong></div>
      <div class="info-row"><span>تاريخ الانضمام</span><strong>${new Date(u.createdAt).toLocaleDateString('ar')}</strong></div>
      <div class="info-row"><span>الحالة</span><strong>${u.banned?'محظور':'نشط'}</strong></div>
    </div>
  `;
}

function renderMyPosts() {
  renderPosts();
}

/* ===== Update UI auth state ===== */
function refreshAuthUI() {
  const u = currentUser();
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

/* ===== Init ===== */
function init() {
  initTheme();

  // events
  $('#themeToggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(cur === 'light' ? 'dark' : 'light');
  });

  // auth modal
  $('#openLogin').addEventListener('click', () => openAuth('login'));
  $('#openRegister').addEventListener('click', () => openAuth('register'));
  $('#heroStart').addEventListener('click', () => { if (currentUser()) showView('home'); else openAuth('register'); });
  $('#heroExplore').addEventListener('click', () => showView('explore'));
  $('#modalBackdrop').addEventListener('click', closeAuth);
  $('#modalClose').addEventListener('click', closeAuth);
  $$('.modal-tab').forEach(t => t.addEventListener('click', () => { authMode = t.dataset.mode; updateAuthUI(); }));

  $('#authForm').addEventListener('submit', (e) => {
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
        register(username, email, password);
      } else {
        const id = $('#authUsername').value;
        const password = $('#authPassword').value;
        login(id, password);
      }
      closeAuth();
      refreshAuthUI();
      renderPosts();
      toast('مرحباً!');
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });

  // user menu dropdown
  $('#userChip').addEventListener('click', () => $('#userDropdown').classList.toggle('hidden'));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu')) $('#userDropdown').classList.add('hidden');
  });
  $('#logoutBtn').addEventListener('click', () => { logout(); refreshAuthUI(); renderPosts(); toast('تم تسجيل الخروج'); });

  // nav
  $$('[data-route]').forEach(el => el.addEventListener('click', (e) => {
    e.preventDefault();
    const r = el.dataset.route;
    if (r) { location.hash = r; }
  }));
  window.addEventListener('hashchange', handleRoute);

  // filters
  $$('.filter-btn').forEach(b => b.addEventListener('click', () => {
    $$('.filter-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentFilter = b.dataset.filter;
    renderPosts();
  }));

  // search
  $('#searchInput').addEventListener('input', (e) => { currentSearch = e.target.value; renderPosts(); });

  // composer
  $('#postContent').addEventListener('input', (e) => { $('#charCount').textContent = e.target.value.length; });
  $('#publishBtn').addEventListener('click', () => {
    try {
      createPost({
        title: $('#postTitle').value,
        content: $('#postContent').value,
        pinned: $('#postPin').checked,
        featured: $('#postFeature').checked,
      });
      $('#postTitle').value = ''; $('#postContent').value = '';
      $('#postPin').checked = false; $('#postFeature').checked = false;
      $('#charCount').textContent = '0';
      toast('تم نشر التدوينة');
      renderPosts();
    } catch (e) { toast(e.message, 'err'); }
  });

  // edit modal
  $('#editClose').addEventListener('click', closeEdit);
  $('#editBackdrop').addEventListener('click', closeEdit);
  $('#saveEditBtn').addEventListener('click', () => {
    try {
      updatePost(editingId, {
        title: $('#editTitle').value,
        content: $('#editContent').value,
        pinned: $('#editPin').checked,
        featured: $('#editFeature').checked,
      });
      closeEdit();
      toast('تم الحفظ');
      renderPosts();
      if (currentView === 'admin') renderAdmin();
    } catch (e) { toast(e.message, 'err'); }
  });

  // admin tabs
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => {
    $$('.tab-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    adminTab = b.dataset.tab;
    renderAdmin();
  }));

  refreshAuthUI();
  handleRoute();
  updateStats();
}

document.addEventListener('DOMContentLoaded', init);
