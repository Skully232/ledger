/* ================= Ledger — vanilla JS, offline-first ================= */

const EVENT_EXPENSE_CATEGORIES = ["Food", "Equipment", "Venue", "Decor", "Other"];
const PERSONAL_CATEGORIES = ["Food", "Transport", "Rent", "Shopping", "Clothing", "Subscriptions", "Health", "Other"];
const TRAVEL_MODES = ["Cab", "Auto", "Bike", "Train", "Flight", "Bus", "Own vehicle"];
const PAYMENT_STATUS = ["Pending", "Partial", "Received"];
const PAYOUT_STATUS = ["Pending", "Partial", "Paid"];
const PAYMENT_METHODS = ["UPI", "Cash", "Card", "Bank Transfer", "Other"];
const STORAGE_KEY = "ledger-data-v1";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const symbolFor = (c) => (c === "USD" ? "$" : "\u20B9");
const fmt = (n, c) => `${symbolFor(c)}${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const monthKey = (d) => {
  const dt = new Date(d);
  return isNaN(dt) ? "—" : dt.toLocaleString("default", { month: "short", year: "2-digit" });
};
const monthGroupKey = (d) => {
  const dt = new Date(d);
  return isNaN(dt) ? null : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};
const monthGroupLabel = (gk) => {
  const [y, m] = gk.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", { month: "short", year: "2-digit" });
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- state ---------------- */
let state = {
  theme: "dark",
  currency: "INR",
  tab: "events",
  showOverview: false,
  showMonthly: false,
  events: [],
  expenses: [],
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state = { ...state, ...saved, tab: "events", showOverview: false, showMonthly: false };
    }
  } catch (e) { console.warn("load failed", e); }
  document.documentElement.setAttribute("data-theme", state.theme);
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: state.theme, currency: state.currency, events: state.events, expenses: state.expenses,
    }));
  } catch (e) { console.warn("save failed", e); }
}

/* ---------------- derived ---------------- */
function eventTotals(ev) {
  const expTotal = (ev.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const travelTotal = (ev.travelLegs || []).reduce((s, t) => s + (Number(t.cost) || 0), 0);
  const isCommission = ev.type === "commission";

  let income = 0, manpower = 0, teamPaid = 0;
  if (isCommission) {
    (ev.workers || []).forEach((w) => {
      const count = Number(w.count) || 0;
      const clientEach = Number(w.clientPayEach) || 0;
      const payEach = Number(w.payoutEach) || 0;
      const owedTotal = count * payEach;
      income += count * clientEach;
      manpower += owedTotal;
      if (w.payoutStatus === "Paid") teamPaid += owedTotal;
      else if (w.payoutStatus === "Partial") teamPaid += Number(w.payoutPaid) || 0;
    });
  } else {
    income = Number(ev.incomeAmount) || 0;
  }

  const totalCost = expTotal + travelTotal + manpower;
  let received = 0;
  if (ev.paymentStatus === "Received") received = income;
  else if (ev.paymentStatus === "Partial") received = Number(ev.receivedAmount) || 0;
  const clientPending = Math.max(0, income - received);
  const teamBalance = Math.max(0, manpower - teamPaid);

  return { expTotal, travelTotal, manpower, income, totalCost, received, clientPending, teamPaid, teamBalance, netActual: received - totalCost };
}
function allEventTotals() {
  return [...state.events]
    .sort((a, b) => {
      const pa = a.paymentStatus === "Received" ? 1 : 0;
      const pb = b.paymentStatus === "Received" ? 1 : 0;
      if (pa !== pb) return pa - pb; // unpaid/partial stay on top, received sinks down
      return new Date(b.startDate) - new Date(a.startDate);
    })
    .map((ev) => ({ ev, t: eventTotals(ev) }));
}
function eventsEarnings() {
  let ownNet = 0, commissionNet = 0;
  allEventTotals().forEach(({ ev, t }) => { if (ev.type === "commission") commissionNet += t.netActual; else ownNet += t.netActual; });
  return { ownNet, commissionNet, total: ownNet + commissionNet };
}
function personalTotal() { return state.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0); }
function thisMonthLabel() { return new Date().toLocaleString("default", { month: "short", year: "2-digit" }); }
function thisMonthPersonal() {
  const m = thisMonthLabel();
  return state.expenses.filter((e) => monthKey(e.date) === m).reduce((s, e) => s + (Number(e.amount) || 0), 0);
}
function thisMonthEarned() {
  const m = thisMonthLabel();
  return allEventTotals().filter(({ ev }) => monthKey(ev.startDate) === m).reduce((s, { t }) => s + t.netActual, 0);
}
function monthlyBreakdown() {
  const map = {};
  allEventTotals().forEach(({ ev, t }) => {
    const gk = monthGroupKey(ev.startDate);
    if (!gk) return;
    map[gk] = map[gk] || { eventsNet: 0, personal: 0 };
    map[gk].eventsNet += t.netActual;
  });
  state.expenses.forEach((e) => {
    const gk = monthGroupKey(e.date);
    if (!gk) return;
    map[gk] = map[gk] || { eventsNet: 0, personal: 0 };
    map[gk].personal += Number(e.amount) || 0;
  });
  return Object.entries(map)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([gk, v]) => ({ gk, label: monthGroupLabel(gk), ...v, combined: v.eventsNet - v.personal }));
}

/* ---------------- icons (inline, no deps) ---------------- */
const ICONS = {
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a17.9 17.9 0 0 1-2.94 3.94M6.1 6.1A17.6 17.6 0 0 0 1 11s4 7 11 7a10.9 10.9 0 0 0 5.9-1.6M1 1l22 22"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>`,
  chevDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`,
  chevUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>`,
  mark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3 20 8v8l-8 5-8-5V8Z"/><path d="M12 3v18M4 8l8 5 8-5"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg>`,
};

