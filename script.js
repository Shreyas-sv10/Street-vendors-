/* ==========================================================
   script.js — StreetVendor Marketplace (frontend demo)
   Features:
   - Role-based login (customer/vendor)
   - Demo data population
   - Multi-vendor catalogs, products, favorites
   - Cart, checkout, schedule orders
   - Vendor order management (accept/complete)
   - Geolocation & proximity notifications
   - localStorage persistence
   ========================================================== */

(function () {
  'use strict';

  /* -------------------------
     Utility & Data Utilities
     ------------------------- */

  const STORAGE_KEY = 'sv_data_v1';
  const SETTINGS_KEY = 'sv_settings_v1';
  const DEMO_FLAG = 'sv_demo_loaded';
  const DEFAULT_RADIUS_KM = 1.0;

  function nowIso() {
    return new Date().toISOString();
  }

  function uid(prefix = '') {
    return prefix + Math.random().toString(36).slice(2, 9);
  }

  // Haversine distance in kilometers between two lat/lng points
  function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371; // Earth radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function parseLatLng(input) {
    if (!input) return null;
    const parts = String(input).split(',').map((s) => s.trim());
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
  }

  /* -------------------------
     Default App State Model
     ------------------------- */

  let state = {
    users: {}, // userId -> { id, name, phone, role, category? }
    currentUserId: null,
    vendors: {}, // vendorId -> { id, userId, name, category, location:{lat,lng}, active, products: [productId], orders: [orderId], meta }
    products: {}, // productId -> { id, vendorId, name, price, desc, img }
    orders: {}, // orderId -> { id, customerId, vendorId, items: [{productId, qty}], schedule: ISO/null, status: pending/accepted/completed/cancelled, createdAt, meta }
    favorites: {}, // userId -> Set(vendorId)
    recentActivity: [], // array strings
  };

  let settings = {
    proximityRadiusKm: DEFAULT_RADIUS_KM,
    notificationMode: 'popup', // 'popup' or 'browser'
  };

  /* -------------------------
     Storage Functions
     ------------------------- */

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // shallow merge so we keep new shape compatibility
        state = Object.assign(state, parsed);
      }
    } catch (e) {
      console.warn('Failed to load state', e);
    }

    try {
      const rawS = localStorage.getItem(SETTINGS_KEY);
      if (rawS) Object.assign(settings, JSON.parse(rawS));
    } catch (e) {}
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save state', e);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
  }

  /* -------------------------
     Demo Data Loader
     ------------------------- */

  function loadDemoData() {
    if (localStorage.getItem(DEMO_FLAG)) {
      console.log('Demo already loaded');
      return;
    }

    // Clear existing state for a clean demo experience
    state = {
      users: {},
      currentUserId: null,
      vendors: {},
      products: {},
      orders: {},
      favorites: {},
      recentActivity: [],
    };

    // Create demo users
    const custId = uid('u_');
    state.users[custId] = {
      id: custId,
      name: 'Demo Customer',
      phone: '9999999999',
      role: 'customer',
    };

    const v1 = createVendor(
      'Fresh Samosas',
      'food',
      { lat: 12.307, lng: 76.652 },
      true,
      'Samosa vendor serving hot snacks'
    );
    const v2 = createVendor(
      'Fruit Stall',
      'fruits',
      { lat: 12.309, lng: 76.655 },
      true,
      'Seasonal fruits & juices'
    );
    const v3 = createVendor(
      'Cloth Corner',
      'clothes',
      { lat: 12.303, lng: 76.648 },
      false,
      'Handmade clothing'
    );

    addProductToVendor(v1.id, {
      name: 'Samosa',
      price: 20,
      desc: 'Crispy potato samosa',
      img: '',
    });
    addProductToVendor(v1.id, {
      name: 'Tea',
      price: 12,
      desc: 'Hot masala tea',
      img: '',
    });

    addProductToVendor(v2.id, {
      name: 'Banana (dozen)',
      price: 60,
      desc: 'Fresh bananas',
    });
    addProductToVendor(v2.id, {
      name: 'Orange Juice',
      price: 40,
      desc: 'Freshly squeezed',
    });

    addProductToVendor(v3.id, {
      name: 'T-Shirt',
      price: 299,
      desc: 'Cotton t-shirt, medium',
    });

    // set a default customer for quicker login selection
    state.currentUserId = custId;

    localStorage.setItem(DEMO_FLAG, '1');
    saveState();
    addActivity('Loaded demo data');
    ui.showToast('Demo data loaded — try "Quick Demo" login or browse vendors', 3500);
  }

  /* -------------------------
     Data Model Helpers
     ------------------------- */

  function createVendor(name, category = 'food', location = null, active = false, meta = '') {
    const userId = uid('u_');
    state.users[userId] = {
      id: userId,
      name,
      phone: 'demo-' + userId,
      role: 'vendor',
      category,
    };

    const vendorId = uid('v_');
    state.vendors[vendorId] = {
      id: vendorId,
      userId,
      name,
      category,
      location: location || null,
      active: !!active,
      products: [],
      orders: [],
      meta,
    };
    saveState();
    return state.vendors[vendorId];
  }

  function addProductToVendor(vendorId, { name, price, desc = '', img = '' }) {
    const pid = uid('p_');
    state.products[pid] = {
      id: pid,
      vendorId,
      name,
      price: Number(price) || 0,
      desc,
      img: img || '',
    };
    state.vendors[vendorId].products.push(pid);
    saveState();
    return state.products[pid];
  }

  function addUserIfNotExists(name, phone, role = 'customer', category = '') {
    // if phone exists, return that user
    for (const id in state.users) {
      if (state.users[id].phone === phone) return state.users[id];
    }
    const id = uid('u_');
    state.users[id] = { id, name, phone, role, category };
    saveState();
    return state.users[id];
  }

  function addActivity(text) {
    state.recentActivity = state.recentActivity || [];
    state.recentActivity.unshift(`${new Date().toLocaleString()}: ${text}`);
    if (state.recentActivity.length > 50) state.recentActivity.pop();
    saveState();
    ui.renderActivity();
  }

  /* -------------------------
     Orders & Cart
     ------------------------- */

  // A simple cart model per customer (kept in memory while page open)
  const cart = {
    customerId: null,
    items: [], // [{productId, vendorId, qty}]
  };

  function cartAdd(productId, qty = 1) {
    const product = state.products[productId];
    if (!product) return false;
    // if cart contains items from other vendor, allow but note vendor separation
    const existing = cart.items.find((it) => it.productId === productId);
    if (existing) {
      existing.qty += qty;
    } else {
      cart.items.push({ productId, vendorId: product.vendorId, qty });
    }
    ui.renderCart();
    addActivity(`Added to cart: ${product.name}`);
    return true;
  }

  function cartRemove(productId) {
    cart.items = cart.items.filter((it) => it.productId !== productId);
    ui.renderCart();
    saveState();
  }

  function cartClear() {
    cart.items = [];
    ui.renderCart();
  }

  function cartSummary() {
    let subtotal = 0,
      count = 0;
    for (const it of cart.items) {
      const prod = state.products[it.productId];
      if (!prod) continue;
      subtotal += prod.price * it.qty;
      count += it.qty;
    }
    return { subtotal, count };
  }

  // Place order: immediate or scheduled
  function placeOrder(customerId, scheduleIso = null, contactName = '', contactPhone = '') {
    if (!customerId) return { ok: false, msg: 'Customer not logged in' };
    if (!cart.items.length) return { ok: false, msg: 'Cart is empty' };

    // Group items by vendor — create separate orders per vendor
    const byVendor = {};
    for (const it of cart.items) {
      if (!byVendor[it.vendorId]) byVendor[it.vendorId] = [];
      byVendor[it.vendorId].push({ productId: it.productId, qty: it.qty });
    }

    const createdOrderIds = [];
    for (const vendorId in byVendor) {
      const orderId = uid('o_');
      const order = {
        id: orderId,
        customerId,
        vendorId,
        items: byVendor[vendorId],
        schedule: scheduleIso || null,
        status: 'pending',
        createdAt: nowIso(),
        contactName,
        contactPhone,
      };
      state.orders[orderId] = order;
      state.vendors[vendorId].orders = state.vendors[vendorId].orders || [];
      state.vendors[vendorId].orders.push(orderId);
      createdOrderIds.push(orderId);
      addActivity(`Order placed (#${orderId}) for vendor ${state.vendors[vendorId].name}`);
    }

    saveState();
    cartClear();

    // If scheduled for future, set a timer handler to simulate reminder/processing (demo)
    for (const oid of createdOrderIds) {
      scheduleOrderProcessing(oid);
    }

    ui.renderOrders();
    return { ok: true, ids: createdOrderIds };
  }

  // Process scheduled orders: if schedule time <= now and status pending -> notify vendor & customer
  function scheduleOrderProcessing(orderId) {
    const order = state.orders[orderId];
    if (!order) return;

    if (!order.schedule) {
      // immediate: call notify vendor/customer now
      notifyOrderNew(order);
      return;
    }

    const when = new Date(order.schedule).getTime();
    const now = Date.now();
    const ms = when - now;
    if (ms <= 0) {
      // scheduled time passed -> notify now
      notifyOrderNew(order);
      return;
    }

    // set timeout to trigger at scheduled time (note: will not survive page reload)
    setTimeout(() => {
      // re-check order still pending
      const fresh = state.orders[orderId];
      if (!fresh) return;
      if (fresh.status === 'pending') notifyOrderNew(fresh);
    }, ms + 500);
  }

  function notifyOrderNew(order) {
    // Add to vendor's recent activity and optionally send browser notification
    const vendor = state.vendors[order.vendorId];
    const customer = state.users[order.customerId];
    addActivity(`Order #${order.id} ready for vendor ${vendor.name}`);

    // Show a UI notification for vendor if logged-in vendor is current user
    if (state.currentUserId === vendor.userId) {
      ui.showToast(`New order ${order.id} from ${customer.name}`, 4000);
      ui.renderVendorOrders();
    } else {
      ui.showToast(`Order ${order.id} placed — vendor will be notified`, 3000);
    }

    // Optionally browser notification
    if (settings.notificationMode === 'browser') {
      ui.browserNotify(`New order ${order.id}`, `Customer ${customer.name} scheduled ${order.schedule || 'Now'}`);
    }
  }

  /* -------------------------
     Proximity & Location
     ------------------------- */

  // Periodically check proximity between current customer and active vendors and send notifications
  let proximityInterval = null;
  let lastProxNotified = {}; // vendorId -> timestamp

  function startProximityMonitor() {
    if (proximityInterval) clearInterval(proximityInterval);
    proximityInterval = setInterval(proximityScanOnce, 12 * 1000); // every 12 seconds
    proximityScanOnce(); // run immediately
  }

  async function proximityScanOnce() {
    try {
      if (!state.currentUserId) return;
      const user = state.users[state.currentUserId];
      if (!user || user.role !== 'customer') return; // only customers get vendor proximity notifications

      const customerLoc = ui.getCustomerLocation();
      if (!customerLoc) return;

      const radius = Number(settings.proximityRadiusKm) || DEFAULT_RADIUS_KM;
      for (const vid in state.vendors) {
        const vendor = state.vendors[vid];
        if (!vendor.active || !vendor.location) continue;
        const d = haversineDistanceKm(customerLoc.lat, customerLoc.lng, vendor.location.lat, vendor.location.lng);
        if (d <= radius) {
          const lastTs = lastProxNotified[vid] || 0;
          // only notify once every 2 minutes per vendor to avoid spam
          if (Date.now() - lastTs > 2 * 60 * 1000) {
            lastProxNotified[vid] = Date.now();
            // notify user
            const title = `${vendor.name} is nearby (${d.toFixed(2)} km)`;
            const msg = vendor.meta || `${vendor.category || 'Vendor'} available near you`;
            if (settings.notificationMode === 'browser') {
              ui.browserNotify(title, msg);
            } else {
              ui.showToast(title + ': ' + msg, 5000);
            }
            addActivity(`Proximity: ${vendor.name} within ${d.toFixed(2)} km`);
          }
        }
      }
    } catch (e) {
      console.warn('proximityScan error', e);
    }
  }

  /* -------------------------
     UI Helpers
     ------------------------- */

  const ui = {
    // quick selector
    $: (sel) => document.querySelector(sel),
    $$: (sel) => Array.from(document.querySelectorAll(sel)),

    // Toast message (in-app)
    toastTimer: null,
    showToast(message, timeout = 2500) {
      // small in-app toast: reuse header .muted or create ephemeral element
      const id = 'sv_toast';
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.position = 'fixed';
        el.style.right = '16px';
        el.style.bottom = '16px';
        el.style.background = '#0d47a1';
        el.style.color = 'white';
        el.style.padding = '10px 14px';
        el.style.borderRadius = '8px';
        el.style.boxShadow = '0 3px 10px rgba(0,0,0,0.2)';
        el.style.zIndex = 9999;
        document.body.appendChild(el);
      }
      el.textContent = message;
      el.style.opacity = '1';
      if (ui.toastTimer) clearTimeout(ui.toastTimer);
      ui.toastTimer = setTimeout(() => {
        el.style.opacity = '0';
      }, timeout);
    },

    browserNotify(title, body) {
      if (!('Notification' in window)) {
        ui.showToast(title + ' — ' + body, 4000);
        return;
      }
      if (Notification.permission === 'granted') {
        new Notification(title, { body });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') new Notification(title, { body });
        });
      } else {
        // denied
        ui.showToast(title + ' — ' + body, 3500);
      }
    },

    // modals
    openModal(id) {
      const m = document.getElementById(id);
      if (!m) return;
      m.classList.add('active');
      m.classList.remove('hidden');
    },
    closeModal(id) {
      const m = document.getElementById(id);
      if (!m) return;
      m.classList.remove('active');
      m.classList.add('hidden');
    },

    getCustomerLocation() {
      // priority: saved manual field for current user, or geoloc stored in state.users[userId].loc
      const uid = state.currentUserId;
      if (!uid) return null;
      const user = state.users[uid];
      if (!user) return null;
      if (user._manualLocation) return user._manualLocation;
      if (user._lastKnownLocation) return user._lastKnownLocation;
      return null;
    },

    // update many UI pieces
    renderAll() {
      ui.renderAuthState();
      ui.renderActivity();
      ui.renderVendors();
      ui.renderCart();
      ui.renderOrders();
      ui.renderVendorOrders();
      ui.renderStats();
    },

    renderActivity() {
      const ul = ui.$('#recent-activity');
      if (!ul) return;
      ul.innerHTML = '';
      const items = state.recentActivity || [];
      if (!items.length) {
        ul.innerHTML = '<li class="muted">No recent activity</li>';
        return;
      }
      for (const s of items.slice(0, 12)) {
        const li = document.createElement('li');
        li.textContent = s;
        ul.appendChild(li);
      }
    },

    renderAuthState() {
      // Show/hide panels based on logged in user & role
      const authScreen = ui.$('#auth-screen');
      const home = ui.$('#home-panel');
      const vendorPanel = ui.$('#vendor-panel');
      const customerSummary = ui.$('#customer-summary');
      const vendorSummary = ui.$('#vendor-summary');
      const logoutBtn = ui.$('#btn-logout');
      const profileBtn = ui.$('#btn-profile');
      const welcomeHeading = ui.$('#welcome-heading');
      const welcomeSub = ui.$('#welcome-sub');

      if (!state.currentUserId) {
        // show auth screen
        authScreen && authScreen.classList.remove('hidden');
        home && home.classList.add('hidden');
        vendorPanel && vendorPanel.classList.add('hidden');
        logoutBtn && logoutBtn.classList.add('hidden');
        profileBtn && profileBtn.classList.add('hidden');
      } else {
        authScreen && authScreen.classList.add('hidden');
        home && home.classList.remove('hidden');
        logoutBtn && logoutBtn.classList.remove('hidden');
        profileBtn && profileBtn.classList.remove('hidden');

        const u = state.users[state.currentUserId];
        if (!u) return;
        profileBtn.textContent = (u.name && u.name[0]) || 'U';
        welcomeHeading.textContent = `Hi ${u.name || 'User'} — welcome back!`;
        welcomeSub.textContent =
          u.role === 'vendor'
            ? 'Manage your products and orders from your vendor dashboard.'
            : 'Browse vendors nearby, add to cart, and place or schedule orders.';

        if (u.role === 'vendor') {
          customerSummary && customerSummary.classList.add('hidden');
          vendorSummary && vendorSummary.classList.remove('hidden');
          vendorPanel && vendorPanel.classList.remove('hidden');
        } else {
          vendorSummary && vendorSummary.classList.add('hidden');
          vendorPanel && vendorPanel.classList.add('hidden');
          customerSummary && customerSummary.classList.remove('hidden');
        }
      }
    },

    renderVendors() {
      const container = ui.$('#vendors-container');
      if (!container) return;
      container.innerHTML = '';
      // Collect vendor cards
      const search = (ui.$('#filter-search') && ui.$('#filter-search').value.trim().toLowerCase()) || '';
      const cat = (ui.$('#filter-category') && ui.$('#filter-category').value) || '';
      const radiusFilter = Number((ui.$('#select-radius') && ui.$('#select-radius').value) || settings.proximityRadiusKm) || settings.proximityRadiusKm;
      const customerLoc = ui.getCustomerLocation();

      const vendorEntries = Object.values(state.vendors || {}).sort((a, b) => (a.name > b.name ? 1 : -1));
      if (!vendorEntries.length) container.innerHTML = '<div class="muted">No vendors available. Try loading demo.</div>';

      for (const v of vendorEntries) {
        // filter category
        if (cat && v.category !== cat) continue;
        // search
        if (search) {
          const matchVendor = v.name.toLowerCase().includes(search) || (v.meta && v.meta.toLowerCase().includes(search));
          const matchProduct = (v.products || []).some(pid => {
            const p = state.products[pid];
            if (!p) return false;
            return p.name.toLowerCase().includes(search) || (p.desc && p.desc.toLowerCase().includes(search));
          });
          if (!matchVendor && !matchProduct) continue;
        }

        // distance calculation if customer location available
        let distStr = '—';
        if (customerLoc && v.location) {
          const d = haversineDistanceKm(customerLoc.lat, customerLoc.lng, v.location.lat, v.location.lng);
          distStr = `${d.toFixed(2)} km`;
          if (radiusFilter && d > radiusFilter) continue; // outside radius filter
        }

        // build card
        const tpl = document.getElementById('tpl-vendor-card');
        if (!tpl) continue;
        const node = tpl.content.cloneNode(true);
        const root = node.querySelector('.vendor-card');
        root.dataset.vendorId = v.id;
        root.querySelector('.vendor-name').textContent = v.name;
        root.querySelector('.vendor-meta').textContent = `${v.category || '—'} • ${distStr} ${v.active ? ' • Active' : ' • Inactive'}`;

        // product mini list
        const productsWrap = root.querySelector('.vendor-products');
        (v.products || []).slice(0, 4).forEach((pid) => {
          const p = state.products[pid];
          if (!p) return;
          const pm = document.createElement('div');
          pm.className = 'product-mini';
          pm.innerHTML = `<div class="pm-left"><div class="pm-title">${p.name}</div><div class="muted pm-desc">${p.desc || ''}</div></div>
                          <div class="pm-right"><div class="pm-price">₹${p.price}</div><button class="btn tiny add-to-cart" data-product-id="${p.id}">Add</button></div>`;
          productsWrap.appendChild(pm);
        });

        // attach actions
        const viewBtn = root.querySelector('.view-products');
        viewBtn && viewBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          openVendorModal(v.id, customerLoc);
        });

        const favBtn = root.querySelector('.favorite-toggle');
        const favs = state.favorites[state.currentUserId] || [];
        if (favs && favs.includes && favs.includes(v.id)) {
          favBtn.textContent = '♥';
        } else {
          favBtn.textContent = '♡';
        }
        favBtn && favBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          toggleFavorite(v.id);
          ui.renderVendors();
          ui.renderFavorites();
        });

        // delegate add-to-cart buttons
        productsWrap.querySelectorAll('.add-to-cart').forEach((b) => {
          b.addEventListener('click', (ev) => {
            const pid = b.dataset.productId;
            cartAdd(pid, 1);
          });
        });

        container.appendChild(node);
      }
    },

    renderCart() {
      const el = ui.$('#cart-items');
      if (!el) return;
      if (!cart.items.length) {
        el.innerHTML = '<div class="muted">Cart is empty</div>';
      } else {
        el.innerHTML = '';
        for (const it of cart.items) {
          const p = state.products[it.productId];
          const vendor = state.vendors[it.vendorId];
          const row = document.createElement('div');
          row.className = 'cart-item';
          row.innerHTML = `<div>${p.name} <small class="muted">by ${vendor.name}</small></div><div>₹${p.price} × ${it.qty} <button class="btn tiny remove" data-pid="${p.id}">×</button></div>`;
          el.appendChild(row);
        }
        el.querySelectorAll('.remove').forEach((b) => {
          b.addEventListener('click', (ev) => {
            const pid = b.dataset.pid;
            cartRemove(pid);
          });
        });
      }
      // update stat
      const summary = cartSummary();
      const sCount = ui.$('#stat-cart-count');
      if (sCount) sCount.textContent = String(summary.count || 0);
      const summaryCount = ui.$('#summary-count');
      if (summaryCount) summaryCount.textContent = String(summary.count || 0);
      const subtotalEl = ui.$('#summary-subtotal');
      if (subtotalEl) subtotalEl.textContent = `₹${summary.subtotal || 0}`;
      const totalEl = ui.$('#summary-total');
      if (totalEl) totalEl.textContent = `₹${(summary.subtotal || 0) + 0}`; // delivery 0 for demo
    },

    renderOrders() {
      const list = ui.$('#orders-list');
      if (!list) return;
      list.innerHTML = '';
      const u = state.users[state.currentUserId];
      if (!u) {
        list.innerHTML = '<div class="muted">Log in to see your orders</div>';
        return;
      }

      if (u.role === 'customer') {
        // show customer's orders
        const orders = Object.values(state.orders).filter((o) => o.customerId === u.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        if (!orders.length) {
          list.innerHTML = '<div class="muted">No orders yet</div>';
        } else {
          for (const o of orders) {
            const el = document.createElement('div');
            el.className = 'order-card';
            const vendorName = state.vendors[o.vendorId] ? state.vendors[o.vendorId].name : 'Vendor';
            el.innerHTML = `<h4>Order ${o.id} — ${vendorName}</h4>
              <div class="muted">Placed: ${new Date(o.createdAt).toLocaleString()} • ${o.schedule ? 'Scheduled: ' + new Date(o.schedule).toLocaleString() : 'Immediate'}</div>
              <div>${o.items.map(it => {
                const p = state.products[it.productId];
                return `<div>${p ? p.name : 'Item'} × ${it.qty} — ₹${p ? p.price * it.qty : 0}</div>`;
              }).join('')}</div>
              <div style="margin-top:8px"><span class="order-status ${statusClass(o.status)}">${o.status}</span></div>
              <div style="margin-top:8px"><button class="btn small view-order" data-oid="${o.id}">View</button></div>`;
            list.appendChild(el);
          }
        }
      } else if (u.role === 'vendor') {
        // show vendor's orders
        const vendor = Object.values(state.vendors).find(v => v.userId === u.id);
        if (!vendor) {
          list.innerHTML = '<div class="muted">You are not linked to a vendor. Add vendor profile to manage orders.</div>';
          return;
        }
        const orders = (vendor.orders || []).map(id => state.orders[id]).filter(Boolean).sort((a,b)=>a.createdAt<b.createdAt?1:-1);
        if (!orders.length) {
          list.innerHTML = '<div class="muted">No orders for your stall yet</div>';
        } else {
          for (const o of orders) {
            const el = document.createElement('div');
            el.className = 'order-card';
            const cust = state.users[o.customerId] || { name: 'Customer' };
            el.innerHTML = `<h4>Order ${o.id}</h4>
              <div class="muted">From: ${cust.name} • ${o.contactPhone || ''} • ${o.schedule ? 'Scheduled: ' + new Date(o.schedule).toLocaleString() : 'Immediate'}</div>
              <div style="margin-top:8px">${o.items.map(it => {
                const p = state.products[it.productId];
                return `<div>${p ? p.name : 'Item'} × ${it.qty} — ₹${p ? p.price * it.qty : 0}</div>`;
              }).join('')}</div>
              <div style="margin-top:8px"><span class="order-status ${statusClass(o.status)}">${o.status}</span></div>
              <div style="margin-top:8px">
                ${o.status === 'pending' ? `<button class="btn small accept-order" data-oid="${o.id}">Accept</button>` : ''}
                ${o.status === 'accepted' ? `<button class="btn small complete-order" data-oid="${o.id}">Complete</button>` : ''}
                <button class="btn small view-order" data-oid="${o.id}">View</button>
              </div>`;
            list.appendChild(el);
          }
        }
      }
      // attach action handlers
      list.querySelectorAll('.accept-order').forEach(b => {
        b.addEventListener('click', ev => {
          const oid = b.dataset.oid;
          updateOrderStatus(oid, 'accepted');
        });
      });
      list.querySelectorAll('.complete-order').forEach(b => {
        b.addEventListener('click', ev => {
          const oid = b.dataset.oid;
          updateOrderStatus(oid, 'completed');
        });
      });
      list.querySelectorAll('.view-order').forEach(b => {
        b.addEventListener('click', ev => {
          const oid = b.dataset.oid;
          openOrderModal(oid);
        });
      });
    },

    renderVendorOrders() {
      // vendor orders editing panel
      const ul = ui.$('#vendor-orders-list');
      if (!ul) return;
      ul.innerHTML = '';
      const u = state.users[state.currentUserId];
      if (!u || u.role !== 'vendor') {
        ul.innerHTML = '<div class="muted">Not a vendor</div>';
        return;
      }
      const vendor = Object.values(state.vendors).find(v => v.userId === u.id);
      if (!vendor) {
        ul.innerHTML = '<div class="muted">No vendor profile linked</div>';
        return;
      }
      const orders = (vendor.orders || []).map(id => state.orders[id]).filter(Boolean).sort((a,b)=>a.createdAt<b.createdAt?1:-1);
      if (!orders.length) ul.innerHTML = '<div class="muted">No orders yet</div>';
      for (const o of orders) {
        const div = document.createElement('div');
        div.className = 'order-card';
        const cust = state.users[o.customerId] || {};
        div.innerHTML = `<div><strong>${o.id}</strong> • ${cust.name || 'Customer'} • ${o.status}</div>
          <div class="muted">${o.items.map(it => {
            const p = state.products[it.productId];
            return `${p ? p.name : 'Item'} × ${it.qty}`;
          }).join(', ')}</div>
          <div style="margin-top:6px">
            ${o.status === 'pending' ? `<button class="btn small accept-order" data-oid="${o.id}">Accept</button>` : ''}
            ${o.status === 'accepted' ? `<button class="btn small complete-order" data-oid="${o.id}">Complete</button>` : ''}
          </div>`;
        ul.appendChild(div);
      }
      ul.querySelectorAll('.accept-order').forEach(b => {
        b.addEventListener('click', e => updateOrderStatus(b.dataset.oid, 'accepted'));
      });
      ul.querySelectorAll('.complete-order').forEach(b => {
        b.addEventListener('click', e => updateOrderStatus(b.dataset.oid, 'completed'));
      });
    },

    renderFavorites() {
      const el = ui.$('#favorites-list');
      if (!el) return;
      const favs = state.favorites[state.currentUserId] || [];
      if (!favs || !favs.length) {
        el.innerHTML = '<div class="muted">No favorites yet</div>';
        return;
      }
      el.innerHTML = '';
      for (const vid of favs) {
        const v = state.vendors[vid];
        if (!v) continue;
        const div = document.createElement('div');
        div.className = 'card';
        div.innerHTML = `<div><strong>${v.name}</strong> <div class="muted">${v.category}</div></div>
          <div style="margin-top:6px"><button class="btn small view-products" data-vid="${v.id}">View</button> <button class="btn small outline unfav" data-vid="${v.id}">Remove</button></div>`;
        el.appendChild(div);
      }
      el.querySelectorAll('.view-products').forEach(b => b.addEventListener('click', e => openVendorModal(b.dataset.vid)));
      el.querySelectorAll('.unfav').forEach(b => b.addEventListener('click', e => {
        const vid = b.dataset.vid;
        removeFavorite(vid);
        ui.renderFavorites();
        ui.renderVendors();
      }));
    },

    renderStats() {
      const sV = ui.$('#stat-vendors');
      if (sV) sV.textContent = String(Object.values(state.vendors || {}).filter(v => v.active).length);
      const sFav = ui.$('#stat-fav');
      if (sFav) sFav.textContent = String((state.favorites[state.currentUserId] || []).length || 0);

      // vendor stats
      const u = state.users[state.currentUserId];
      if (u && u.role === 'vendor') {
        const vendor = Object.values(state.vendors).find(v => v.userId === u.id);
        if (vendor) {
          ui.$('#vendor-stat-products') && (ui.$('#vendor-stat-products').textContent = String((vendor.products || []).length));
          ui.$('#vendor-stat-orders') && (ui.$('#vendor-stat-orders').textContent = String((vendor.orders || []).length));
          ui.$('#vendor-stat-status') && (ui.$('#vendor-stat-status').textContent = vendor.active ? 'Active' : 'Inactive');
          // count active customers nearby
          const cLoc = ui.getCustomerLocation();
          if (cLoc) {
            let count = 0;
            for (const uid in state.users) {
              const us = state.users[uid];
              if (us.role === 'customer' && us._lastKnownLocation) {
                const d = haversineDistanceKm(cLoc.lat, cLoc.lng, us._lastKnownLocation.lat, us._lastKnownLocation.lng);
                if (d <= settings.proximityRadiusKm) count++;
              }
            }
            ui.$('#vendor-stat-customers') && (ui.$('#vendor-stat-customers').textContent = String(count));
          }
        }
      }
    },

    // vendor modal
    renderVendorModal(vendorId, customerLoc) {
      const v = state.vendors[vendorId];
      if (!v) return;
      ui.$('#modal-vendor-name').textContent = v.name;
      ui.$('#modal-vendor-category').textContent = `Category: ${v.category || '—'}`;
      ui.$('#modal-vendor-distance').textContent = customerLoc && v.location ? `Distance: ${haversineDistanceKm(customerLoc.lat, customerLoc.lng, v.location.lat, v.location.lng).toFixed(2)} km` : 'Distance: —';
      const wrap = ui.$('#modal-vendor-products');
      wrap.innerHTML = '';
      (v.products || []).forEach(pid => {
        const p = state.products[pid];
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `<div class="info"><h4>${p.name}</h4><p>${p.desc || ''}</p><div class="price">₹${p.price}</div><div style="margin-top:8px"><button class="btn add" data-pid="${p.id}">Add to cart</button></div></div>`;
        wrap.appendChild(card);
      });
      // attach add handlers
      wrap.querySelectorAll('.add').forEach(b => b.addEventListener('click', e => {
        cartAdd(b.dataset.pid, 1);
        ui.closeModal('modal-product');
      }));
      ui.openModal('modal-product');
    },

    // open vendor modal wrapper
    openVendorModal(vendorId, customerLoc) {
      ui.renderVendorModal(vendorId, customerLoc);
    },

    // helper to find status class
    statusClass(status) {
      return statusClass(status);
    }
  };

  // expose the two functions used from HTML
  window.openVendorModal = (vendorId, customerLoc) => ui.openVendorModal(vendorId, customerLoc);

  /* -------------------------
     Small wrappers for missing functions used in UI
     ------------------------- */

  function statusClass(status) {
    switch (status) {
      case 'pending':
        return 'status-pending';
      case 'accepted':
        return 'status-accepted';
      case 'completed':
        return 'status-completed';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return '';
    }
  }

  /* -------------------------
     Favorite Management
     ------------------------- */

  function toggleFavorite(vendorId) {
    const uid = state.currentUserId;
    if (!uid) {
      ui.showToast('Login to save favorites', 2000);
      return;
    }
    state.favorites[uid] = state.favorites[uid] || [];
    const arr = state.favorites[uid];
    const idx = arr.indexOf(vendorId);
    if (idx >= 0) {
      arr.splice(idx, 1);
      addActivity(`Removed favorite: ${state.vendors[vendorId].name}`);
    } else {
      arr.push(vendorId);
      addActivity(`Saved favorite: ${state.vendors[vendorId].name}`);
    }
    saveState();
  }

  function removeFavorite(vendorId) {
    const uid = state.currentUserId;
    if (!uid) return;
    state.favorites[uid] = state.favorites[uid] || [];
    const arr = state.favorites[uid];
    const idx = arr.indexOf(vendorId);
    if (idx >= 0) arr.splice(idx, 1);
    saveState();
  }

  /* -------------------------
     Order Status Updates
     ------------------------- */

  function updateOrderStatus(orderId, status) {
    const ord = state.orders[orderId];
    if (!ord) return;
    ord.status = status;
    saveState();
    addActivity(`Order ${orderId} marked ${status}`);
    ui.renderOrders();
    ui.renderVendorOrders();

    // notify customer
    const cust = state.users[ord.customerId];
    if (cust) {
      const msg = `Order ${orderId} is now ${status}`;
      if (settings.notificationMode === 'browser') ui.browserNotify('Order update', msg);
      else ui.showToast(msg, 3500);
    }
  }

  /* -------------------------
     Modal Order Detail
     ------------------------- */

  function openOrderModal(orderId) {
    const ord = state.orders[orderId];
    if (!ord) return;
    const body = ui.$('#modal-order-content');
    const vendor = state.vendors[ord.vendorId] || {};
    const cust = state.users[ord.customerId] || {};
    body.innerHTML = `<div><strong>Order ${ord.id}</strong></div>
      <div class="muted">Vendor: ${vendor.name || '—'}</div>
      <div class="muted">Customer: ${cust.name || '—'} • ${ord.contactPhone || ''}</div>
      <div style="margin-top:8px">${ord.items.map(it => {
        const p = state.products[it.productId] || {};
        return `<div>${p.name || 'Item'} × ${it.qty} — ₹${p.price ? p.price*it.qty : 0}</div>`;
      }).join('')}</div>
      <div style="margin-top:8px">Status: <span class="${statusClass(ord.status)}">${ord.status}</span></div>
      <div class="muted" style="margin-top:8px">Placed: ${new Date(ord.createdAt).toLocaleString()}</div>`;
    ui.openModal('modal-order');
    // wire accept/complete buttons in modal
    ui.$('#btn-order-accept').onclick = () => updateOrderStatus(orderId, 'accepted');
    ui.$('#btn-order-complete').onclick = () => updateOrderStatus(orderId, 'completed');
  }

  /* -------------------------
     Event Wiring & Init
     ------------------------- */

  function attachEvents() {
    // Auth
    const btnLogin = ui.$('#btn-login');
    btnLogin && btnLogin.addEventListener('click', handleLogin);

    const quickDemoBtn = ui.$('#btn-quick-demo');
    quickDemoBtn && quickDemoBtn.addEventListener('click', () => {
      loadDemoData();
      ui.renderAll();
    });

    // Logout
    const btnLogout = ui.$('#btn-logout');
    btnLogout && btnLogout.addEventListener('click', () => {
      state.currentUserId = null;
      saveState();
      ui.renderAll();
    });

    // Toggle sidebar
    const toggleSidebar = ui.$('#toggle-sidebar');
    toggleSidebar && toggleSidebar.addEventListener('click', () => {
      const sb = ui.$('#sidebar');
      if (!sb) return;
      sb.style.display = sb.style.display === 'none' ? 'block' : 'none';
    });

    // Navigation links
    ui.$$('.nav-link').forEach(a => {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        ui.$$('.nav-link').forEach(x => x.classList.remove('active'));
        a.classList.add('active');
        const panel = a.dataset.panel;
        showPanel(panel);
      });
    });

    // Search in header
    const globalSearch = ui.$('#global-search');
    globalSearch && globalSearch.addEventListener('input', () => {
      ui.$('#filter-search') && (ui.$('#filter-search').value = globalSearch.value);
      ui.renderVendors();
    });

    // Vendor location GPS
    const btnUseGps = ui.$('#btn-use-gps');
    btnUseGps && btnUseGps.addEventListener('click', () => {
      getAndSetCurrentUserLocation().then(loc => {
        ui.showToast('Location saved (for demo).', 2000);
      }).catch(err => ui.showToast('Location error: ' + err.message, 2000));
    });

    // customer GPS
    const btnGetMyLoc = ui.$('#btn-get-my-loc');
    btnGetMyLoc && btnGetMyLoc.addEventListener('click', async () => {
      try {
        const loc = await getBrowserLocation();
        // store as last known on current user
        const u = state.users[state.currentUserId];
        if (u) {
          u._lastKnownLocation = loc;
          saveState();
          ui.showToast(`Location set: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`, 2000);
          ui.renderVendors();
        }
      } catch (e) {
        ui.showToast('Unable to get location: ' + e.message, 2400);
      }
    });

    // vendor add product
    const addProdBtn = ui.$('#btn-add-product');
    addProdBtn && addProdBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const name = ui.$('#prod-name') && ui.$('#prod-name').value.trim();
      const price = ui.$('#prod-price') && ui.$('#prod-price').value;
      const desc = ui.$('#prod-desc') && ui.$('#prod-desc').value;
      const img = ui.$('#prod-img') && ui.$('#prod-img').value;
      if (!state.currentUserId) return ui.showToast('Login as vendor first', 2000);
      const u = state.users[state.currentUserId];
      if (!u || u.role !== 'vendor') return ui.showToast('Not a vendor account', 2000);
      // find vendor by userId
      const vendor = Object.values(state.vendors).find(v => v.userId === u.id);
      if (!vendor) {
        ui.showToast('No vendor profile associated', 2000);
        return;
      }
      if (!name || !price) {
        ui.showToast('Name and price required', 2000);
        return;
      }
      addProductToVendor(vendor.id, { name, price: Number(price), desc, img });
      ui.showToast('Product added', 1200);
      ui.renderAll();
    });

    // cart place order
    const btnPlaceOrder = ui.$('#btn-place-order');
    btnPlaceOrder && btnPlaceOrder.addEventListener('click', () => {
      if (!state.currentUserId) return ui.showToast('Login to place order', 2000);
      const u = state.users[state.currentUserId];
      if (!u || u.role !== 'customer') return ui.showToast('Switch to Customer role to place orders', 2000);
      const scheduleType = ui.$('#order-schedule-type') && ui.$('#order-schedule-type').value;
      const scheduleTimeEl = ui.$('#order-schedule-time');
      const scheduleIso = scheduleType === 'later' && scheduleTimeEl && scheduleTimeEl.value ? new Date(scheduleTimeEl.value).toISOString() : null;
      const contactName = ui.$('#checkout-name') && ui.$('#checkout-name').value.trim();
      const contactPhone = ui.$('#checkout-phone') && ui.$('#checkout-phone').value.trim();
      const res = placeOrder(u.id, scheduleIso, contactName, contactPhone);
      if (res.ok) {
        ui.showToast('Order placed: ' + res.ids.join(', '), 3000);
        ui.renderAll();
      } else ui.showToast(res.msg || 'Order failed', 2000);
    });
    // schedule type switching
    const scheduleType = ui.$('#order-schedule-type');
    scheduleType && scheduleType.addEventListener('change', () => {
      const st = scheduleType.value;
      const timeEl = ui.$('#order-schedule-time');
      if (st === 'later') timeEl.classList.remove('hidden');
      else timeEl.classList.add('hidden');
    });

    // settings save
    const btnSaveSettings = ui.$('#btn-save-settings');
    btnSaveSettings && btnSaveSettings.addEventListener('click', (ev) => {
      ev.preventDefault();
      const notif = ui.$('#settings-notif-mode') && ui.$('#settings-notif-mode').value;
      const radius = Number(ui.$('#settings-radius') && ui.$('#settings-radius').value) || DEFAULT_RADIUS_KM;
      settings.notificationMode = notif;
      settings.proximityRadiusKm = radius;
      saveSettings();
      ui.showToast('Settings saved', 1500);
    });

    // clear cart
    const btnClearCart = ui.$('#btn-clear-cart');
    btnClearCart && btnClearCart.addEventListener('click', (ev) => {
      ev.preventDefault();
      cartClear();
      ui.showToast('Cart cleared', 1100);
    });

    // basic modal close buttons
    ui.$$('.modal-close').forEach(b => b.addEventListener('click', (e) => {
      const id = b.dataset.close;
      if (id) ui.closeModal(id);
      else b.closest('.modal') && b.closest('.modal').classList.remove('active');
    }));

    // product card "View" on sample vendor card
    ui.$$('#vendors-container').forEach(el => {}); // just to ensure selector exists
  }

  /* -------------------------
     Login Handler
     ------------------------- */

  function handleLogin() {
    const name = (ui.$('#input-name') && ui.$('#input-name').value.trim()) || '';
    const phone = (ui.$('#input-phone') && ui.$('#input-phone').value.trim()) || '';
    const roleEls = document.getElementsByName('role');
    let role = 'customer';
    for (const r of roleEls) {
      if (r.checked) { role = r.value; break; }
    }
    if (!name || !phone) return ui.showToast('Please enter name and phone/ID', 1600);
    const user = addUserIfNotExists(name, phone, role);
    state.currentUserId = user.id;
    saveState();
    addActivity(`Logged in as ${user.name} (${user.role})`);
    ui.renderAll();
    startProximityMonitor();
  }

  /* -------------------------
     Location Helpers
     ------------------------- */

  async function getBrowserLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
      navigator.geolocation.getCurrentPosition((pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        resolve(loc);
      }, (err) => reject(err));
    });
  }

  async function getAndSetCurrentUserLocation() {
    if (!state.currentUserId) throw new Error('Not logged in');
    const loc = await getBrowserLocation();
    // save into vendor or user record depending on role
    const u = state.users[state.currentUserId];
    if (!u) throw new Error('No user found');
    if (u.role === 'vendor') {
      // find vendor
      const vendor = Object.values(state.vendors).find(v => v.userId === u.id);
      if (!vendor) {
        // create vendor profile automatically if missing (for ease)
        const v = createVendor(u.name, u.category || 'food', { lat: loc.lat, lng: loc.lng }, true, '');
        addActivity('Created vendor profile for ' + u.name);
        return (state.vendors[v.id].location = { lat: loc.lat, lng: loc.lng });
      } else {
        vendor.location = { lat: loc.lat, lng: loc.lng };
        vendor.active = true;
        saveState();
        return vendor.location;
      }
    } else {
      // customer
      u._lastKnownLocation = { lat: loc.lat, lng: loc.lng };
      saveState();
      return u._lastKnownLocation;
    }
  }

  /* -------------------------
     Small helpers to connect UI to functions above used by HTML inline
     ------------------------- */

  window.addProductToVendor = function (vendorId, product) {
    return addProductToVendor(vendorId, product);
  };

  window.openVendorModal = function (vendorId) {
    ui.openVendorModal(vendorId, ui.getCustomerLocation());
  };

  /* -------------------------
     Init - setup & initial rendering
     ------------------------- */

  function init() {
    loadState();
    attachEvents();
    ui.renderAll();

    // wire quick demo login from header: if demo currently loaded, keep state.currentUserId set
    if (state.currentUserId) {
      ui.showToast(`Logged in as ${state.users[state.currentUserId].name}`, 1200);
    }

    // small click binding for vendor "View" buttons (dynamically created)
    document.body.addEventListener('click', (ev) => {
      const v = ev.target;
      if (v.matches && v.matches('.view-products')) {
        const vendorId = v.dataset.vendorId || v.dataset.vid;
        if (vendorId) ui.openVendorModal(vendorId, ui.getCustomerLocation());
      }
      if (v.matches && v.matches('.add-to-cart')) {
        const pid = v.dataset.productId;
        if (pid) cartAdd(pid, 1);
      }
    });

    // Modal close by clicking overlay
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) modal.classList.remove('active');
      });
    });

    // quick panel switches for auth tabs
    document.querySelectorAll('.auth-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const panelToShow = tab.dataset.tab === 'signin' ? '#signin' : '#quick';
        document.querySelectorAll('.tab-panel').forEach(tp => tp.classList.remove('active'));
        document.querySelector(panelToShow).classList.add('active');
      });
    });

    // modal open/close via dataset
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.dataset.close;
        ui.closeModal(id);
      });
    });

    // start periodic tasks
    startProximityMonitor();

    // schedule pending orders processing (for those with schedule times)
    Object.values(state.orders || {}).forEach(o => {
      if (o.schedule) scheduleOrderProcessing(o.id);
      else scheduleOrderProcessing(o.id); // immediate ones also handled to notify
    });
  }

  /* -------------------------
     Expose some utilities for console debugging (optional)
     ------------------------- */
  window.SV = {
    state,
    settings,
    saveState,
    loadState,
    addProductToVendor,
    createVendor,
    placeOrder,
    cart,
  };

  // Initialize the app
  init();

  /* -------------------------
     helpers referenced above (avoid hoisting issues)
     ------------------------- */
  function createVendor(name, category, location, active, meta) {
    return (function _create() {
      const userId = uid('u_');
      state.users[userId] = { id: userId, name, phone: 'vendor-' + userId, role: 'vendor', category };
      const vendorId = uid('v_');
      state.vendors[vendorId] = { id: vendorId, userId, name, category, location: location || null, active: !!active, products: [], orders: [], meta: meta || '' };
      saveState();
      return state.vendors[vendorId];
    })();
  }

})();
