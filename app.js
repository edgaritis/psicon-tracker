/* eslint-disable */
// PsiCon Content Tracker — PWA build (vanilla Preact + htm)
// Works fully offline. localStorage is the only data store.

(function () {
  const { h, render, Fragment } = window.preact;
  const { useState, useEffect, useMemo, useRef, useCallback } = window.preactHooks;
  const html = window.htm.bind(h);

  // ---------------- Supabase config ----------------
  const SUPABASE_URL = 'https://oanejkkwzrzfjuboocwd.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hbmVqa2t3enJ6Zmp1Ym9vY3dkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDU2ODAsImV4cCI6MjA5Nzc4MTY4MH0.aMHIJ75CULIn2tqPlPlCfhiq5FyYZ3wrUNLL_jPTPIg';
  const supa = (window.supabase && typeof window.supabase.createClient === 'function')
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;
  if (!supa) console.warn('Supabase library not loaded — cloud sync disabled.');

  // ---------------- Constants ----------------
  const CATEGORIES = ['3points', 'question', 'howto', 'identity', 'list', 'script', 'prompt', 'quote', 'psychstory'];
  const CAT_COLORS = {
    '3points':   { fg: '#1f5cc7', bg: '#e8f0fc', border: '#c8dcf7' },
    'question':  { fg: '#7a3fbf', bg: '#f1eafa', border: '#dccaf2' },
    'howto':     { fg: '#2d7a4a', bg: '#e6f3eb', border: '#c5e2d0' },
    'identity':  { fg: '#b03868', bg: '#fbe9f0', border: '#f3cadb' },
    'list':      { fg: '#5a6470', bg: '#eef0f3', border: '#d3d8df' },
    'script':    { fg: '#c2682a', bg: '#fbeede', border: '#f2d4b0' },
    'prompt':    { fg: '#1d7e88', bg: '#e1f3f5', border: '#bee2e6' },
    'quote':     { fg: '#4a4dbf', bg: '#ebebf9', border: '#cdcdee' },
    'psychstory':{ fg: '#a83a4a', bg: '#fbe7ea', border: '#f1c6cd' },
  };
  function catColor(c) { return CAT_COLORS[c] || CAT_COLORS['3points']; }

  const STORAGE_KEY = 'psicon_tracker_posts';
  const DEFAULTS_KEY = 'psicon_tracker_defaults';
  const VIEWS_KEY = 'psicon_tracker_views';
  const SEED_FLAG_KEY = 'psicon_tracker_seed_loaded';

  // ---------------- Helpers ----------------
  function normTitle(t) { return (t || '').toLowerCase().replace(/[^a-z0-9áéíóúüñ ]/gi, '').replace(/\s+/g, ' ').trim(); }
  function statusRank(s) { return { published: 4, scheduled: 3, draft: 2, rejected: 1 }[s || 'draft'] || 0; }
  function uid() { return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
  function migratePost(p) {
    const out = { ...p };
    if (typeof out.status === 'undefined') out.status = out.published ? 'published' : 'draft';
    if (typeof out.destinations === 'undefined' || out.destinations === null) out.destinations = { page: out.destination === 'page', group: out.destination === 'group' };
    if (typeof out.formats === 'undefined' || out.formats === null) out.formats = { image: out.format === 'image', reels: out.format === 'reels' };
    if (typeof out.source === 'undefined') out.source = '';
    if (!out.id) out.id = uid();
    delete out.published; delete out.destination; delete out.format;
    return out;
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('save fail', key, e); }
  }

  function csvEscape(v) {
    v = String(v == null ? '' : v);
    if (/[,"\r\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  // ---------------- .md parser ----------------
  function stripEmphasis(s) { return s.replace(/\*([^*]+)\*/g, '$1').replace(/\s+/g, ' ').trim(); }
  function normalizeCategoryName(c) { c = c.toLowerCase(); if (c === 'howtos') return 'howto'; return c; }
  function inferFormatFromFilename(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('reels') || n.includes('_reels_')) return 'reels';
    if (n.includes('image-posts') || n.includes('_image_')) return 'image';
    return 'image';
  }
  function parseBlocks(txt) {
    const lines = txt.split(/\r?\n/);
    const blocks = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const open = line.match(/^:::\s+(\w+)\s*$/);
      if (open && !cur) { cur = { type: open[1].toLowerCase(), raw: [] }; continue; }
      if (cur) {
        if (line.trim() === ':::') { blocks.push(cur); cur = null; continue; }
        cur.raw.push(line);
      }
    }
    return blocks;
  }
  function extractTitleFromBlock(block) {
    for (let i = 0; i < block.raw.length; i++) {
      const m = block.raw[i].match(/^\s*title:\s*(.*)$/);
      if (m) {
        const v = m[1].trim();
        if (v) return v;
        // Empty title — try first non-empty body line.
        const bIdx = block.raw.findIndex((l, j) => j > i && /^\s*body:\s*<<<\s*$/.test(l));
        if (bIdx !== -1) {
          for (let k = bIdx + 1; k < block.raw.length; k++) {
            const l = block.raw[k];
            if (/^\s*>>>\s*$/.test(l)) break;
            const t = l.trim();
            if (t) {
              const clean = t.replace(/^\d+\.\s*/, '').replace(/\*\*/g, '').trim();
              return clean.length > 80 ? clean.slice(0, 77) + '…' : clean;
            }
          }
        }
        return '';
      }
    }
    return '';
  }
  function parseMdFiles(files) {
    // files: array of {name, text}. Returns array of seed-shape objects.
    const out = [];
    for (const f of files) {
      const fmt = inferFormatFromFilename(f.name);
      const blocks = parseBlocks(f.text);
      for (const b of blocks) {
        const category = normalizeCategoryName(b.type);
        const title = stripEmphasis(extractTitleFromBlock(b));
        if (!title) continue;
        out.push({ category, title, format: fmt, source: f.name });
      }
    }
    return out;
  }

  // ---------------- Merge duplicates ----------------
  function mergeDuplicates(posts) {
    const groups = {};
    for (const p of posts) {
      const k = p.category + '|' + normTitle(p.title);
      (groups[k] ||= []).push(p);
    }
    const result = [];
    let mergedGroups = 0, removed = 0;
    for (const arr of Object.values(groups)) {
      if (arr.length === 1) { result.push(arr[0]); continue; }
      mergedGroups++; removed += arr.length - 1;
      const winner = arr.slice().sort((a, b) => statusRank(b.status) - statusRank(a.status) || String(a.id).localeCompare(String(b.id)))[0];
      const f = { image: false, reels: false }, d = { page: false, group: false }, sources = new Set();
      for (const p of arr) {
        if ((p.formats || {}).image) f.image = true;
        if ((p.formats || {}).reels) f.reels = true;
        if ((p.destinations || {}).page) d.page = true;
        if ((p.destinations || {}).group) d.group = true;
        if (p.source) sources.add(p.source);
      }
      result.push({ ...winner, formats: f, destinations: d, source: Array.from(sources).join(' + ') });
    }
    return { posts: result, mergedGroups, removed };
  }

  // ---------------- App ----------------
  function App() {
    const [posts, setPosts] = useState(() => (loadJson(STORAGE_KEY, null) || []).map(migratePost));
    const [defaults, setDefaults] = useState(() => loadJson(DEFAULTS_KEY, {}));
    const [savedViews, setSavedViews] = useState(() => loadJson(VIEWS_KEY, []));
    const [filters, setFilters] = useState({ status: 'all', category: 'all', format: 'all', destination: 'all', dupOnly: false });
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState('date_desc');
    const [selected, setSelected] = useState({});
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(100);
    const [loading, setLoading] = useState(false);
    const [modal, setModal] = useState(null); // 'pick' | 'new' | 'defaults' | 'saveView' | 'help' | 'importMd' | null
    const [pickId, setPickId] = useState(null);
    const [newForm, setNewForm] = useState({ category: '3points', title: '', image: true, reels: false, page: true, group: false });
    const [viewName, setViewName] = useState('');
    const [mdPreview, setMdPreview] = useState(null);
    const [dragActive, setDragActive] = useState(false);

    // ---- Cloud sync state ----
    const [auth, setAuth] = useState({ status: 'loading', user: null });
    const [syncStatus, setSyncStatus] = useState({ state: 'idle', lastAt: null, error: null });
    const [showAuth, setShowAuth] = useState(false);
    const [authEmail, setAuthEmail] = useState('');
    const [authMsg, setAuthMsg] = useState('');
    const [mergeChoice, setMergeChoice] = useState(null);
    const pullDoneRef = useRef(false);
    const pushTimerRef = useRef(null);

    // ----- Persistence -----
    useEffect(() => { saveJson(STORAGE_KEY, posts); }, [posts]);
    useEffect(() => { saveJson(DEFAULTS_KEY, defaults); }, [defaults]);
    useEffect(() => { saveJson(VIEWS_KEY, savedViews); }, [savedViews]);

    // ----- Auth subscription -----
    useEffect(() => {
      if (!supa) { setAuth({ status: 'signedOut', user: null }); return; }
      supa.auth.getSession().then(({ data }) => {
        if (data && data.session) setAuth({ status: 'signedIn', user: data.session.user });
        else setAuth({ status: 'signedOut', user: null });
      });
      const sub = supa.auth.onAuthStateChange((event, session) => {
        if (session) setAuth({ status: 'signedIn', user: session.user });
        else { setAuth({ status: 'signedOut', user: null }); pullDoneRef.current = false; setSyncStatus({ state: 'idle', lastAt: null, error: null }); }
      });
      return () => { try { sub.data.subscription.unsubscribe(); } catch (e) {} };
    }, []);

    // ----- Push to cloud (debounced) -----
    const pushNow = useCallback(async () => {
      if (!supa || auth.status !== 'signedIn' || !auth.user) return;
      if (!pullDoneRef.current) return; // don't overwrite cloud until we've pulled first
      setSyncStatus(s => ({ ...s, state: 'syncing', error: null }));
      try {
        const { error } = await supa.from('tracker_state').upsert({
          user_id: auth.user.id,
          posts,
          defaults,
          saved_views: savedViews,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        if (error) throw error;
        setSyncStatus({ state: 'synced', lastAt: Date.now(), error: null });
      } catch (err) {
        console.warn('sync push failed', err);
        setSyncStatus({ state: 'error', lastAt: null, error: err.message || String(err) });
      }
    }, [auth, posts, defaults, savedViews]);

    // ----- Pull from cloud on sign-in -----
    useEffect(() => {
      if (auth.status !== 'signedIn' || !auth.user) return;
      if (pullDoneRef.current) return;
      setSyncStatus(s => ({ ...s, state: 'syncing', error: null }));
      (async () => {
        try {
          const { data, error } = await supa.from('tracker_state').select().eq('user_id', auth.user.id).maybeSingle();
          if (error && error.code !== 'PGRST116') throw error;
          if (!data) {
            // No cloud row yet — push local up as the initial state
            pullDoneRef.current = true;
            await pushNow();
            return;
          }
          const cloudPosts = Array.isArray(data.posts) ? data.posts : [];
          if (posts.length === 0 || cloudPosts.length === 0) {
            // No conflict — apply whichever has data
            if (cloudPosts.length > 0) {
              setPosts(cloudPosts.map(migratePost));
              if (data.defaults) setDefaults(data.defaults);
              if (Array.isArray(data.saved_views)) setSavedViews(data.saved_views);
            }
            pullDoneRef.current = true;
            setSyncStatus({ state: 'synced', lastAt: Date.now(), error: null });
            return;
          }
          // Both have data — ask the user
          setMergeChoice({
            local: { posts: posts.length },
            cloud: { posts: cloudPosts.length, defaults: data.defaults || {}, savedViews: data.saved_views || [], updatedAt: data.updated_at },
            cloudData: data,
          });
          setSyncStatus({ state: 'idle', lastAt: null, error: null });
        } catch (err) {
          console.warn('sync pull failed', err);
          setSyncStatus({ state: 'error', lastAt: null, error: err.message || String(err) });
        }
      })();
    }, [auth.status, auth.user && auth.user.id]);

    // ----- Auto-push on data changes -----
    useEffect(() => {
      if (!supa || auth.status !== 'signedIn' || !pullDoneRef.current) return;
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      pushTimerRef.current = setTimeout(() => pushNow(), 1500);
      return () => { if (pushTimerRef.current) clearTimeout(pushTimerRef.current); };
    }, [posts, defaults, savedViews, auth.status]);

    // ----- Merge-choice handlers -----
    const acceptCloud = () => {
      if (!mergeChoice) return;
      const d = mergeChoice.cloudData;
      const cloudPosts = Array.isArray(d.posts) ? d.posts : [];
      setPosts(cloudPosts.map(migratePost));
      if (d.defaults) setDefaults(d.defaults);
      if (Array.isArray(d.saved_views)) setSavedViews(d.saved_views);
      pullDoneRef.current = true;
      setMergeChoice(null);
      setSyncStatus({ state: 'synced', lastAt: Date.now(), error: null });
    };
    const acceptLocal = () => {
      pullDoneRef.current = true;
      setMergeChoice(null);
      pushNow();
    };

    // ----- Auth actions -----
    const startSignIn = async () => {
      if (!supa) { alert('Sync not available.'); return; }
      const email = (authEmail || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAuthMsg('Enter a valid email address.'); return; }
      setAuthMsg('Sending magic link…');
      const { error } = await supa.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      });
      if (error) { setAuthMsg('Error: ' + error.message); return; }
      setAuthMsg('Magic link sent to ' + email + '. Open the email on this device and click the link.');
    };
    const doSignOut = async () => {
      if (!confirm('Sign out? Your data stays on this device. Sign in again to sync across devices.')) return;
      try { await supa.auth.signOut(); } catch (e) { console.warn(e); }
      setShowAuth(false);
    };
    const manualSync = async () => {
      if (auth.status !== 'signedIn') return;
      if (pushTimerRef.current) { clearTimeout(pushTimerRef.current); pushTimerRef.current = null; }
      await pushNow();
    };



    // ----- First-load seed (only if no posts yet) -----
    useEffect(() => {
      if (posts.length > 0) return;
      setLoading(true);
      fetch('seed.json')
        .then(r => r.json())
        .then(seed => {
          const cleaned = seed.map(migratePost);
          setPosts(cleaned);
          setLoading(false);
        })
        .catch(err => {
          console.error('seed load failed', err);
          setLoading(false);
        });
    }, []);

    // ----- Derived data -----
    const dupMap = useMemo(() => {
      const m = {};
      for (const p of posts) {
        const k = p.category + '|' + normTitle(p.title);
        m[k] = (m[k] || 0) + 1;
      }
      return m;
    }, [posts]);

    const filtered = useMemo(() => {
      const q = (search || '').trim().toLowerCase();
      let out = posts.filter(p => {
        if (filters.status !== 'all' && (p.status || 'draft') !== filters.status) return false;
        if (filters.category !== 'all' && p.category !== filters.category) return false;
        const f = p.formats || {};
        if (filters.format === 'image' && !f.image) return false;
        if (filters.format === 'reels' && !f.reels) return false;
        if (filters.format === 'both' && !(f.image && f.reels)) return false;
        if (filters.format === 'none' && (f.image || f.reels)) return false;
        const d = p.destinations || {};
        if (filters.destination === 'page' && !d.page) return false;
        if (filters.destination === 'group' && !d.group) return false;
        if (filters.destination === 'both' && !(d.page && d.group)) return false;
        if (filters.destination === 'none' && (d.page || d.group)) return false;
        if (filters.dupOnly) {
          const k = p.category + '|' + normTitle(p.title);
          if ((dupMap[k] || 0) < 2) return false;
        }
        if (q) {
          const hay = (p.title + ' ' + (p.category || '') + ' ' + (p.source || '')).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      const idOrder = (p) => parseInt(String(p.id).replace(/[^0-9]/g, ''), 10) || 0;
      if (sortBy === 'date_desc') out.sort((a, b) => idOrder(b) - idOrder(a));
      else if (sortBy === 'date_asc') out.sort((a, b) => idOrder(a) - idOrder(b));
      else if (sortBy === 'category') out.sort((a, b) => a.category.localeCompare(b.category) || idOrder(b) - idOrder(a));
      else if (sortBy === 'status') out.sort((a, b) => (a.status || 'draft').localeCompare(b.status || 'draft') || idOrder(b) - idOrder(a));
      else if (sortBy === 'source') out.sort((a, b) => (a.source || '').localeCompare(b.source || '') || idOrder(b) - idOrder(a));
      return out;
    }, [posts, filters, search, sortBy, dupMap]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const safePage = Math.min(page, totalPages - 1);
    const start = safePage * pageSize;
    const visible = filtered.slice(start, start + pageSize);

    const stats = useMemo(() => {
      const total = posts.length;
      const drafts = posts.filter(p => (p.status || 'draft') === 'draft').length;
      const scheduled = posts.filter(p => (p.status || 'draft') === 'scheduled').length;
      const published = posts.filter(p => (p.status || 'draft') === 'published').length;
      const rejected = posts.filter(p => (p.status || 'draft') === 'rejected').length;
      const images = posts.filter(p => (p.formats || {}).image).length;
      const reelsCount = posts.filter(p => (p.formats || {}).reels).length;
      const pageCount = posts.filter(p => (p.destinations || {}).page).length;
      const groupCount = posts.filter(p => (p.destinations || {}).group).length;
      return [
        { label: 'Total',     value: total,       unit: 'posts',  color: '#0d2340' },
        { label: 'Drafts',    value: drafts,      unit: 'todo',   color: '#5a6470' },
        { label: 'Scheduled', value: scheduled,   unit: 'queue',  color: '#9a6d1f' },
        { label: 'Published', value: published,   unit: 'live',   color: '#2d7a4a' },
        { label: 'Rejected',  value: rejected,    unit: 'cut',    color: '#c44545' },
        { label: 'Image',     value: images,      unit: 'static', color: '#4a6fa5' },
        { label: 'Reels',     value: reelsCount,  unit: 'video',  color: '#7a3fbf' },
        { label: 'For Page',  value: pageCount,   unit: 'fb pg',  color: '#1f5cc7' },
        { label: 'For Group', value: groupCount,  unit: 'fb gp',  color: '#c97a3f' },
      ];
    }, [posts]);

    const selectedIds = useMemo(() => Object.keys(selected).filter(k => selected[k]), [selected]);

    // ----- Mutations -----
    const updatePost = useCallback((id, patch) => {
      setPosts(curr => curr.map(p => p.id === id ? { ...p, ...patch } : p));
    }, []);

    const removePost = useCallback((id) => {
      if (!confirm('Delete this post?')) return;
      setPosts(curr => curr.filter(p => p.id !== id));
      setSelected(s => { const c = { ...s }; delete c[id]; return c; });
    }, []);

    const bulkUpdate = useCallback((patchFn) => {
      const ids = Object.keys(selected).filter(k => selected[k]);
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      setPosts(curr => curr.map(p => idSet.has(p.id) ? patchFn(p) : p));
    }, [selected]);

    const bulkDelete = useCallback(() => {
      const ids = Object.keys(selected).filter(k => selected[k]);
      if (ids.length === 0) return;
      if (!confirm(`Delete ${ids.length} post${ids.length === 1 ? '' : 's'}?`)) return;
      const idSet = new Set(ids);
      setPosts(curr => curr.filter(p => !idSet.has(p.id)));
      setSelected({});
    }, [selected]);

    const toggleSelectAll = useCallback(() => {
      const all = visible.every(p => selected[p.id]);
      setSelected(s => {
        const c = { ...s };
        if (all) visible.forEach(p => delete c[p.id]);
        else visible.forEach(p => { c[p.id] = true; });
        return c;
      });
    }, [visible, selected]);

    const resetFilters = useCallback(() => {
      setFilters({ status: 'all', category: 'all', format: 'all', destination: 'all', dupOnly: false });
      setSearch('');
      setSortBy('date_desc');
      setPage(0);
    }, []);

    // ----- Pick-a-draft -----
    const randomDraftId = useCallback((source) => {
      const pool = source || posts;
      const list = pool.filter(p => {
        if ((p.status || 'draft') !== 'draft') return false;
        if (filters.category !== 'all' && p.category !== filters.category) return false;
        const f = p.formats || {};
        if (filters.format === 'image' && !f.image) return false;
        if (filters.format === 'reels' && !f.reels) return false;
        if (filters.format === 'both' && !(f.image && f.reels)) return false;
        if (filters.format === 'none' && (f.image || f.reels)) return false;
        return true;
      });
      if (list.length === 0) return null;
      return list[Math.floor(Math.random() * list.length)].id;
    }, [posts, filters]);

    const openPick = () => { setPickId(randomDraftId()); setModal('pick'); };

    const pickPost = useMemo(() => posts.find(p => p.id === pickId) || null, [posts, pickId]);

    const pickAct = (status) => {
      if (!pickId) return;
      setPosts(curr => {
        const updated = curr.map(p => p.id === pickId ? { ...p, status } : p);
        const next = randomDraftId(updated);
        setPickId(next);
        return updated;
      });
    };
    const pickSkip = () => setPickId(randomDraftId());

    // ----- New post -----
    const defaultsToForm = (cat, prev) => {
      const d = defaults[cat] || {};
      const formats = d.formats || (d.format ? { image: d.format === 'image', reels: d.format === 'reels' } : null);
      return {
        ...(prev || {}),
        category: cat,
        image: formats ? !!formats.image : (prev ? prev.image : true),
        reels: formats ? !!formats.reels : (prev ? prev.reels : false),
        page:  d.page  !== undefined ? !!d.page  : (prev ? prev.page  : true),
        group: d.group !== undefined ? !!d.group : (prev ? prev.group : false),
      };
    };
    const openNew = () => {
      const seeded = defaultsToForm('3points', { category: '3points', title: '', image: true, reels: false, page: true, group: false });
      setNewForm({ ...seeded, title: '' });
      setModal('new');
      setTimeout(() => { const el = document.getElementById('ct_new_title'); if (el) el.focus(); }, 30);
    };
    const submitNew = () => {
      const t = (newForm.title || '').trim();
      if (!t) { alert('Title is required.'); return; }
      const post = {
        id: uid(),
        category: newForm.category,
        title: t,
        formats: { image: !!newForm.image, reels: !!newForm.reels },
        destinations: { page: !!newForm.page, group: !!newForm.group },
        status: 'draft',
        source: 'manual',
      };
      setPosts(curr => [post, ...curr]);
      setModal(null);
    };

    // ----- Saved views -----
    const saveView = () => {
      const name = (viewName || '').trim();
      if (!name) { alert('Name is required.'); return; }
      const v = { id: 'v_' + Date.now(), name, filters: { ...filters }, search, sortBy };
      setSavedViews(curr => [...curr, v]);
      setViewName('');
      setModal(null);
    };
    const applyView = (id) => {
      const v = savedViews.find(x => x.id === id);
      if (!v) return;
      setFilters({ ...v.filters });
      setSearch(v.search || '');
      setSortBy(v.sortBy || 'date_desc');
      setPage(0);
    };
    const removeView = (id) => {
      if (!confirm('Delete this view?')) return;
      setSavedViews(curr => curr.filter(v => v.id !== id));
    };

    // ----- Defaults -----
    const setDefault = (cat, patch) => {
      setDefaults(curr => ({ ...curr, [cat]: { ...(curr[cat] || { formats: { image: true, reels: false }, page: true, group: false }), ...patch } }));
    };
    const applyDefaultsToDrafts = () => {
      let count = 0;
      const next = posts.map(p => {
        if ((p.status || 'draft') !== 'draft') return p;
        const d = defaults[p.category];
        if (!d) return p;
        count++;
        const formats = d.formats || (d.format ? { image: d.format === 'image', reels: d.format === 'reels' } : (p.formats || { image: true, reels: false }));
        return {
          ...p,
          formats: { image: !!formats.image, reels: !!formats.reels },
          destinations: { page: !!d.page, group: !!d.group },
        };
      });
      if (count === 0) { alert('No drafts matched any category with defaults set.'); return; }
      if (!confirm(`Apply defaults to ${count} draft${count === 1 ? '' : 's'}? Formats and destinations will be overwritten.`)) return;
      setPosts(next);
    };

    // ----- Merge duplicates (manual) -----
    const mergeDupesManual = () => {
      const res = mergeDuplicates(posts);
      if (res.removed === 0) { alert('No duplicates to merge.'); return; }
      if (!confirm(`Merge ${res.mergedGroups} duplicate group${res.mergedGroups === 1 ? '' : 's'} (${res.removed} row${res.removed === 1 ? '' : 's'} will be removed)?\n\nFormats and destinations will be OR-merged. Status keeps the most progressed one.`)) return;
      setPosts(res.posts);
    };

    // ----- CSV / JSON export ----
    const exportCsv = () => {
      const rows = filtered;
      const header = ['#', 'Category', 'Title', 'Image', 'Reels', 'Page', 'Group', 'Status', 'Source'];
      const lines = [header.join(',')];
      rows.forEach((p, i) => {
        const d = p.destinations || {};
        const f = p.formats || {};
        lines.push([
          String(i + 1),
          csvEscape(p.category),
          csvEscape(p.title),
          f.image ? 'yes' : 'no',
          f.reels ? 'yes' : 'no',
          d.page ? 'yes' : 'no',
          d.group ? 'yes' : 'no',
          csvEscape(p.status || 'draft'),
          csvEscape(p.source || ''),
        ].join(','));
      });
      const csv = '\uFEFF' + lines.join('\r\n');
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'psicon-tracker-' + new Date().toISOString().slice(0, 10) + '.csv');
    };

    const exportJson = () => {
      const payload = { kind: 'psicon-content-tracker-backup', version: 1, exportedAt: new Date().toISOString(), posts, defaults, savedViews };
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'psicon-tracker-backup-' + new Date().toISOString().slice(0, 10) + '.json');
    };

    const handleImportJsonFile = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          const postsIn = Array.isArray(parsed) ? parsed : (parsed.posts || []);
          if (!Array.isArray(postsIn) || postsIn.length === 0) { alert('Backup is empty or invalid.'); return; }
          const cleaned = postsIn.map(migratePost);
          if (!confirm(`Restore ${cleaned.length} posts from this backup?\n\nThis REPLACES your current ${posts.length} posts. Export a backup first if you're not sure.`)) return;
          setPosts(cleaned);
          if (parsed && parsed.defaults) setDefaults(parsed.defaults);
          if (parsed && Array.isArray(parsed.savedViews)) setSavedViews(parsed.savedViews);
          setSelected({}); setPage(0);
          localStorage.setItem(SEED_FLAG_KEY, '1');
          alert('Restored ' + cleaned.length + ' posts.');
        } catch (err) {
          console.error(err); alert('Could not read this file.\n\n' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    };

    // ----- .md import -----
    const openImportMd = () => { setMdPreview(null); setModal('importMd'); };

    const readMdFiles = (fileList) => {
      const files = Array.from(fileList).filter(f => /\.(md|txt|markdown)$/i.test(f.name));
      if (files.length === 0) { alert('No .md or .txt files found.'); return; }
      Promise.all(files.map(f => f.text().then(text => ({ name: f.name, text })))).then(payload => {
        const parsed = parseMdFiles(payload);
        // Compute how many would be new
        const existingKeys = new Set(posts.map(p => p.category + '|' + normTitle(p.title)));
        const newOnes = parsed.filter(p => !existingKeys.has(p.category + '|' + normTitle(p.title)));
        const byCategory = {};
        parsed.forEach(p => { byCategory[p.category] = (byCategory[p.category] || 0) + 1; });
        setMdPreview({
          files: files.map(f => f.name),
          parsed,
          newCount: newOnes.length,
          totalParsed: parsed.length,
          byCategory,
        });
      });
    };

    const confirmImportMd = () => {
      if (!mdPreview) return;
      const existingKeys = new Set(posts.map(p => p.category + '|' + normTitle(p.title)));
      const additions = mdPreview.parsed.filter(p => !existingKeys.has(p.category + '|' + normTitle(p.title)));
      if (additions.length === 0) { alert('All of these posts already exist in your tracker.'); return; }
      const now = Date.now();
      const newPosts = additions.map((s, i) => {
        const d = defaults[s.category] || {};
        const formats = d.formats || (d.format ? { image: d.format === 'image', reels: d.format === 'reels' } : { image: s.format === 'image', reels: s.format === 'reels' });
        return {
          id: 'p_md_' + now + '_' + i,
          category: s.category,
          title: s.title,
          formats: { image: !!formats.image, reels: !!formats.reels },
          destinations: { page: !!d.page, group: !!d.group },
          status: 'draft',
          source: s.source,
        };
      });
      setPosts(curr => [...newPosts, ...curr]);
      setModal(null);
      setMdPreview(null);
      alert(`Imported ${newPosts.length} new posts.`);
    };

    // ----- Keyboard shortcuts -----
    useEffect(() => {
      const handler = (e) => {
        const t = e.target;
        const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (e.key === 'Escape') {
          if (inField) { t.blur(); return; }
          if (modal) { setModal(null); return; }
          if (search) { setSearch(''); setPage(0); return; }
          return;
        }
        if (inField) return;
        if (e.key === '/') { e.preventDefault(); const el = document.getElementById('ct_search'); if (el) el.focus(); return; }
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openNew(); return; }
        if (e.key === 'p' || e.key === 'P') { e.preventDefault(); openPick(); return; }
        if (e.key === '?') { e.preventDefault(); setModal(m => m === 'help' ? null : 'help'); return; }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [modal, search]);

    // ----- Render -----
    return html`
      ${PickModal({ open: modal === 'pick', post: pickPost, close: () => setModal(null), publish: () => pickAct('published'), schedule: () => pickAct('scheduled'), reject: () => pickAct('rejected'), skip: pickSkip, toggleImage: () => updatePost(pickId, { formats: { ...(pickPost && pickPost.formats || {}), image: !((pickPost && pickPost.formats || {}).image) } }), toggleReels: () => updatePost(pickId, { formats: { ...(pickPost && pickPost.formats || {}), reels: !((pickPost && pickPost.formats || {}).reels) } }), togglePage: () => updatePost(pickId, { destinations: { ...(pickPost && pickPost.destinations || {}), page: !((pickPost && pickPost.destinations || {}).page) } }), toggleGroup: () => updatePost(pickId, { destinations: { ...(pickPost && pickPost.destinations || {}), group: !((pickPost && pickPost.destinations || {}).group) } }), resetAndPick: () => { resetFilters(); setTimeout(() => setPickId(randomDraftId()), 50); }, draftCount: posts.filter(p => (p.status || 'draft') === 'draft').length })}
      ${AuthModal({ open: showAuth, close: () => { setShowAuth(false); setAuthMsg(''); }, auth, syncStatus, email: authEmail, setEmail: setAuthEmail, msg: authMsg, signIn: startSignIn, signOut: doSignOut, manualSync })}
      ${MergeChoiceModal({ open: !!mergeChoice, choice: mergeChoice, acceptCloud, acceptLocal })}
      ${NewModal({ open: modal === 'new', close: () => setModal(null), form: newForm, setForm: setNewForm, submit: submitNew, defaultsToForm })}
      ${DefaultsModal({ open: modal === 'defaults', close: () => setModal(null), defaults, setDefault, applyToDrafts: applyDefaultsToDrafts })}
      ${SaveViewModal({ open: modal === 'saveView', close: () => setModal(null), name: viewName, setName: setViewName, submit: saveView })}
      ${HelpModal({ open: modal === 'help', close: () => setModal(null) })}
      ${ImportMdModal({ open: modal === 'importMd', close: () => { setModal(null); setMdPreview(null); }, preview: mdPreview, onFiles: readMdFiles, confirm: confirmImportMd, dragActive, setDragActive })}

      <div class="ct_app" style="min-height: 100vh; padding: 28px 32px 80px; max-width: 1640px; margin: 0 auto;">

        <!-- Header -->
        <div class="ct_topbar" style="display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 22px; padding-bottom: 18px; border-bottom: 1px solid #dde4ef;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
              <div style="width: 10px; height: 10px; background: #e8b04a; border-radius: 2px;"></div>
              <div style="font-size: 11px; font-weight: 600; letter-spacing: 0.14em; color: #4a6fa5; text-transform: uppercase;">PsiCon · Content plan</div>
            </div>
            <h1 class="ct_h1" style="margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: #0d2340;">Posts tracker</h1>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <button onClick=${openPick} title="Pick a draft (P)" style="display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; background: #e8b04a; color: #0d2340; border: 1px solid #d39a31; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; letter-spacing: 0.03em;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>
              <span class="ct_btn_label">Pick a draft</span>
            </button>
            <button onClick=${openImportMd} title="Import posts from .md files" style="display: inline-flex; align-items: center; gap: 7px; padding: 9px 12px; background: #fff; color: #0d2340; border: 1px solid #dde4ef; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span class="ct_btn_label">Import .md</span>
            </button>
            <button onClick=${mergeDupesManual} title="Merge duplicate posts" style="display: inline-flex; align-items: center; gap: 7px; padding: 9px 12px; background: #fff; color: #0d2340; border: 1px solid #dde4ef; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M9 12h6"/><path d="M12 9v6"/></svg>
              <span class="ct_btn_label">Merge dupes</span>
            </button>
            <button onClick=${() => setModal('defaults')} title="Per-category defaults" style="display: inline-flex; align-items: center; gap: 7px; padding: 9px 12px; background: #fff; color: #0d2340; border: 1px solid #dde4ef; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <span class="ct_btn_label">Defaults</span>
            </button>
            <button onClick=${exportCsv} title="Export current view as CSV" style="display: inline-flex; align-items: center; gap: 7px; padding: 9px 12px; background: #fff; color: #0d2340; border: 1px solid #dde4ef; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span class="ct_btn_label">CSV</span>
            </button>
            <button onClick=${exportJson} title="Backup everything as JSON" style="display: inline-flex; align-items: center; gap: 7px; padding: 9px 12px; background: #fff; color: #0d2340; border: 1px solid #dde4ef; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="12 18 12 12"/><polyline points="9 15 12 12 15 15"/></svg>
              <span class="ct_btn_label">Backup</span>
            </button>
            <label title="Restore from JSON backup" style="display: inline-flex; align-items: center; gap: 7px; padding: 9px 12px; background: #fff; color: #0d2340; border: 1px solid #dde4ef; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="12 12 12 18"/><polyline points="9 15 12 18 15 15"/></svg>
              <span class="ct_btn_label">Restore</span>
              <input type="file" accept=".json,application/json" onChange=${handleImportJsonFile} style="display: none;" />
            </label>
            <button onClick=${() => setModal('help')} title="Keyboard shortcuts (?)" style="display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; background: #fff; color: #4a6fa5; border: 1px solid #dde4ef; border-radius: 6px; font-size: 13px; font-weight: 700; cursor: pointer;">?</button>
            <button onClick=${() => { setAuthMsg(''); setShowAuth(true); }} title=${auth.status === 'signedIn' ? 'Cloud sync · ' + (auth.user && auth.user.email) : 'Sign in to sync across devices'} style="display: inline-flex; align-items: center; gap: 7px; padding: 9px 12px; background: ${auth.status === 'signedIn' ? (syncStatus.state === 'error' ? '#fdecec' : '#e6f3eb') : '#fff'}; color: ${auth.status === 'signedIn' ? (syncStatus.state === 'error' ? '#c44545' : '#2d7a4a') : '#0d2340'}; border: 1px solid ${auth.status === 'signedIn' ? (syncStatus.state === 'error' ? '#f5c8c8' : '#c5e2d0') : '#dde4ef'}; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
              ${auth.status === 'signedIn'
                ? (syncStatus.state === 'syncing'
                    ? html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>`
                    : (syncStatus.state === 'error'
                      ? html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>`
                      : html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`))
                : html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`}
              <span class="ct_btn_label">${auth.status === 'signedIn' ? (syncStatus.state === 'syncing' ? 'Syncing…' : syncStatus.state === 'error' ? 'Sync error' : 'Synced') : 'Sign in to sync'}</span>
            </button>
            <div style="width: 1px; height: 28px; background: #dde4ef; margin: 0 4px;"></div>
            <button onClick=${openNew} title="New post (N)" style="display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: #0d2340; color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">
              <span style="font-size: 16px; line-height: 1;">+</span> <span class="ct_btn_label">New post</span>
            </button>
          </div>
        </div>

        <!-- Stats -->
        <div class="ct_stats" style="display: grid; grid-template-columns: repeat(9, 1fr); gap: 1px; background: #dde4ef; border: 1px solid #dde4ef; border-radius: 8px; overflow: hidden; margin-bottom: 22px;">
          ${stats.map(s => html`
            <div style="background: #fff; padding: 14px 16px;">
              <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #7a8db0; text-transform: uppercase; margin-bottom: 6px;">${s.label}</div>
              <div style="display: flex; align-items: baseline; gap: 6px;">
                <div class="ct_stat_val" style="font-size: 22px; font-weight: 700; color: ${s.color}; font-variant-numeric: tabular-nums; letter-spacing: -0.02em;">${s.value}</div>
                <div style="font-size: 11px; color: #9bb3d4;">${s.unit}</div>
              </div>
            </div>
          `)}
        </div>

        <!-- Saved views -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; padding: 0 4px;">
          <span style="font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #7a8db0; text-transform: uppercase; margin-right: 4px;">Views</span>
          ${savedViews.map(v => html`
            <div style="display: inline-flex; align-items: center; background: #fff; border: 1px solid #dde4ef; border-radius: 14px; overflow: hidden;">
              <button onClick=${() => applyView(v.id)} style="padding: 4px 10px 4px 12px; font-size: 11px; font-weight: 600; color: #0d2340; background: transparent; border: none; cursor: pointer;">${v.name}</button>
              <button onClick=${() => removeView(v.id)} title="Delete view" style="padding: 4px 8px; font-size: 11px; color: #9bb3d4; background: transparent; border: none; border-left: 1px solid #eef2f8; cursor: pointer;">×</button>
            </div>
          `)}
          <button onClick=${() => { setViewName(''); setModal('saveView'); setTimeout(() => { const el = document.getElementById('ct_view_name'); if (el) el.focus(); }, 30); }} style="display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; font-size: 11px; font-weight: 600; color: #4a6fa5; background: transparent; border: 1px dashed #c8d2e3; border-radius: 14px; cursor: pointer;">+ Save current</button>
        </div>

        <!-- Filter bar -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 12px; background: #fff; border: 1px solid #dde4ef; border-radius: 8px 8px 0 0; border-bottom: none;">
          <div style="display: flex; align-items: center; gap: 6px; padding-right: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4a6fa5" stroke-width="2.2"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
            <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.1em; color: #4a6fa5; text-transform: uppercase;">Filter</span>
          </div>

          <select value=${filters.status} onChange=${e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(0); }} style="padding: 6px 10px; font-size: 12px; font-weight: 500; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px;">
            <option value="all">All status</option><option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="published">Published</option><option value="rejected">Rejected</option>
          </select>
          <select value=${filters.category} onChange=${e => { setFilters(f => ({ ...f, category: e.target.value })); setPage(0); }} style="padding: 6px 10px; font-size: 12px; font-weight: 500; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px;">
            <option value="all">All categories</option>
            ${CATEGORIES.map(c => html`<option value=${c}>${c}</option>`)}
          </select>
          <select value=${filters.format} onChange=${e => { setFilters(f => ({ ...f, format: e.target.value })); setPage(0); }} style="padding: 6px 10px; font-size: 12px; font-weight: 500; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px;">
            <option value="all">All formats</option><option value="image">Image</option><option value="reels">Reels</option><option value="both">Image + Reels</option><option value="none">No format set</option>
          </select>
          <select value=${filters.destination} onChange=${e => { setFilters(f => ({ ...f, destination: e.target.value })); setPage(0); }} style="padding: 6px 10px; font-size: 12px; font-weight: 500; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px;">
            <option value="all">All destinations</option><option value="page">For FB Page</option><option value="group">For FB Group</option><option value="both">For both</option><option value="none">No destination</option>
          </select>
          <label style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 11px; font-weight: 600; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px; cursor: pointer;">
            <input type="checkbox" checked=${filters.dupOnly} onChange=${e => { setFilters(f => ({ ...f, dupOnly: e.target.checked })); setPage(0); }} style="cursor: pointer; width: 13px; height: 13px; accent-color: #c2682a;" />
            Duplicates only
          </label>

          <div style="position: relative; flex: 1; min-width: 220px; max-width: 380px; margin-left: 6px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9bb3d4" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); pointer-events: none;"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input id="ct_search" type="text" value=${search} onInput=${e => { setSearch(e.target.value); setPage(0); }} placeholder="Search titles, source… (press /)" style="width: 100%; padding: 7px 30px 7px 30px; font-size: 12px; font-weight: 500; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px;"/>
            ${search ? html`<button onClick=${() => { setSearch(''); setPage(0); }} title="Clear search" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; color: #7a8db0; background: transparent; border: none; border-radius: 3px; cursor: pointer; line-height: 1;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : null}
          </div>

          <span style="font-size: 11px; font-weight: 600; letter-spacing: 0.1em; color: #4a6fa5; text-transform: uppercase;">Sort</span>
          <select value=${sortBy} onChange=${e => { setSortBy(e.target.value); setPage(0); }} style="padding: 6px 10px; font-size: 12px; font-weight: 500; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px;">
            <option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="category">By category</option><option value="status">By status</option><option value="source">By source file</option>
          </select>
          <button onClick=${resetFilters} style="padding: 6px 10px; font-size: 11px; font-weight: 600; color: #4a6fa5; background: transparent; border: 1px solid #dde4ef; border-radius: 5px; cursor: pointer;">Clear filters</button>
        </div>

        ${selectedIds.length > 0 ? html`
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 14px; background: #0d2340; color: #fff; border-left: 1px solid #0d2340; border-right: 1px solid #0d2340;">
            <div style="font-size: 12px; font-weight: 600;"><span style="color: #e8b04a;">${selectedIds.length}</span> selected</div>
            <div style="height: 16px; width: 1px; background: #4a6fa5;"></div>
            <button onClick=${() => bulkUpdate(p => ({ ...p, status: 'published' }))} style="padding: 5px 12px; font-size: 11px; font-weight: 700; color: #0d2340; background: #7dd3a4; border: none; border-radius: 4px; cursor: pointer; letter-spacing: 0.04em;">MARK PUBLISHED</button>
            <button onClick=${() => bulkUpdate(p => ({ ...p, status: 'scheduled' }))} style="padding: 5px 12px; font-size: 11px; font-weight: 700; color: #0d2340; background: #e8b04a; border: none; border-radius: 4px; cursor: pointer; letter-spacing: 0.04em;">MARK SCHEDULED</button>
            <button onClick=${() => bulkUpdate(p => ({ ...p, status: 'rejected' }))} style="padding: 5px 12px; font-size: 11px; font-weight: 700; color: #fff; background: #c44545; border: none; border-radius: 4px; cursor: pointer; letter-spacing: 0.04em;">MARK REJECTED</button>
            <button onClick=${() => bulkUpdate(p => ({ ...p, status: 'draft' }))} style="padding: 5px 12px; font-size: 11px; font-weight: 600; color: #fff; background: transparent; border: 1px solid #4a6fa5; border-radius: 4px; cursor: pointer; letter-spacing: 0.04em;">MARK DRAFT</button>
            <div style="height: 16px; width: 1px; background: #4a6fa5;"></div>
            <button onClick=${() => bulkUpdate(p => ({ ...p, destinations: { ...(p.destinations || {}), page: true } }))} style="padding: 5px 10px; font-size: 11px; font-weight: 600; color: #fff; background: transparent; border: 1px solid #4a6fa5; border-radius: 4px; cursor: pointer; letter-spacing: 0.04em;">+ Page</button>
            <button onClick=${() => bulkUpdate(p => ({ ...p, destinations: { ...(p.destinations || {}), group: true } }))} style="padding: 5px 10px; font-size: 11px; font-weight: 600; color: #fff; background: transparent; border: 1px solid #4a6fa5; border-radius: 4px; cursor: pointer; letter-spacing: 0.04em;">+ Group</button>
            <button onClick=${() => bulkUpdate(p => ({ ...p, formats: { ...(p.formats || {}), image: true } }))} style="padding: 5px 10px; font-size: 11px; font-weight: 600; color: #fff; background: transparent; border: 1px solid #4a6fa5; border-radius: 4px; cursor: pointer; letter-spacing: 0.04em;">+ Image</button>
            <button onClick=${() => bulkUpdate(p => ({ ...p, formats: { ...(p.formats || {}), reels: true } }))} style="padding: 5px 10px; font-size: 11px; font-weight: 600; color: #fff; background: transparent; border: 1px solid #4a6fa5; border-radius: 4px; cursor: pointer; letter-spacing: 0.04em;">+ Reels</button>
            <div style="height: 16px; width: 1px; background: #4a6fa5;"></div>
            <button onClick=${bulkDelete} style="padding: 5px 12px; font-size: 11px; font-weight: 600; color: #ff9a9a; background: transparent; border: 1px solid #5c2a3a; border-radius: 4px; cursor: pointer; letter-spacing: 0.04em;">DELETE</button>
            <div style="flex: 1;"></div>
            <button onClick=${() => setSelected({})} style="padding: 5px 10px; font-size: 11px; font-weight: 500; color: #9bb3d4; background: transparent; border: none; cursor: pointer;">Clear</button>
          </div>
        ` : null}

        <!-- Table -->
        <div style="background: #fff; border: 1px solid #dde4ef; border-radius: 0 0 8px 8px; overflow: hidden;">
          <div class="ct_table_header" style="display: grid; grid-template-columns: 44px 56px 150px minmax(280px, 480px) 110px 150px 220px 50px 1fr; align-items: center; padding: 0 4px; background: #f4f6fa; border-bottom: 1px solid #dde4ef; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #4a6fa5; text-transform: uppercase; height: 38px;">
            <div style="display: flex; justify-content: center;">
              <input type="checkbox" checked=${visible.length  > 0 && visible.every(p => selected[p.id])} onChange=${toggleSelectAll} style="cursor: pointer; width: 14px; height: 14px; accent-color: #0d2340;" />
            </div>
            <div style="padding: 0 8px;">#</div>
            <div style="padding: 0 12px;">Category</div>
            <div style="padding: 0 12px;">Title</div>
            <div style="padding: 0 12px;">Format</div>
            <div style="padding: 0 12px;">Destinations</div>
            <div style="padding: 0 12px;">Status</div>
            <div></div>
          </div>

          ${loading ? html`<div style="padding: 60px 20px; text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #4a6fa5; letter-spacing: 0.1em; text-transform: uppercase;">Loading posts…</div>` : null}

          ${!loading && filtered.length === 0 ? html`
            <div style="padding: 60px 20px; text-align: center;">
              <div style="font-size: 13px; color: #7a8db0; margin-bottom: 14px;">No posts match these filters.</div>
              <button onClick=${resetFilters} style="padding: 7px 14px; font-size: 12px; font-weight: 600; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px; cursor: pointer;">Clear filters</button>
            </div>
          ` : null}

          ${visible.map((p, i) => Row({ p, index: start + i, dupMap, selected, setSelected, updatePost, removePost }))}
        </div>

        <div class="ct_footer" style="display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 14px; padding: 0 4px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #4a6fa5; letter-spacing: 0.08em; text-transform: uppercase;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="color: #9bb3d4;">Showing</span>
            <span style="color: #0d2340; font-weight: 600;">${filtered.length === 0 ? 0 : start + 1}–${start + visible.length}</span>
            <span style="color: #9bb3d4;">of ${filtered.length}</span>
            <span style="color: #cfd9ea;">·</span>
            <span style="color: #9bb3d4;">${posts.length} total</span>
            <span style="color: #cfd9ea;">·</span>
            <span style="color: #9bb3d4;">${posts.length === 0 ? 0 : Math.round((stats[3].value / posts.length) * 100)}% published</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="color: #9bb3d4;">Rows</span>
            <select value=${pageSize} onChange=${e => { setPageSize(parseInt(e.target.value, 10) || 100); setPage(0); }} style="padding: 5px 8px; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; color: #0d2340; background: #fff; border: 1px solid #dde4ef; border-radius: 4px; cursor: pointer; letter-spacing: 0.06em;">
              <option value="50">50</option><option value="100">100</option><option value="250">250</option><option value="500">500</option>
            </select>
            <div style="width: 1px; height: 18px; background: #dde4ef; margin: 0 4px;"></div>
            <button onClick=${() => setPage(p => Math.max(0, p - 1))} disabled=${safePage <= 0} style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 26px; padding: 0; font-family: inherit; color: #0d2340; background: #fff; border: 1px solid #dde4ef; border-radius: 4px; cursor: pointer;">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 1.5L3 5l3.5 3.5"/></svg>
            </button>
            <span style="color: #0d2340; font-weight: 600; min-width: 56px; text-align: center;">${safePage + 1} / ${totalPages}</span>
            <button onClick=${() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled=${safePage >= totalPages - 1} style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 26px; padding: 0; font-family: inherit; color: #0d2340; background: #fff; border: 1px solid #dde4ef; border-radius: 4px; cursor: pointer;">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 1.5L7 5l-3.5 3.5"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ---------------- Row component ----------------
  function Row({ p, index, dupMap, selected, setSelected, updatePost, removePost }) {
    const cat = catColor(p.category);
    const isSel = !!selected[p.id];
    const f = p.formats || {};
    const d = p.destinations || {};
    const status = p.status || 'draft';
    const dupKey = p.category + '|' + normTitle(p.title);
    const dupCount = dupMap[dupKey] || 1;
    const isDup = dupCount > 1;

    const stCls = (st) => ({
      fg: status === st ? (st === 'rejected' ? '#fff' : (st === 'draft' ? '#fff' : '#0d2340')) : '#7a8db0',
      bg: status === st ? ({ draft: '#5a6470', scheduled: '#e8b04a', published: '#7dd3a4', rejected: '#c44545' }[st]) : 'transparent',
    });
    const sDraft = stCls('draft'), sSched = stCls('scheduled'), sPub = stCls('published'), sRej = stCls('rejected');

    const titleRef = useRef(null);
    const onBlur = (e) => {
      const t = e.currentTarget.textContent.trim();
      if (t !== p.title) updatePost(p.id, { title: t });
    };

    return html`
      <div class=${'row ct_row ' + (isSel ? 'selected' : '')} style="display: grid; grid-template-columns: 44px 56px 150px minmax(280px, 480px) 110px 150px 220px 50px 1fr; align-items: center; padding: 0 4px; border-bottom: 1px solid #eef2f8; min-height: 56px;">
        <div style="display: flex; justify-content: center;">
          <input type="checkbox" checked=${isSel} onChange=${() => setSelected(s => { const c = { ...s }; if (c[p.id]) delete c[p.id]; else c[p.id] = true; return c; })} style="cursor: pointer; width: 14px; height: 14px; accent-color: #0d2340;" />
        </div>
        <div style="padding: 0 8px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #9bb3d4; font-variant-numeric: tabular-nums;">${String(index + 1).padStart(3, '0')}</div>
        <div style="padding: 0 12px;">
          <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; color: ${cat.fg}; background: ${cat.bg}; border: 1px solid ${cat.border}; border-radius: 4px; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.02em;">
            <span style="width: 5px; height: 5px; border-radius: 50%; background: ${cat.fg};"></span>
            ${p.category}
          </div>
        </div>
        <div style="padding: 8px 12px;">
          <div ref=${titleRef} contentEditable onBlur=${onBlur} style="font-size: 13px; color: #0d2340; padding: 4px 6px; border-radius: 4px; cursor: text; min-height: 20px; line-height: 1.35;">${p.title}</div>
          <div style="display: flex; align-items: center; gap: 8px; padding: 2px 6px 0; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #9bb3d4;">
            <span>${p.source || '—'}</span>
            ${isDup ? html`<span style="display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; color: #c2682a; background: #fbeede; border: 1px solid #f2d4b0; border-radius: 3px; font-weight: 700; letter-spacing: 0.06em;">DUP × ${dupCount}</span>` : null}
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; padding: 0 12px;">
          <label style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; font-size: 11px; font-weight: 600; color: ${f.image ? '#0d2340' : '#9aa6b8'}; background: ${f.image ? '#eef2f8' : '#f7f9fc'}; border: 1px solid ${f.image ? '#cfd9ea' : '#e3e8ef'}; border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.04em;">
            <input type="checkbox" checked=${!!f.image} onChange=${() => updatePost(p.id, { formats: { ...f, image: !f.image } })} style="cursor: pointer; width: 12px; height: 12px; accent-color: #0d2340; margin: 0;" />
            IMAGE
          </label>
          <label style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; font-size: 11px; font-weight: 600; color: ${f.reels ? '#7a3fbf' : '#9aa6b8'}; background: ${f.reels ? '#f1eafa' : '#f7f9fc'}; border: 1px solid ${f.reels ? '#dccaf2' : '#e3e8ef'}; border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.04em;">
            <input type="checkbox" checked=${!!f.reels} onChange=${() => updatePost(p.id, { formats: { ...f, reels: !f.reels } })} style="cursor: pointer; width: 12px; height: 12px; accent-color: #7a3fbf; margin: 0;" />
            REELS
          </label>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; padding: 0 12px;">
          <label style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; font-size: 11px; font-weight: 600; color: ${d.page ? '#1f5cc7' : '#9aa6b8'}; background: ${d.page ? '#e8f0fc' : '#f7f9fc'}; border: 1px solid ${d.page ? '#c8dcf7' : '#e3e8ef'}; border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.04em;">
            <input type="checkbox" checked=${!!d.page} onChange=${() => updatePost(p.id, { destinations: { ...d, page: !d.page } })} style="cursor: pointer; width: 12px; height: 12px; accent-color: #1f5cc7; margin: 0;" />
            FB Page
          </label>
          <label style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; font-size: 11px; font-weight: 600; color: ${d.group ? '#9a6d1f' : '#9aa6b8'}; background: ${d.group ? '#fbf1d8' : '#f7f9fc'}; border: 1px solid ${d.group ? '#f1dba0' : '#e3e8ef'}; border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.04em;">
            <input type="checkbox" checked=${!!d.group} onChange=${() => updatePost(p.id, { destinations: { ...d, group: !d.group } })} style="cursor: pointer; width: 12px; height: 12px; accent-color: #c97a3f; margin: 0;" />
            FB Group
          </label>
        </div>
        <div style="padding: 0 8px;">
          <div style="display: inline-flex; padding: 2px; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px; gap: 1px;">
            <button onClick=${() => updatePost(p.id, { status: 'draft' })} style="padding: 4px 8px; font-size: 10px; font-weight: 700; color: ${sDraft.fg}; background: ${sDraft.bg}; border: none; border-radius: 3px; cursor: pointer; letter-spacing: 0.05em; font-family: 'JetBrains Mono', monospace;">DRAFT</button>
            <button onClick=${() => updatePost(p.id, { status: 'scheduled' })} style="padding: 4px 8px; font-size: 10px; font-weight: 700; color: ${sSched.fg}; background: ${sSched.bg}; border: none; border-radius: 3px; cursor: pointer; letter-spacing: 0.05em; font-family: 'JetBrains Mono', monospace;">SCHED</button>
            <button onClick=${() => updatePost(p.id, { status: 'published' })} style="padding: 4px 8px; font-size: 10px; font-weight: 700; color: ${sPub.fg}; background: ${sPub.bg}; border: none; border-radius: 3px; cursor: pointer; letter-spacing: 0.05em; font-family: 'JetBrains Mono', monospace;">PUB</button>
            <button onClick=${() => updatePost(p.id, { status: 'rejected' })} style="padding: 4px 8px; font-size: 10px; font-weight: 700; color: ${sRej.fg}; background: ${sRej.bg}; border: none; border-radius: 3px; cursor: pointer; letter-spacing: 0.05em; font-family: 'JetBrains Mono', monospace;">REJ</button>
          </div>
        </div>
        <div style="display: flex; justify-content: center;">
          <button onClick=${() => removePost(p.id)} title="Delete post" style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; color: #9bb3d4; background: transparent; border: none; border-radius: 4px; cursor: pointer;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </div>
        <div></div>
      </div>
    `;
  }

  // ---------------- Modals ----------------
  function ModalShell({ open, close, title, children, maxWidth }) {
    if (!open) return null;
    return html`
      <div class="ct_backdrop" onClick=${close} style="position: fixed; inset: 0; background: rgba(13, 35, 64, 0.55); z-index: 50; display: flex; align-items: center; justify-content: center; padding: 24px;">
        <div class="ct_modal" onClick=${e => e.stopPropagation()} style="width: 100%; max-width: ${maxWidth || 520}px; max-height: 90vh; display: flex; flex-direction: column; background: #fff; border-radius: 10px; box-shadow: 0 20px 50px rgba(13, 35, 64, 0.3); overflow: hidden;">
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: #0d2340; color: #fff;">
            <div style="font-size: 13px; font-weight: 700; letter-spacing: 0.04em;">${title}</div>
            <button onClick=${close} style="display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; color: #9bb3d4; background: transparent; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">✕</button>
          </div>
          <div style="overflow: auto;">${children}</div>
        </div>
      </div>
    `;
  }

  function PickModal({ open, post, close, publish, schedule, reject, skip, toggleImage, toggleReels, togglePage, toggleGroup, resetAndPick, draftCount }) {
    if (!open) return null;
    return ModalShell({ open, close, maxWidth: 640, title: html`PICK A DRAFT <span style="color: #9bb3d4; font-family: 'JetBrains Mono', monospace; font-weight: 400; margin-left: 8px;">${draftCount} drafts</span>`, children: !post ? html`
      <div style="padding: 50px 28px; text-align: center;">
        <div style="font-size: 28px; margin-bottom: 12px;">🎉</div>
        <div style="font-size: 15px; font-weight: 600; color: #0d2340; margin-bottom: 6px;">No drafts in current scope.</div>
        <div style="font-size: 12px; color: #7a8db0; margin-bottom: 22px;">Either everything is published / rejected, or your filters are too narrow.</div>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button onClick=${close} style="padding: 9px 16px; font-size: 12px; font-weight: 600; color: #4a6fa5; background: #fff; border: 1px solid #dde4ef; border-radius: 6px; cursor: pointer;">Close</button>
          <button onClick=${resetAndPick} style="padding: 9px 16px; font-size: 12px; font-weight: 600; color: #fff; background: #0d2340; border: none; border-radius: 6px; cursor: pointer;">Clear filters &amp; retry</button>
        </div>
      </div>
    ` : (() => {
      const c = catColor(post.category);
      const f = post.formats || {}, d = post.destinations || {};
      return html`
        <div style="padding: 28px 28px 8px;">
          <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; color: ${c.fg}; background: ${c.bg}; border: 1px solid ${c.border}; border-radius: 4px; font-family: 'JetBrains Mono', monospace; margin-bottom: 14px;">
            <span style="width: 5px; height: 5px; border-radius: 50%; background: ${c.fg};"></span>
            ${post.category}
          </div>
          <div style="font-size: 22px; font-weight: 600; color: #0d2340; line-height: 1.3; letter-spacing: -0.01em; margin-bottom: 12px;">${post.title}</div>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #9bb3d4; letter-spacing: 0.04em; margin-bottom: 24px;">${post.source || '—'}</div>
          <div style="display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 8px;">
            <div>
              <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #7a8db0; text-transform: uppercase; margin-bottom: 6px;">Format</div>
              <div style="display: flex; gap: 8px;">
                <label style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: ${f.image ? '#0d2340' : '#9aa6b8'}; background: ${f.image ? '#eef2f8' : '#f7f9fc'}; border: 1px solid ${f.image ? '#cfd9ea' : '#e3e8ef'}; border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                  <input type="checkbox" checked=${!!f.image} onChange=${toggleImage} style="width: 13px; height: 13px; accent-color: #0d2340; margin: 0;" />
                  IMAGE
                </label>
                <label style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: ${f.reels ? '#7a3fbf' : '#9aa6b8'}; background: ${f.reels ? '#f1eafa' : '#f7f9fc'}; border: 1px solid ${f.reels ? '#dccaf2' : '#e3e8ef'}; border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                  <input type="checkbox" checked=${!!f.reels} onChange=${toggleReels} style="width: 13px; height: 13px; accent-color: #7a3fbf; margin: 0;" />
                  REELS
                </label>
              </div>
            </div>
            <div>
              <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #7a8db0; text-transform: uppercase; margin-bottom: 6px;">Destinations</div>
              <div style="display: flex; gap: 8px;">
                <label style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: ${d.page ? '#1f5cc7' : '#9aa6b8'}; background: ${d.page ? '#e8f0fc' : '#f7f9fc'}; border: 1px solid ${d.page ? '#c8dcf7' : '#e3e8ef'}; border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                  <input type="checkbox" checked=${!!d.page} onChange=${togglePage} style="width: 13px; height: 13px; accent-color: #1f5cc7; margin: 0;" />
                  FB Page
                </label>
                <label style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: ${d.group ? '#9a6d1f' : '#9aa6b8'}; background: ${d.group ? '#fbf1d8' : '#f7f9fc'}; border: 1px solid ${d.group ? '#f1dba0' : '#e3e8ef'}; border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                  <input type="checkbox" checked=${!!d.group} onChange=${toggleGroup} style="width: 13px; height: 13px; accent-color: #c97a3f; margin: 0;" />
                  FB Group
                </label>
              </div>
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 24px 22px; flex-wrap: wrap;">
          <button onClick=${skip} style="padding: 9px 14px; font-size: 12px; font-weight: 600; color: #4a6fa5; background: #fff; border: 1px solid #dde4ef; border-radius: 6px; cursor: pointer;">Skip · pick another</button>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button onClick=${reject} style="padding: 9px 14px; font-size: 12px; font-weight: 700; color: #fff; background: #c44545; border: 1px solid #a83838; border-radius: 6px; cursor: pointer; letter-spacing: 0.04em;">REJECT</button>
            <button onClick=${schedule} style="padding: 9px 14px; font-size: 12px; font-weight: 700; color: #0d2340; background: #e8b04a; border: 1px solid #d39a31; border-radius: 6px; cursor: pointer; letter-spacing: 0.04em;">SCHEDULE</button>
            <button onClick=${publish} style="padding: 9px 14px; font-size: 12px; font-weight: 700; color: #0d2340; background: #7dd3a4; border: 1px solid #4cb280; border-radius: 6px; cursor: pointer; letter-spacing: 0.04em;">PUBLISH</button>
          </div>
        </div>
      `;
    })() });
  }

  function NewModal({ open, close, form, setForm, submit, defaultsToForm }) {
    if (!open) return null;
    return ModalShell({ open, close, title: '+ NEW POST', maxWidth: 520, children: html`
      <div style="padding: 22px 24px; display: flex; flex-direction: column; gap: 16px;">
        <div>
          <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #7a8db0; text-transform: uppercase; margin-bottom: 6px;">Category</div>
          <select value=${form.category} onChange=${e => setForm(defaultsToForm(e.target.value, form))} style="width: 100%; padding: 8px 10px; font-size: 13px; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px;">
            ${CATEGORIES.map(c => html`<option value=${c}>${c}</option>`)}
          </select>
        </div>
        <div>
          <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #7a8db0; text-transform: uppercase; margin-bottom: 6px;">Title</div>
          <input id="ct_new_title" type="text" value=${form.title} onInput=${e => setForm({ ...form, title: e.target.value })} placeholder="Type the post title…" style="width: 100%; padding: 8px 10px; font-size: 13px; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px;" />
        </div>
        <div style="display: flex; gap: 24px; flex-wrap: wrap;">
          <div>
            <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #7a8db0; text-transform: uppercase; margin-bottom: 6px;">Format</div>
            <div style="display: flex; gap: 8px;">
              <label style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                <input type="checkbox" checked=${form.image} onChange=${e => setForm({ ...form, image: e.target.checked })} style="width: 13px; height: 13px; accent-color: #0d2340; margin: 0;" />
                IMAGE
              </label>
              <label style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                <input type="checkbox" checked=${form.reels} onChange=${e => setForm({ ...form, reels: e.target.checked })} style="width: 13px; height: 13px; accent-color: #7a3fbf; margin: 0;" />
                REELS
              </label>
            </div>
          </div>
          <div>
            <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #7a8db0; text-transform: uppercase; margin-bottom: 6px;">Destinations</div>
            <div style="display: flex; gap: 8px;">
              <label style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                <input type="checkbox" checked=${form.page} onChange=${e => setForm({ ...form, page: e.target.checked })} style="width: 13px; height: 13px; accent-color: #1f5cc7; margin: 0;" />
                FB Page
              </label>
              <label style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                <input type="checkbox" checked=${form.group} onChange=${e => setForm({ ...form, group: e.target.checked })} style="width: 13px; height: 13px; accent-color: #c97a3f; margin: 0;" />
                FB Group
              </label>
            </div>
          </div>
        </div>
      </div>
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 14px 24px 18px; border-top: 1px solid #eef2f8;">
        <button onClick=${close} style="padding: 8px 14px; font-size: 12px; font-weight: 600; color: #4a6fa5; background: transparent; border: 1px solid #dde4ef; border-radius: 5px; cursor: pointer;">Cancel</button>
        <button onClick=${submit} style="padding: 8px 18px; font-size: 12px; font-weight: 700; color: #fff; background: #0d2340; border: none; border-radius: 5px; cursor: pointer; letter-spacing: 0.03em;">Create post</button>
      </div>
    ` });
  }

  function DefaultsModal({ open, close, defaults, setDefault, applyToDrafts }) {
    if (!open) return null;
    return ModalShell({ open, close, maxWidth: 720, title: 'DEFAULTS', children: html`
      <div style="padding: 12px 24px 4px; font-size: 11px; color: #7a8db0;">Pick the typical format + destinations per category. Apply to all drafts in one click. Saves automatically.</div>
      <div style="padding: 4px 24px 16px;">
        <div style="display: grid; grid-template-columns: 140px 130px 1fr; align-items: center; padding: 0 8px; height: 32px; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #7a8db0; text-transform: uppercase; border-bottom: 1px solid #eef2f8;">
          <div>Category</div><div>Format</div><div>Destinations</div>
        </div>
        ${CATEGORIES.map(cat => {
          const raw = defaults[cat] || {};
          const f = raw.formats || (raw.format ? { image: raw.format === 'image', reels: raw.format === 'reels' } : { image: true, reels: false });
          const c = catColor(cat);
          return html`
            <div style="display: grid; grid-template-columns: 140px 130px 1fr; align-items: center; padding: 10px 8px; border-bottom: 1px solid #f4f6fa;">
              <div>
                <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; color: ${c.fg}; background: ${c.bg}; border: 1px solid ${c.border}; border-radius: 4px; font-family: 'JetBrains Mono', monospace;">
                  <span style="width: 5px; height: 5px; border-radius: 50%; background: ${c.fg};"></span>${cat}
                </div>
              </div>
              <div style="display: flex; gap: 10px;">
                <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #0d2340; cursor: pointer;">
                  <input type="checkbox" checked=${!!f.image} onChange=${e => setDefault(cat, { formats: { image: e.target.checked, reels: !!f.reels } })} style="width: 13px; height: 13px; accent-color: #0d2340; margin: 0;" >
                  Image
                </label>
                <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #0d2340; cursor: pointer;">
                  <input type="checkbox" checked=${!!f.reels} onChange=${e => setDefault(cat, { formats: { image: !!f.image, reels: e.target.checked } })} style="width: 13px; height: 13px; accent-color: #7a3fbf; margin: 0;" >
                  Reels
                </label>
              </div>
              <div style="display: flex; gap: 10px;">
                <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #0d2340; cursor: pointer;">
                  <input type="checkbox" checked=${!!raw.page} onChange=${e => setDefault(cat, { page: e.target.checked })} style="width: 13px; height: 13px; accent-color: #1f5cc7; margin: 0;" >
                  Page
                </label>
                <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #0d2340; cursor: pointer;">
                  <input type="checkbox" checked=${!!raw.group} onChange=${e => setDefault(cat, { group: e.target.checked })} style="width: 13px; height: 13px; accent-color: #c97a3f; margin: 0;" >
                  Group
                </label>
              </div>
            </div>
          `;
        })}
      </div>
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 14px 24px 18px; border-top: 1px solid #eef2f8;">
        <button onClick=${close} style="padding: 8px 14px; font-size: 12px; font-weight: 600; color: #4a6fa5; background: transparent; border: 1px solid #dde4ef; border-radius: 5px; cursor: pointer;">Close</button>
        <button onClick=${applyToDrafts} style="padding: 8px 18px; font-size: 12px; font-weight: 700; color: #fff; background: #0d2340; border: none; border-radius: 5px; cursor: pointer; letter-spacing: 0.03em;">Apply to all drafts</button>
      </div>
    ` });
  }

  function SaveViewModal({ open, close, name, setName, submit }) {
    if (!open) return null;
    return ModalShell({ open, close, title: 'SAVE CURRENT VIEW', maxWidth: 420, children: html`
      <div style="padding: 22px 24px;">
        <div style="font-size: 12px; color: #7a8db0; margin-bottom: 12px;">Saves the current filters, search, and sort under a name.</div>
        <input id="ct_view_name" type="text" value=${name} onInput=${e => setName(e.target.value)} placeholder="View name (e.g. 'Reels drafts for Page')" style="width: 100%; padding: 9px 12px; font-size: 13px; font-weight: 500; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px; margin-bottom: 16px;" />
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button onClick=${close} style="padding: 8px 14px; font-size: 12px; font-weight: 600; color: #4a6fa5; background: transparent; border: 1px solid #dde4ef; border-radius: 5px; cursor: pointer;">Cancel</button>
          <button onClick=${submit} style="padding: 8px 18px; font-size: 12px; font-weight: 700; color: #fff; background: #0d2340; border: none; border-radius: 5px; cursor: pointer; letter-spacing: 0.03em;">Save view</button>
        </div>
      </div>
    ` });
  }

  function HelpModal({ open, close }) {
    if (!open) return null;
    const shortcuts = [
      { key: '/', label: 'Focus the search box' },
      { key: 'N', label: 'Open the new-post dialog' },
      { key: 'P', label: 'Pick a random draft to review' },
      { key: '?', label: 'Toggle this shortcut list' },
      { key: 'Esc', label: 'Close any open dialog · clear focus · clear search' },
    ];
    return ModalShell({ open, close, title: 'KEYBOARD SHORTCUTS', maxWidth: 520, children: html`
      <div style="padding: 18px 24px 24px;">
        ${shortcuts.map(s => html`
          <div style="display: grid; grid-template-columns: 90px 1fr; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f4f6fa;">
            <kbd style="display: inline-flex; align-items: center; justify-content: center; padding: 3px 8px; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-bottom-width: 2px; border-radius: 4px; min-width: 38px;">${s.key}</kbd>
            <div style="font-size: 12px; color: #0d2340;">${s.label}</div>
          </div>
        `)}
      </div>
    ` });
  }

  function ImportMdModal({ open, close, preview, onFiles, confirm, dragActive, setDragActive }) {
    if (!open) return null;
    const handleDrop = (e) => {
      e.preventDefault(); setDragActive(false);
      if (e.dataTransfer && e.dataTransfer.files) onFiles(e.dataTransfer.files);
    };
    const handleSelect = (e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ''; };
    return ModalShell({ open, close, title: 'IMPORT .MD FILES', maxWidth: 640, children: html`
      <div style="padding: 22px 24px;">
        <div style="font-size: 12px; color: #7a8db0; margin-bottom: 12px;">Expected format: blocks delimited by <code>::: type</code> / <code>title: …</code> / <code>:::</code>. Filename hints determine format (reels → Reels, image-posts → Image).</div>
        <label
          onDragOver=${e => { e.preventDefault(); setDragActive(true); }}
          onDragLeave=${e => { e.preventDefault(); setDragActive(false); }}
          onDrop=${handleDrop}
          class=${dragActive ? 'dropzone-active' : ''}
          style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px; text-align: center; background: #fafbfd; border: 2px dashed #dde4ef; border-radius: 8px; cursor: pointer; transition: background 0.15s, border-color 0.15s;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4a6fa5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 10px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div style="font-size: 13px; font-weight: 600; color: #0d2340;">Drop .md files here, or click to pick</div>
          <div style="font-size: 11px; color: #9bb3d4; margin-top: 4px;">.md · .txt · .markdown · multiple files OK</div>
          <input type="file" multiple accept=".md,.txt,.markdown" onChange=${handleSelect} style="display: none;" />
        </label>

        ${preview ? html`
          <div style="margin-top: 18px; padding: 14px 16px; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 6px;">
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #4a6fa5; text-transform: uppercase; margin-bottom: 8px;">Preview</div>
            <div style="font-size: 12px; color: #0d2340; margin-bottom: 8px;"><strong>${preview.totalParsed}</strong> posts parsed from <strong>${preview.files.length}</strong> file${preview.files.length === 1 ? '' : 's'} — <strong style="color: #2d7a4a;">${preview.newCount}</strong> new, <strong style="color: #7a8db0;">${preview.totalParsed - preview.newCount}</strong> already in your tracker.</div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              ${Object.entries(preview.byCategory).map(([c, n]) => {
                const col = catColor(c);
                return html`<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; color: ${col.fg}; background: ${col.bg}; border: 1px solid ${col.border}; border-radius: 3px;"><span style="width: 4px; height: 4px; border-radius: 50%; background: ${col.fg};"></span>${c} · ${n}</span>`;
              })}
            </div>
          </div>
        ` : null}
      </div>
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 14px 24px 18px; border-top: 1px solid #eef2f8;">
        <button onClick=${close} style="padding: 8px 14px; font-size: 12px; font-weight: 600; color: #4a6fa5; background: transparent; border: 1px solid #dde4ef; border-radius: 5px; cursor: pointer;">Cancel</button>
        <button onClick=${confirm} disabled=${!preview || preview.newCount === 0} style="padding: 8px 18px; font-size: 12px; font-weight: 700; color: #fff; background: ${preview && preview.newCount > 0 ? '#0d2340' : '#9aa6b8'}; border: none; border-radius: 5px; cursor: ${preview && preview.newCount > 0 ? 'pointer' : 'not-allowed'}; letter-spacing: 0.03em;">${preview ? 'Import ' + preview.newCount + ' new post' + (preview.newCount === 1 ? '' : 's') : 'Pick files first'}</button>
      </div>
    ` });
  }

  // ---------------- Sync modals ----------------
  function AuthModal({ open, close, auth, syncStatus, email, setEmail, msg, signIn, signOut, manualSync }) {
    if (!open) return null;
    return ModalShell({ open, close, title: 'CLOUD SYNC', maxWidth: 480, children: html`
      <div style="padding: 22px 24px;">
        ${auth.status === 'signedIn' ? html`
          <div style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #f0f9f3; border: 1px solid #c5e2d0; border-radius: 6px; margin-bottom: 16px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2d7a4a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            <div style="flex: 1;">
              <div style="font-size: 13px; font-weight: 600; color: #0d2340;">Signed in</div>
              <div style="font-size: 11px; color: #4a6fa5; font-family: 'JetBrains Mono', monospace;">${auth.user.email || auth.user.id}</div>
            </div>
          </div>
          <div style="padding: 12px 14px; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 6px; margin-bottom: 16px;">
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #4a6fa5; text-transform: uppercase; margin-bottom: 6px;">Sync status</div>
            <div style="font-size: 12px; color: #0d2340;">
              ${syncStatus.state === 'syncing' ? 'Syncing now…'
                : syncStatus.state === 'synced' ? ('Last synced ' + (syncStatus.lastAt ? new Date(syncStatus.lastAt).toLocaleTimeString() : 'just now') + '. Your changes auto-save to the cloud.')
                : syncStatus.state === 'error' ? html`<span style="color: #c44545;">Sync error:</span> ${syncStatus.error || 'unknown'}`
                : 'Waiting…'}
            </div>
          </div>
          <div style="display: flex; gap: 8px; justify-content: space-between;">
            <button onClick=${manualSync} style="padding: 8px 14px; font-size: 12px; font-weight: 600; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px; cursor: pointer;">Sync now</button>
            <button onClick=${signOut} style="padding: 8px 14px; font-size: 12px; font-weight: 600; color: #c44545; background: transparent; border: 1px solid #f5c8c8; border-radius: 5px; cursor: pointer;">Sign out</button>
          </div>
          <div style="font-size: 11px; color: #7a8db0; margin-top: 14px; line-height: 1.5;">Your data syncs to a private Supabase project keyed by your email. To use on another device, install the PWA there and sign in with the same email.</div>
        ` : html`
          <div style="font-size: 13px; color: #0d2340; line-height: 1.55; margin-bottom: 16px;">Sign in with your email to sync your tracker across devices. We'll send a one-click magic link — no password needed.</div>
          <label style="display: block; margin-bottom: 14px;">
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #4a6fa5; text-transform: uppercase; margin-bottom: 6px;">Your email</div>
            <input type="email" value=${email} onInput=${e => setEmail(e.target.value)} placeholder="you@example.com" autoFocus style="width: 100%; padding: 9px 12px; font-size: 13px; color: #0d2340; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 5px;" />
          </label>
          ${msg ? html`<div style="font-size: 12px; color: ${msg.startsWith('Error') ? '#c44545' : '#2d7a4a'}; background: ${msg.startsWith('Error') ? '#fdecec' : '#f0f9f3'}; border: 1px solid ${msg.startsWith('Error') ? '#f5c8c8' : '#c5e2d0'}; padding: 10px 12px; border-radius: 5px; margin-bottom: 14px; line-height: 1.5;">${msg}</div>` : null}
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button onClick=${close} style="padding: 9px 14px; font-size: 12px; font-weight: 600; color: #4a6fa5; background: transparent; border: 1px solid #dde4ef; border-radius: 5px; cursor: pointer;">Cancel</button>
            <button onClick=${signIn} style="padding: 9px 18px; font-size: 12px; font-weight: 700; color: #fff; background: #0d2340; border: none; border-radius: 5px; cursor: pointer; letter-spacing: 0.03em;">Send magic link</button>
          </div>
          <div style="font-size: 11px; color: #7a8db0; margin-top: 14px; line-height: 1.5;">Without sync, your data still saves locally on this device. You can also use Backup / Restore to move data manually.</div>
        `}
      </div>
    ` });
  }

  function MergeChoiceModal({ open, choice, acceptCloud, acceptLocal }) {
    if (!open || !choice) return null;
    return html`
      <div class="ct_backdrop" style="position: fixed; inset: 0; background: rgba(13, 35, 64, 0.7); z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px;">
        <div class="ct_modal" style="width: 100%; max-width: 560px; background: #fff; border-radius: 10px; box-shadow: 0 20px 50px rgba(13, 35, 64, 0.4); overflow: hidden;">
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: #c2682a; color: #fff;">
            <div style="font-size: 13px; font-weight: 700; letter-spacing: 0.04em;">⚠ MERGE CONFLICT</div>
          </div>
          <div style="padding: 22px 24px;">
            <div style="font-size: 13px; color: #0d2340; line-height: 1.55; margin-bottom: 18px;">Both this device and the cloud have tracker data. Pick which one to keep — the other will be overwritten. <strong>This can't be undone.</strong> Use Backup first if you're not sure.</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px;">
              <div style="padding: 16px; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 6px;">
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #4a6fa5; text-transform: uppercase; margin-bottom: 8px;">On this device</div>
                <div style="font-size: 22px; font-weight: 700; color: #0d2340; margin-bottom: 4px;">${choice.local.posts}</div>
                <div style="font-size: 11px; color: #7a8db0;">posts</div>
              </div>
              <div style="padding: 16px; background: #f4f6fa; border: 1px solid #dde4ef; border-radius: 6px;">
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: #4a6fa5; text-transform: uppercase; margin-bottom: 8px;">In the cloud</div>
                <div style="font-size: 22px; font-weight: 700; color: #0d2340; margin-bottom: 4px;">${choice.cloud.posts}</div>
                <div style="font-size: 11px; color: #7a8db0;">posts · saved ${choice.cloud.updatedAt ? new Date(choice.cloud.updatedAt).toLocaleString() : 'unknown'}</div>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <button onClick=${acceptLocal} style="padding: 12px; font-size: 12px; font-weight: 700; color: #fff; background: #0d2340; border: none; border-radius: 6px; cursor: pointer; letter-spacing: 0.04em;">USE THIS DEVICE'S DATA</button>
              <button onClick=${acceptCloud} style="padding: 12px; font-size: 12px; font-weight: 700; color: #fff; background: #2d7a4a; border: none; border-radius: 6px; cursor: pointer; letter-spacing: 0.04em;">USE CLOUD DATA</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ---------------- Misc ----------------
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------- Mount ----------------
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('root');
    root.innerHTML = '';
    render(h(App, null), root);
  });
  if (document.readyState !== 'loading') {
    const root = document.getElementById('root');
    if (root) {
      root.innerHTML = '';
      render(h(App, null), root);
    }
  }
})();