/* ---------------- render: header ---------------- */
function renderHeader() {
  const earnings = eventsEarnings();
  return `
  <div class="app-header">
    <div class="container">
      <div class="header-row">
        <div class="brand">
          <div class="brand-mark">${ICONS.mark}</div>
          <div class="brand-title serif">Ledger</div>
        </div>
        <div class="header-actions">
          <button class="icon-btn" data-action="toggle-theme">${state.theme === "dark" ? ICONS.sun : ICONS.moon}</button>
          <button class="icon-btn" data-action="toggle-currency">${state.currency}</button>
          <button class="icon-btn" data-action="toggle-monthly" title="Monthly breakdown">${ICONS.calendar}</button>
          <button class="icon-btn" data-action="export-excel" title="Download Excel">${ICONS.download}</button>
          <button class="icon-btn" data-action="toggle-overview" title="My earnings breakdown">${state.showOverview ? ICONS.eyeOff : ICONS.eye}</button>
        </div>
      </div>

      <div class="ticker">
        <span>This month</span>
        <span class="tk-in"><b>Earned ${fmt(thisMonthEarned(), state.currency)}</b></span>
        <span class="tk-out"><b>Spent ${fmt(thisMonthPersonal(), state.currency)}</b></span>
        <span>My earnings <b style="color:${earnings.total >= 0 ? "var(--green)" : "var(--red)"}">${fmt(earnings.total, state.currency)}</b></span>
      </div>

      ${state.showMonthly ? renderMonthlyPanel() : ""}
      ${state.showOverview ? renderOverview(earnings) : ""}

      <div class="tabs">
        ${["events", "personal", "learn"].map((t) => `
          <button class="tab-btn ${state.tab === t ? "active" : ""}" data-action="switch-tab" data-tab="${t}">
            ${t[0].toUpperCase() + t.slice(1)}
          </button>`).join("")}
      </div>
    </div>
  </div>`;
}

function renderOverview(earnings) {
  const combined = earnings.total - personalTotal();
  return `
  <div class="overview-panel">
    <div class="overview-row"><span>Own event earnings</span><span style="color:${earnings.ownNet >= 0 ? "var(--green)" : "var(--red)"}">${fmt(earnings.ownNet, state.currency)}</span></div>
    <div class="overview-row"><span>Manpower / commission earnings</span><span style="color:${earnings.commissionNet >= 0 ? "var(--green)" : "var(--red)"}">${fmt(earnings.commissionNet, state.currency)}</span></div>
    <div class="overview-row" style="font-weight:600;border-top:1px solid var(--border-soft);margin-top:2px;padding-top:6px;"><span>My earnings (mine only)</span><span style="color:${earnings.total >= 0 ? "var(--green)" : "var(--red)"}">${fmt(earnings.total, state.currency)}</span></div>
    <div class="overview-row"><span>Personal expenses (lifetime)</span><span style="color:var(--red)">−${fmt(personalTotal(), state.currency)}</span></div>
    <div class="overview-row total"><span>Combined net</span><span style="color:${combined >= 0 ? "var(--green)" : "var(--red)"}">${fmt(combined, state.currency)}</span></div>
  </div>`;
}

