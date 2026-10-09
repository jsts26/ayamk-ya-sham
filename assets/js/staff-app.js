(() => {
  const cfg = window.STAFF_CONFIG;
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
  const roleLabels = {
    orders: "متابعة الطلبات",
    kitchen: "المطبخ",
    cashier: "الكاشير",
    menu: "القائمة",
    delivery: "التوصيل"
  };
  const base = (cfg?.SITE_BASE_PATH || "").replace(/\/$/, "");
  const loginUrl = `${base}/staff/login.html`;
  const homeUrl = `${base}/index.html`;
  let supabaseClient = null;
  let currentUser = null;
  let currentRole = null;
  let orderCache = [];

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[c]));
  }
  function money(v) {
    const n = Number(v || 0);
    return n.toLocaleString("ar", { maximumFractionDigits: 2 });
  }
  function showMessage(message, isError=false) {
    const el = $("#staff-message");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden", "error");
    if (isError) el.classList.add("error");
  }
  function clearMessage() {
    const el = $("#staff-message");
    if (el) { el.textContent = ""; el.classList.add("hidden"); el.classList.remove("error"); }
  }
  function statusLabel(s) {
    return ({
      pending:"جديد", confirmed:"مؤكد", preparing:"قيد التحضير",
      out_for_delivery:"خرج للتوصيل", completed:"مكتمل", cancelled:"ملغى",
      pending_payment:"بانتظار الدفع", awaiting_transfer:"بانتظار التحويل",
      under_review:"التحويل قيد المراجعة", paid:"مدفوع", unpaid:"غير مدفوع",
      failed:"فشل الدفع", rejected:"مرفوض"
    })[s] || s || "—";
  }
  function pill(s) {
    const cls = ["pending","cancelled","failed","rejected"].includes(s) ? ` ${s}` : "";
    return `<span class="staff-pill${cls}">${escapeHtml(statusLabel(s))}</span>`;
  }
  function siteHref(path) { return `${base}${path}`; }

  async function initClient() {
    if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
        cfg.SUPABASE_ANON_KEY.includes("PASTE_YOUR")) {
      throw new Error("أضف مفتاح Supabase العام (anon/publishable) في assets/js/staff-supabase.js قبل الاستخدام.");
    }
    if (!window.supabase?.createClient) {
      throw new Error("تعذر تحميل مكتبة Supabase. تحقق من الاتصال بالإنترنت.");
    }
    supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
    });
  }
  async function getSession() {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    return data.session;
  }
  async function requireStaff(expectedRole=null) {
    const session = await getSession();
    if (!session?.user) { location.href = loginUrl; return false; }
    currentUser = session.user;
    const [{ data: profile, error: profileError }, { data: role, error: roleError }] = await Promise.all([
      supabaseClient.from("staff_profiles").select("user_id,display_name,role,is_active").eq("user_id", currentUser.id).maybeSingle(),
      supabaseClient.rpc("current_staff_role")
    ]);
    if (profileError) throw profileError;
    if (roleError) throw roleError;
    if (!profile || !profile.is_active || !role) {
      await supabaseClient.auth.signOut();
      throw new Error("هذا الحساب غير مفعّل كحساب موظف. راجع المدير.");
    }
    if (expectedRole && (profile.role !== expectedRole || role !== expectedRole)) {
      location.href = siteHref(`/staff/${role}.html`);
      return false;
    }
    currentRole = role;
    const nameEl = $("#staff-user-name");
    if (nameEl) nameEl.textContent = profile.display_name || currentUser.email || "موظف";
    const roleEl = $("#staff-role-label");
    if (roleEl) roleEl.textContent = roleLabels[role] || role;
    return true;
  }
  async function signOut() {
    if (supabaseClient) await supabaseClient.auth.signOut();
    location.href = loginUrl;
  }
  async function signIn(event) {
    event.preventDefault(); clearMessage();
    const email = $("#email")?.value.trim();
    const password = $("#password")?.value;
    if (!email || !password) return showMessage("أدخل البريد الإلكتروني وكلمة المرور.", true);
    const btn = $("#login-submit"); if (btn) btn.disabled = true;
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = data.user;
      const { data: profile, error: pErr } = await supabaseClient.from("staff_profiles")
        .select("role,is_active").eq("user_id", currentUser.id).maybeSingle();
      if (pErr) throw pErr;
      if (!profile || !profile.is_active || !roleLabels[profile.role]) {
        await supabaseClient.auth.signOut();
        throw new Error("بيانات الدخول صحيحة، لكن الحساب غير مفعّل كموظف. تواصل مع المدير.");
      }
      const { data: role, error: rErr } = await supabaseClient.rpc("current_staff_role");
      if (rErr) throw rErr;
      if (role !== profile.role) throw new Error("تعذر التحقق من دور الموظف. راجع إعدادات قاعدة البيانات.");
      location.href = siteHref(`/staff/${role}.html`);
    } catch (err) {
      showMessage(err.message || "تعذر تسجيل الدخول.", true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  function orderItemsHtml(items) {
    if (!items?.length) return `<div class="staff-small">لا توجد تفاصيل أصناف متاحة.</div>`;
    return `<ul class="staff-items">${items.map(i =>
      `<li>${escapeHtml(i.product_name_ar || i.product_name_en || "صنف")} × ${escapeHtml(i.quantity)} — ${money(i.line_total)}</li>`
    ).join("")}</ul>`;
  }
  function actionButtons(order) {
    const s = order.status;
    const buttons = [];
    if (currentRole === "orders" && s === "pending")
      buttons.push(`<button class="staff-button" data-status="confirmed" data-id="${order.id}">تأكيد الطلب</button>`);
    if (currentRole === "kitchen" && s === "confirmed")
      buttons.push(`<button class="staff-button" data-status="preparing" data-id="${order.id}">بدء التحضير</button>`);
    if (currentRole === "kitchen" && s === "preparing")
      buttons.push(`<button class="staff-button secondary" data-status="confirmed" data-id="${order.id}">إرجاع إلى مؤكد</button>`);
    if (currentRole === "delivery" && ["confirmed","preparing"].includes(s))
      buttons.push(`<button class="staff-button" data-status="out_for_delivery" data-id="${order.id}">خرج للتوصيل</button>`);
    if (currentRole === "delivery" && s === "out_for_delivery")
      buttons.push(`<button class="staff-button" data-status="completed" data-id="${order.id}">تأكيد التسليم</button>`);
    if (currentRole === "cashier" && ["cash_on_delivery","cash"].includes(order.payment_method) && ["pending","unpaid"].includes(order.payment_status))
      buttons.push(`<button class="staff-button" data-payment="cash_collected" data-id="${order.id}">تسجيل استلام النقد</button>`);
    if (currentRole === "cashier" && order.payment_method === "bank_transfer" && order.payment_status === "awaiting_transfer")
      buttons.push(`<button class="staff-button" data-payment="transfer_received" data-id="${order.id}">استلام إشعار تحويل (للمراجعة)</button>`);
    if (currentRole === "orders" && ["pending","confirmed"].includes(s))
      buttons.push(`<button class="staff-button secondary" data-approval="cancel_order" data-id="${order.id}">طلب موافقة لإلغاء</button>`);
    return buttons.length ? `<div class="staff-actions">${buttons.join("")}</div>` : "";
  }
  function renderOrders(orders) {
    const container = $("#staff-orders");
    if (!container) return;
    if (!orders.length) { container.innerHTML = `<div class="staff-empty">لا توجد طلبات مطابقة.</div>`; return; }
    container.innerHTML = orders.map(o => {
      const items = o.order_items || [];
      return `<article class="staff-order">
        <div class="staff-order-head">
          <div><h3>طلب #${escapeHtml(o.order_number ?? o.id.slice(0,8))}</h3>
          <div class="staff-meta">${escapeHtml(o.customer_name || "عميل")} · ${escapeHtml(o.customer_phone || "—")}</div></div>
          <div>${pill(o.status)}</div>
        </div>
        <div class="staff-meta">النوع: ${escapeHtml(o.order_type || "delivery")} · المصدر: ${escapeHtml(o.order_source || "website")} · التاريخ: ${escapeHtml(new Date(o.created_at).toLocaleString("ar"))}</div>
        <div class="staff-meta">الإجمالي: <strong>${money(o.total)}</strong> · الدفع: ${escapeHtml(o.payment_method || "—")} · الحالة المالية: ${pill(o.payment_status)}</div>
        ${o.delivery_address ? `<div class="staff-meta">العنوان: ${escapeHtml(o.delivery_address)}</div>` : ""}
        ${o.table_number ? `<div class="staff-meta">رقم الطاولة: ${escapeHtml(o.table_number)}</div>` : ""}
        ${o.customer_notes ? `<div class="staff-meta">ملاحظات: ${escapeHtml(o.customer_notes)}</div>` : ""}
        ${orderItemsHtml(items)}
        ${actionButtons(o)}
      </article>`;
    }).join("");
  }
  async function loadOrders() {
    clearMessage();
    const target = $("#staff-orders");
    if (target) target.innerHTML = `<div class="staff-empty">جارٍ تحميل الطلبات…</div>`;
    try {
      let query = supabaseClient.from("orders").select(`
        id,order_number,customer_name,customer_phone,delivery_address,customer_notes,
        status,subtotal,discount_amount,delivery_fee,total,created_at,payment_method,
        payment_status,order_type,table_number,order_source,assigned_driver_id,
        order_items(id,product_name_ar,product_name_en,unit_price,quantity,line_total)
      `).order("created_at", { ascending:false }).limit(100);
      if (currentRole === "delivery") query = query.eq("assigned_driver_id", currentUser.id);
      const { data, error } = await query;
      if (error) throw error;
      orderCache = data || [];
      applyOrderFilters();
    } catch (err) {
      if (target) target.innerHTML = "";
      showMessage(`تعذر تحميل الطلبات: ${err.message}`, true);
    }
  }
  function applyOrderFilters() {
    const search = ($("#order-search")?.value || "").trim().toLowerCase();
    const status = $("#order-status")?.value || "all";
    const filtered = orderCache.filter(o => {
      const text = [o.order_number,o.customer_name,o.customer_phone,o.delivery_address,o.id].join(" ").toLowerCase();
      return (!search || text.includes(search)) && (status === "all" || o.status === status);
    });
    renderOrders(filtered);
  }
  async function updateStatus(id, status) {
    clearMessage();
    const note = prompt("ملاحظة (اختياري):") || null;
    try {
      const { data, error } = await supabaseClient.rpc("staff_update_order_status", {
        p_order_id:id, p_new_status:status, p_note:note
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.message || "رفضت قاعدة البيانات العملية.");
      showMessage("تم إرسال تحديث الحالة بنجاح.");
      await loadOrders();
    } catch (err) { showMessage(`لم يتم تحديث الحالة: ${err.message}`, true); }
  }
  async function recordPayment(id, action) {
    clearMessage();
    const note = prompt(action === "cash_collected" ? "أدخل ملاحظة استلام النقد (اختياري):" : "رقم/مرجع التحويل أو ملاحظة للمراجعة:") || null;
    try {
      const { data, error } = await supabaseClient.rpc("staff_record_payment", {
        p_order_id:id, p_action:action, p_note:note
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.message || "رفضت قاعدة البيانات العملية.");
      showMessage(action === "transfer_received" ? "سُجّل إشعار التحويل للمراجعة؛ لم يُعتمد كمدفوع." : "تم تسجيل استلام النقد.");
      await loadOrders();
    } catch (err) { showMessage(`تعذر تسجيل الدفع: ${err.message}`, true); }
  }
  async function requestApproval(operation, targetType, targetId, requestData, reason) {
    const { data, error } = await supabaseClient.rpc("request_manager_approval", {
      p_operation:operation, p_target_type:targetType, p_target_id:String(targetId || ""),
      p_request_data:requestData || {}, p_reason:reason
    });
    if (error) throw error;
    return data;
  }
  async function askApprovalForOrder(id) {
    const reason = prompt("اذكر سبب طلب إلغاء الطلب:");
    if (!reason?.trim()) return;
    try {
      await requestApproval("cancel_order","orders",id,{order_id:id},reason.trim());
      showMessage("أُرسل طلب الموافقة إلى المدير. لم يُلغَ الطلب تلقائيًا.");
    } catch (err) { showMessage(`تعذر إرسال الطلب: ${err.message}`, true); }
  }
  async function loadProducts() {
    const target = $("#staff-products");
    if (target) target.innerHTML = `<div class="staff-empty">جارٍ تحميل المنتجات…</div>`;
    try {
      const { data, error } = await supabaseClient.from("products")
        .select("id,name_ar,name_en,price,is_available,sort_order,group_name_ar,group_name_en")
        .order("sort_order", {ascending:true}).limit(300);
      if (error) throw error;
      if (!data?.length) { target.innerHTML = `<div class="staff-empty">لا توجد منتجات.</div>`; return; }
      target.innerHTML = `<div style="overflow:auto"><table class="staff-table"><thead><tr><th>المنتج</th><th>السعر</th><th>التوفر</th><th>إجراء</th></tr></thead><tbody>${data.map(p => `<tr>
        <td>${escapeHtml(p.name_ar || p.name_en || p.id)}</td><td>${money(p.price)}</td>
        <td>${p.is_available ? "متاح" : "غير متاح"}</td>
        <td><button class="staff-button secondary" data-product="${p.id}" data-available="${!p.is_available}" data-name="${escapeHtml(p.name_ar || p.name_en || "")}">${p.is_available ? "طلب إيقاف" : "طلب تفعيل"}</button></td>
      </tr>`).join("")}</tbody></table></div>`;
    } catch (err) { if (target) target.innerHTML = ""; showMessage(`تعذر تحميل المنتجات: ${err.message}`, true); }
  }
  async function proposeProductChange(id, available, name) {
    const reason = prompt(`سبب طلب ${available ? "تفعيل" : "إيقاف"} المنتج «${name}»؟`);
    if (!reason?.trim()) return;
    try {
      await requestApproval("set_product_availability","products",id,{product_id:id,is_available:available,product_name:name},reason.trim());
      showMessage("أُرسل طلب التغيير للمدير. لم تتغير حالة المنتج مباشرة.");
    } catch (err) { showMessage(`تعذر إرسال طلب الموافقة: ${err.message}`, true); }
  }

  async function boot() {
    try {
      await initClient();
      const page = document.body.dataset.staffPage;
      if (page === "login") {
        const session = await getSession();
        if (session?.user) {
          const { data: role } = await supabaseClient.rpc("current_staff_role");
          if (role && roleLabels[role]) { location.href = siteHref(`/staff/${role}.html`); return; }
        }
        $("#login-form")?.addEventListener("submit", signIn);
        $("#back-to-store")?.addEventListener("click", () => location.href = homeUrl);
        return;
      }
      const expectedRole = document.body.dataset.staffRole;
      if (!(await requireStaff(expectedRole))) return;
      $("#staff-signout")?.addEventListener("click", signOut);
      $("#refresh-orders")?.addEventListener("click", loadOrders);
      $("#order-search")?.addEventListener("input", applyOrderFilters);
      $("#order-status")?.addEventListener("change", applyOrderFilters);
      $("#staff-orders")?.addEventListener("click", async e => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.status) await updateStatus(b.dataset.id, b.dataset.status);
        if (b.dataset.payment) await recordPayment(b.dataset.id, b.dataset.payment);
        if (b.dataset.approval) await askApprovalForOrder(b.dataset.id);
      });
      $("#staff-products")?.addEventListener("click", async e => {
        const b = e.target.closest("button[data-product]");
        if (b) await proposeProductChange(b.dataset.product, b.dataset.available === "true", b.dataset.name);
      });
      if (expectedRole === "menu") await loadProducts();
      else await loadOrders();
    } catch (err) {
      showMessage(err.message || "حدث خطأ غير متوقع.", true);
    }
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