function renderMonthlyPanel() {
  const rows = monthlyBreakdown();
  if (rows.length === 0) return `<div class="overview-panel"><p class="empty-mini">No dated entries yet.</p></div>`;
  return `
  <div class="overview-panel">
    <div class="overview-row" style="color:var(--text-faint);font-size:11px;text-transform:uppercase;letter-spacing:.04em;">
      <span>Month</span><span>Events · Personal · Combined</span>
    </div>
    ${rows.map((r) => `
      <div class="overview-row">
        <span>${r.label}</span>
        <span class="mono">
          <span style="color:${r.eventsNet >= 0 ? "var(--green)" : "var(--red)"}">${fmt(r.eventsNet, state.currency)}</span>
          &nbsp;·&nbsp;<span style="color:var(--red)">−${fmt(r.personal, state.currency)}</span>
          &nbsp;·&nbsp;<span style="color:${r.combined >= 0 ? "var(--green)" : "var(--red)"}">${fmt(r.combined, state.currency)}</span>
        </span>
      </div>`).join("")}
  </div>`;
}

/* ---------------- render: events tab ---------------- */
function renderEventsTab() {
  const items = allEventTotals();
  return `
  <button class="add-btn" data-action="add-event">${ICONS.plus} New event</button>
  ${items.length === 0 ? `<p class="empty-note">No events yet. Add your first one above.</p>` : items.map(renderEventCard).join("")}
  `;
}

function renderEventCard({ ev, t }) {
  const isCommission = ev.type === "commission";
  const badgeClass = ev.paymentStatus === "Received" ? "badge-received" : ev.paymentStatus === "Partial" ? "badge-partial" : "badge-pending";
  const netLabel = isCommission ? "Commission (client − manpower − costs)" : "Net (received − cost)";
  const accentColor = ev.paymentStatus === "Received" ? "var(--green)" : ev.paymentStatus === "Partial" ? "var(--amber)" : "var(--red)";
  const dayCount = ev.endDate && ev.endDate !== ev.startDate ? Math.max(1, Math.round((new Date(ev.endDate) - new Date(ev.startDate)) / 86400000) + 1) : null;

  return `
  <div class="card" data-event-id="${ev.id}" style="border-left: 4px solid ${accentColor};">
    <div class="card-body">
      <div class="card-top">
        <div class="card-fields">
          <input class="event-name-input" data-field="name" data-event-id="${ev.id}" value="${esc(ev.name)}" placeholder="Event name" />
          <div class="meta-row">
            <input type="date" data-field="startDate" data-event-id="${ev.id}" value="${esc(ev.startDate)}" />
            <span class="arrow">→</span>
            <input type="date" data-field="endDate" data-event-id="${ev.id}" value="${esc(ev.endDate || "")}" title="End date (optional, for multi-day events)" />
            ${dayCount ? `<span class="stat-sub">${dayCount}d</span>` : ""}
            <input data-field="client" data-event-id="${ev.id}" value="${esc(ev.client)}" placeholder="Client" />
            <span class="badge ${badgeClass}">${ev.paymentStatus}</span>
          </div>
        </div>
        <button class="remove-btn" data-action="delete-event" data-event-id="${ev.id}">${ICONS.trash}</button>
      </div>

      <div class="type-toggle">
        <button class="type-chip ${!isCommission ? "active" : ""}" data-action="set-type" data-event-id="${ev.id}" data-type="self">My event</button>
        <button class="type-chip ${isCommission ? "active" : ""}" data-action="set-type" data-event-id="${ev.id}" data-type="commission">Manpower / commission</button>
      </div>

      <div class="stat-grid">
        <div class="stat-box">
          <div class="stat-label">${isCommission ? "Client total (auto)" : "Income"}</div>
          ${isCommission
            ? `<div class="stat-value mono" style="color:var(--green)">${fmt(t.income, state.currency)}</div>`
            : `<input class="mono" type="number" data-field="incomeAmount" data-event-id="${ev.id}" value="${ev.incomeAmount}" style="font-size:15px;font-weight:600;color:var(--green);" />`}
          <select data-field="paymentStatus" data-event-id="${ev.id}" style="font-size:10.5px;color:var(--text-faint);margin-top:2px;">
            ${PAYMENT_STATUS.map((s) => `<option value="${s}" ${ev.paymentStatus === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          ${ev.paymentStatus === "Partial" ? `<input class="mono" type="number" data-field="receivedAmount" data-event-id="${ev.id}" value="${ev.receivedAmount || 0}" placeholder="received so far" style="font-size:10.5px;margin-top:4px;" />` : ""}
          <div style="font-size:10.5px;margin-top:5px;display:flex;justify-content:space-between;">
            <span style="color:var(--green)">Paid ${fmt(t.received, state.currency)}</span>
            <span style="color:${t.clientPending > 0 ? "var(--red)" : "var(--text-faint)"}">Pending ${fmt(t.clientPending, state.currency)}</span>
          </div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Total cost</div>
          <div class="stat-value mono" style="color:var(--red)">${fmt(t.totalCost, state.currency)}</div>
          <div class="stat-sub">exp ${fmt(t.expTotal, state.currency)} · travel ${fmt(t.travelTotal, state.currency)}${isCommission ? " · manpower " + fmt(t.manpower, state.currency) : ""}</div>
        </div>
        ${isCommission ? `
        <div class="stat-box manpower">
          <div class="stat-label">Team payments</div>
          <div style="font-size:12px;display:flex;justify-content:space-between;">
            <span>Paid <b class="mono" style="color:var(--green)">${fmt(t.teamPaid, state.currency)}</b></span>
            <span>Balance owed <b class="mono" style="color:${t.teamBalance > 0 ? "var(--red)" : "var(--text-faint)"}">${fmt(t.teamBalance, state.currency)}</b></span>
          </div>
        </div>` : ""}
      </div>

      ${isCommission ? `
      <div class="sub-panel" style="border-top:none;border:1px solid var(--border-soft);border-radius:9px;margin-top:8px;">
        <div class="sub-header"><span>${ICONS.users} People sent</span><button class="plus-btn" data-action="add-worker" data-event-id="${ev.id}">${ICONS.plus}</button></div>
        ${(ev.workers || []).map((w) => {
          const count = Number(w.count) || 0;
          const clientEach = Number(w.clientPayEach) || 0;
          const payEach = Number(w.payoutEach) || 0;
          const marginTotal = (clientEach - payEach) * count;
          const owed = count * payEach;
          const status = w.payoutStatus || "Pending";
          const paid = status === "Paid" ? owed : status === "Partial" ? (Number(w.payoutPaid) || 0) : 0;
          const balance = owed - paid;
          const wBadge = status === "Paid" ? "badge-received" : status === "Partial" ? "badge-partial" : "badge-pending";
          return `
          <div class="row-line" style="align-items:flex-end;">
            <input class="flex1" data-field="name" data-event-id="${ev.id}" data-worker-id="${w.id}" value="${esc(w.name)}" placeholder="Name (e.g. Rahul)" style="min-width:88px;" />
            <div style="width:52px;flex-shrink:0;">
              <div class="stat-sub" style="margin-bottom:1px;">count</div>
              <input class="mono" type="number" min="1" data-field="count" data-event-id="${ev.id}" data-worker-id="${w.id}" value="${w.count}" />
            </div>
            <div style="width:76px;flex-shrink:0;">
              <div class="stat-sub" style="margin-bottom:1px;">client pays each</div>
              <input class="mono" type="number" data-field="clientPayEach" data-event-id="${ev.id}" data-worker-id="${w.id}" value="${w.clientPayEach}" />
            </div>
            <div style="width:76px;flex-shrink:0;">
              <div class="stat-sub" style="margin-bottom:1px;">you pay each</div>
              <input class="mono" type="number" data-field="payoutEach" data-event-id="${ev.id}" data-worker-id="${w.id}" value="${w.payoutEach}" />
            </div>
            <button class="remove-btn" data-action="remove-worker" data-event-id="${ev.id}" data-worker-id="${w.id}">${ICONS.x}</button>

            <div style="width:100%;font-size:10.5px;color:var(--text-faint);margin-top:2px;">
              ${count} × (${fmt(clientEach, state.currency)} − ${fmt(payEach, state.currency)}) = <span style="color:${marginTotal >= 0 ? "var(--green)" : "var(--red)"}">${fmt(marginTotal, state.currency)} margin</span>
            </div>

            <div style="width:100%;display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap;">
              <span class="badge ${wBadge}">${status}</span>
              <select data-field="payoutStatus" data-event-id="${ev.id}" data-worker-id="${w.id}" style="width:auto;font-size:10.5px;flex-shrink:0;">
                ${PAYOUT_STATUS.map((s) => `<option value="${s}" ${status === s ? "selected" : ""}>${s}</option>`).join("")}
              </select>
              ${status === "Partial" ? `<input class="mono" type="number" data-field="payoutPaid" data-event-id="${ev.id}" data-worker-id="${w.id}" value="${w.payoutPaid || 0}" placeholder="paid so far" style="width:80px;font-size:10.5px;" />` : ""}
              <span style="font-size:10.5px;color:${balance > 0 ? "var(--red)" : "var(--text-faint)"};margin-left:auto;">bal ${fmt(balance, state.currency)}</span>
            </div>
          </div>`;
        }).join("") || `<p class="empty-mini">No one added yet. Add a name and how many you sent.</p>`}
      </div>` : ""}

      <div class="net-row">
        <span class="label">${netLabel}</span>
        <span class="value mono" style="color:${t.netActual >= 0 ? "var(--green)" : "var(--red)"}">${fmt(t.netActual, state.currency)}</span>
      </div>

      <button class="expand-btn" data-action="toggle-expand" data-event-id="${ev.id}">
        ${ev.expanded ? ICONS.chevUp : ICONS.chevDown} ${ev.expanded ? "Collapse" : "Expenses & travel"}
      </button>
    </div>

    ${ev.expanded ? `
    <div class="sub-panel">
      <div class="sub-header"><span>Other expenses</span><button class="plus-btn" data-action="add-expense" data-event-id="${ev.id}">${ICONS.plus}</button></div>
      ${(ev.expenses || []).map((exp) => `
        <div class="row-line">
          <select class="cat-select" data-field="category" data-event-id="${ev.id}" data-expense-id="${exp.id}">
            ${EVENT_EXPENSE_CATEGORIES.map((c) => `<option value="${c}" ${exp.category === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
          ${exp.category === "Other" ? `<input class="flex1" data-field="customName" data-event-id="${ev.id}" data-expense-id="${exp.id}" value="${esc(exp.customName)}" placeholder="describe" />` : ""}
          <input class="amt-input mono" type="number" data-field="amount" data-event-id="${ev.id}" data-expense-id="${exp.id}" value="${exp.amount}" />
          <button class="remove-btn" data-action="remove-expense" data-event-id="${ev.id}" data-expense-id="${exp.id}">${ICONS.x}</button>
        </div>`).join("") || `<p class="empty-mini">No expenses logged.</p>`}
    </div>
    <div class="sub-panel">
      <div class="sub-header"><span>${ICONS.pin} Travel legs</span><button class="plus-btn" data-action="add-leg" data-event-id="${ev.id}">${ICONS.plus}</button></div>
      ${(ev.travelLegs || []).map((leg) => `
        <div class="row-line">
          <input class="from-to" data-field="from" data-event-id="${ev.id}" data-leg-id="${leg.id}" value="${esc(leg.from)}" placeholder="From" />
          <span class="arrow">→</span>
          <input class="from-to" data-field="to" data-event-id="${ev.id}" data-leg-id="${leg.id}" value="${esc(leg.to)}" placeholder="To" />
          <select class="mode-select" data-field="mode" data-event-id="${ev.id}" data-leg-id="${leg.id}">
            ${TRAVEL_MODES.map((m) => `<option value="${m}" ${leg.mode === m ? "selected" : ""}>${m}</option>`).join("")}
          </select>
          <input class="amt-input mono" type="number" data-field="cost" data-event-id="${ev.id}" data-leg-id="${leg.id}" value="${leg.cost}" />
          <button class="remove-btn" data-action="remove-leg" data-event-id="${ev.id}" data-leg-id="${leg.id}">${ICONS.x}</button>
        </div>`).join("") || `<p class="empty-mini">No travel legs logged.</p>`}
    </div>` : ""}
  </div>`;
}

/* ---------------- render: personal tab ---------------- */
function renderPersonalTab() {
  const sorted = [...state.expenses].sort((a, b) => (a.date < b.date ? 1 : -1));
  const map = {};
  state.expenses.forEach((e) => { const k = monthKey(e.date); map[k] = (map[k] || 0) + (Number(e.amount) || 0); });
  const chartEntries = Object.entries(map);
  const max = Math.max(1, ...chartEntries.map(([, v]) => v));

  const catMap = {};
  state.expenses.forEach((e) => { const cat = e.category === "Other" && e.customName ? e.customName : e.category; catMap[cat] = (catMap[cat] || 0) + (Number(e.amount) || 0); });
  const catTotal = Object.values(catMap).reduce((s, v) => s + v, 0) || 1;
  const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  return `
  <button class="add-btn" data-action="add-expense-personal">${ICONS.plus} Log expense</button>

  ${chartEntries.length ? `
  <div class="card chart-card">
    <div class="section-label">Monthly spend</div>
    <div class="bars">
      ${chartEntries.map(([month, total]) => `
        <div class="bar-col">
          <div class="bar" style="height:${Math.max(4, (total / max) * 100)}%"></div>
          <div class="bar-label">${month}</div>
        </div>`).join("")}
    </div>
  </div>` : ""}

  ${catEntries.length ? `
  <div class="card chart-card">
    <div class="section-label" style="justify-content:space-between;display:flex;"><span>By category</span><span>${fmt(personalTotal(), state.currency)}</span></div>
    ${catEntries.map(([cat, val]) => `
      <div class="cat-bar-row">
        <div class="cat-bar-top"><span>${esc(cat)}</span><span class="mono">${fmt(val, state.currency)}</span></div>
        <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${(val / catTotal) * 100}%"></div></div>
      </div>`).join("")}
  </div>` : ""}

  ${sorted.length === 0 ? `<p class="empty-note">No expenses logged yet.</p>` : sorted.map((exp) => `
    <div class="card expense-row">
      <input class="date-in" type="date" data-field="date" data-pexpense-id="${exp.id}" value="${esc(exp.date)}" />
      <select class="cat-in" data-field="category" data-pexpense-id="${exp.id}">
        ${PERSONAL_CATEGORIES.map((c) => `<option value="${c}" ${exp.category === c ? "selected" : ""}>${c}</option>`).join("")}
      </select>
      ${exp.category === "Other" ? `<input class="cat-in" data-field="customName" data-pexpense-id="${exp.id}" value="${esc(exp.customName)}" placeholder="describe" />` : ""}
      <select class="method-in" data-field="method" data-pexpense-id="${exp.id}">
        ${PAYMENT_METHODS.map((m) => `<option value="${m}" ${exp.method === m ? "selected" : ""}>${m}</option>`).join("")}
      </select>
      <input class="note-in" data-field="note" data-pexpense-id="${exp.id}" value="${esc(exp.note)}" placeholder="note" />
      <input class="amt-in mono" type="number" data-field="amount" data-pexpense-id="${exp.id}" value="${exp.amount}" />
      <button class="remove-btn" data-action="remove-expense-personal" data-pexpense-id="${exp.id}">${ICONS.trash}</button>
    </div>`).join("")}
  `;
}

/* ---------------- render: learn tab ---------------- */
const LEARN_CARDS = [
  { title: "Budgeting — the 50/30/20 rule", body: "Split take-home income: 50% needs (rent, food, bills), 30% wants (shopping, going out), 20% savings/investing. Start here before anything fancy." },
  { title: "Emergency fund first", body: "Before investing, build 3–6 months of expenses in a liquid, safe place. This is your shock absorber, not an investment." },
  { title: "Saving vs investing", body: "Saving = keeping money safe for near-term needs. Investing = accepting some risk for long-term growth, for goals 3+ years away. Don't invest money you need soon." },
  { title: "Investing basics (India)", body: "SIP = fixed amount into mutual funds monthly, builds discipline. Index funds track the market (e.g. Nifty 50) with low fees — a good default. FD = guaranteed low return, safe. Stocks = higher risk/reward, needs research." },
  { title: "US market basics", body: "Investing in US stocks/ETFs from India usually goes through LRS via platforms like Vested or INDmoney. Index ETFs (e.g. S&P 500 trackers) are a common low-effort entry point." },
  { title: "Manpower / commission jobs", body: "When you're sending your guys instead of working the event yourself, track client payment and manpower payout separately — your commission is the gap, not the full client amount. That's what the 'Manpower / commission' event type is for." },
  { title: "Irregular income", body: "With event-based income, budget off your average monthly income over the last 6–12 months, not your best month. Keep a bigger buffer than salaried income since payments arrive unevenly." },
  { title: "Track first, optimize later", body: "You can't budget what you don't measure. Logging every expense for 1–2 months reveals real patterns before you set targets." },
];
function renderLearnTab() {
  return `
  <div class="section-label">${ICONS.book} Finance basics</div>
  ${LEARN_CARDS.map((c) => `
    <div class="card learn-card">
      <div class="learn-title serif">${c.title}</div>
      <div class="learn-body">${c.body}</div>
    </div>`).join("")}
  `;
}

/* ---------------- root render ---------------- */
function render() {
  const app = document.getElementById("app");
  const body = state.tab === "events" ? renderEventsTab() : state.tab === "personal" ? renderPersonalTab() : renderLearnTab();
  app.innerHTML = `${renderHeader()}<div class="main"><div class="container">${body}</div></div>`;
}

/* ---------------- mutations ---------------- */
function findEvent(id) { return state.events.find((e) => e.id === id); }

function addEvent() {
  state.events.unshift({
    id: uid(), name: "New Event", startDate: new Date().toISOString().slice(0, 10), endDate: "", client: "",
    type: "self", incomeAmount: 0, receivedAmount: 0, paymentStatus: "Pending",
    workers: [], expenses: [], travelLegs: [], expanded: true,
  });
}
function addExpensePersonal() {
  state.expenses.unshift({ id: uid(), date: new Date().toISOString().slice(0, 10), category: "Food", customName: "", amount: 0, method: "UPI", note: "" });
}

/* ---------------- event delegation ---------------- */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "toggle-theme") { state.theme = state.theme === "dark" ? "light" : "dark"; document.documentElement.setAttribute("data-theme", state.theme); persist(); render(); return; }
  if (action === "toggle-currency") { state.currency = state.currency === "INR" ? "USD" : "INR"; persist(); render(); return; }
  if (action === "toggle-overview") { state.showOverview = !state.showOverview; if (state.showOverview) state.showMonthly = false; render(); return; }
  if (action === "toggle-monthly") { state.showMonthly = !state.showMonthly; if (state.showMonthly) state.showOverview = false; render(); return; }
  if (action === "export-excel") { exportToExcel(); return; }
  if (action === "switch-tab") { state.tab = btn.dataset.tab; render(); return; }

  if (action === "add-event") { addEvent(); persist(); render(); return; }
  if (action === "delete-event") { state.events = state.events.filter((ev) => ev.id !== btn.dataset.eventId); persist(); render(); return; }
  if (action === "toggle-expand") { const ev = findEvent(btn.dataset.eventId); if (ev) ev.expanded = !ev.expanded; render(); return; }
  if (action === "set-type") { const ev = findEvent(btn.dataset.eventId); if (ev) ev.type = btn.dataset.type; persist(); render(); return; }

  if (action === "add-worker") { const ev = findEvent(btn.dataset.eventId); if (ev) { ev.workers = ev.workers || []; ev.workers.push({ id: uid(), name: "", count: 1, clientPayEach: 0, payoutEach: 0, payoutStatus: "Pending", payoutPaid: 0 }); persist(); render(); } return; }
  if (action === "remove-worker") { const ev = findEvent(btn.dataset.eventId); if (ev) { ev.workers = ev.workers.filter((w) => w.id !== btn.dataset.workerId); persist(); render(); } return; }

  if (action === "add-expense") { const ev = findEvent(btn.dataset.eventId); if (ev) { ev.expenses = ev.expenses || []; ev.expenses.push({ id: uid(), category: "Food", customName: "", amount: 0 }); persist(); render(); } return; }
  if (action === "remove-expense") { const ev = findEvent(btn.dataset.eventId); if (ev) { ev.expenses = ev.expenses.filter((x) => x.id !== btn.dataset.expenseId); persist(); render(); } return; }

  if (action === "add-leg") { const ev = findEvent(btn.dataset.eventId); if (ev) { ev.travelLegs = ev.travelLegs || []; ev.travelLegs.push({ id: uid(), from: "", to: "", mode: "Cab", cost: 0 }); persist(); render(); } return; }
  if (action === "remove-leg") { const ev = findEvent(btn.dataset.eventId); if (ev) { ev.travelLegs = ev.travelLegs.filter((l) => l.id !== btn.dataset.legId); persist(); render(); } return; }

  if (action === "add-expense-personal") { addExpensePersonal(); persist(); render(); return; }
  if (action === "remove-expense-personal") { state.expenses = state.expenses.filter((x) => x.id !== btn.dataset.pexpenseId); persist(); render(); return; }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  const field = el.dataset.field;
  if (!field) return;
  const val = el.type === "number" ? el.value : el.value;

  if (el.dataset.eventId && el.dataset.expenseId) {
    const ev = findEvent(el.dataset.eventId); const exp = ev?.expenses.find((x) => x.id === el.dataset.expenseId);
    if (exp) exp[field] = val;
  } else if (el.dataset.eventId && el.dataset.legId) {
    const ev = findEvent(el.dataset.eventId); const leg = ev?.travelLegs.find((l) => l.id === el.dataset.legId);
    if (leg) leg[field] = val;
  } else if (el.dataset.eventId && el.dataset.workerId) {
    const ev = findEvent(el.dataset.eventId); const w = ev?.workers?.find((x) => x.id === el.dataset.workerId);
    if (w) w[field] = val;
  } else if (el.dataset.eventId) {
    const ev = findEvent(el.dataset.eventId);
    if (ev) ev[field] = val;
  } else if (el.dataset.pexpenseId) {
    const exp = state.expenses.find((x) => x.id === el.dataset.pexpenseId);
    if (exp) exp[field] = val;
  } else return;

  persist();
  render();
});

/* ---------------- excel export ---------------- */
function exportToExcel() {
  if (typeof XLSX === "undefined") { alert("Excel library not loaded."); return; }

  const evRows = [...state.events].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  const evHeader = ["Start Date", "End Date", "Event", "Type", "Client", "Income / Client Total", "Client Paid", "Client Pending", "Manpower Cost", "Manpower Paid", "Manpower Balance", "Other Expenses", "Travel Cost", "Total Cost", "Net / Commission", "Payment Status"];
  const evData = evRows.map((ev) => {
    const t = eventTotals(ev);
    return [
      ev.startDate, ev.endDate || "", ev.name, ev.type === "commission" ? "Manpower/Commission" : "My Event", ev.client || "",
      t.income, t.received, t.clientPending, t.manpower, t.teamPaid, t.teamBalance, t.expTotal, t.travelTotal, t.totalCost, t.netActual, ev.paymentStatus,
    ];
  });
  const wsEvents = XLSX.utils.aoa_to_sheet([evHeader, ...evData]);
  wsEvents["!cols"] = [{ wch: 11 }, { wch: 11 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];

  const workerHeader = ["Start Date", "Event", "Name", "Count", "Client Pays Each", "You Pay Each", "Margin Total", "Payout Status", "Payout Paid", "Payout Balance"];
  const workerData = [];
  evRows.filter((ev) => ev.type === "commission").forEach((ev) => {
    (ev.workers || []).forEach((w) => {
      const count = Number(w.count) || 0, clientEach = Number(w.clientPayEach) || 0, payEach = Number(w.payoutEach) || 0;
      const owed = count * payEach;
      const paid = w.payoutStatus === "Paid" ? owed : w.payoutStatus === "Partial" ? (Number(w.payoutPaid) || 0) : 0;
      workerData.push([ev.startDate, ev.name, w.name || "", count, clientEach, payEach, (clientEach - payEach) * count, w.payoutStatus || "Pending", paid, owed - paid]);
    });
  });
  const wsWorkers = XLSX.utils.aoa_to_sheet([workerHeader, ...workerData]);
  wsWorkers["!cols"] = [{ wch: 11 }, { wch: 22 }, { wch: 16 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];

  const pxRows = [...state.expenses].sort((a, b) => new Date(a.date) - new Date(b.date));
  const pxHeader = ["Date", "Category", "Payment Method", "Note", "Amount"];
  const pxData = pxRows.map((e) => [e.date, e.category === "Other" && e.customName ? e.customName : e.category, e.method, e.note || "", Number(e.amount) || 0]);
  const wsPersonal = XLSX.utils.aoa_to_sheet([pxHeader, ...pxData]);
  wsPersonal["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 26 }, { wch: 12 }];

  const monthly = [...monthlyBreakdown()].reverse();
  const mHeader = ["Month", "Events Net", "Personal Spend", "Combined Net"];
  const mData = monthly.map((r) => [r.label, r.eventsNet, r.personal, r.combined]);
  const wsMonthly = XLSX.utils.aoa_to_sheet([mHeader, ...mData]);
  wsMonthly["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsEvents, "Events");
  XLSX.utils.book_append_sheet(wb, wsWorkers, "Event Workers");
  XLSX.utils.book_append_sheet(wb, wsPersonal, "Personal Expenses");
  XLSX.utils.book_append_sheet(wb, wsMonthly, "Monthly Summary");

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Ledger-Export-${stamp}.xlsx`);
}

/* ---------------- init ---------------- */
loadState();
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
