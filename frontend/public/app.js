'use strict';

// ── Utilities ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const uuid = () => crypto.randomUUID();

function timeSince(iso) {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 5)    return 'just now';
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

async function api(path, opts = {}) {
  try {
    const r = await fetch(path, opts);
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.message } };
  }
}

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  panel: 'system',
  timers: {},
  pollId: null,
  events: [],
};

// ── Navigation ─────────────────────────────────────────────────────────────
function switchPanel(name) {
  stopPanel(state.panel);
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.panel === name)
  );
  document.querySelectorAll('.panel').forEach(el =>
    el.classList.toggle('active', el.id === `panel-${name}`)
  );
  state.panel = name;
  startPanel(name);
}

function stopPanel(name) {
  if (state.timers[name]) { clearInterval(state.timers[name]); delete state.timers[name]; }
  if (name === 'purchase' && state.pollId) { clearInterval(state.pollId); state.pollId = null; }
}

function startPanel(name) {
  const polls = { system: loadHealth, analytics: loadAnalytics, fraud: loadFraud };
  if (polls[name]) {
    polls[name]();
    state.timers[name] = setInterval(polls[name], 5000);
  }
  if (name === 'events')   loadEvents();
  if (name === 'purchase') initPurchase();
}

// ── System Health ──────────────────────────────────────────────────────────
async function loadHealth() {
  const { data } = await api('/api/health');
  if (!Array.isArray(data)) return;
  renderHealth(data);
  $('last-refresh').textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function renderHealth(items) {
  const services = items.filter(s => s.type === 'service');
  const workers  = items.filter(s => s.type === 'worker');
  const healthy  = items.filter(s => s.status === 'healthy').length;

  $('health-summary').textContent = `${healthy} / ${items.length} services healthy`;

  // Global dot
  const dot = $('global-dot');
  const txt = $('global-text');
  if (healthy === items.length) {
    dot.className = 'gdot ok'; txt.textContent = 'All Operational';
  } else if (healthy > 0) {
    dot.className = 'gdot warn'; txt.textContent = `${items.length - healthy} Degraded`;
  } else {
    dot.className = 'gdot bad';  txt.textContent = 'System Down';
  }

  // Service cards
  $('services-grid').innerHTML = services.map(s => `
    <div class="hcard">
      <div class="hcard-top">
        <span class="hcard-name">${s.label}</span>
        <span class="badge badge-${s.status}">${s.status}</span>
      </div>
      <div class="hcard-meta">${s.latency}ms response</div>
      ${s.data.uptime_seconds != null ? `<div class="hcard-meta"style="margin-top:2px">up ${fmtUptime(s.data.uptime_seconds)}</div>` : ''}
    </div>
  `).join('');

  // Worker rows
  $('workers-list').innerHTML = workers.map(w => {
    const d = w.data;
    const qDepth = d.tpQueueDepth ?? d.queue?.depth ?? d.eventBrowseQueueDepth ?? null;
    const dlq    = d.dlqDepth ?? d.dlq_depth ?? d.queue?.dlq_depth ?? null;
    const proc   = d.jobs_processed ?? d.totalProcessed ?? d.processedCount ?? null;
    const flagged= d.totalFlagged ?? null;
    const lastAt = d.lastSuccessAt ?? d.last_job_at ?? d.lastProcessedAt ?? null;

    const metrics = [
      qDepth  != null ? mtr('Queue',    qDepth,  qDepth  > 50 ? 'warn' : '') : '',
      dlq     != null ? mtr('DLQ',      dlq,     dlq     >  0 ? 'bad'  : '') : '',
      proc    != null ? mtr('Processed',proc) : '',
      flagged != null ? mtr('Flagged',  flagged, flagged >  0 ? 'warn' : '') : '',
      lastAt           ? mtr('Last job', timeSince(lastAt)) : '',
    ].filter(Boolean).join('');

    return `
      <div class="wrow">
        <div class="wrow-dot ${w.status}"></div>
        <div class="wrow-name">${w.label}</div>
        <div class="wrow-metrics">${metrics}</div>
        <span class="badge badge-${w.status}">${w.status}</span>
      </div>
    `;
  }).join('');
}

function mtr(k, v, cls = '') {
  return `<div class="metric">
    <span class="metric-k">${k}</span>
    <span class="metric-v${cls ? ' ' + cls : ''}">${v ?? '—'}</span>
  </div>`;
}

function fmtUptime(s) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ── Events ─────────────────────────────────────────────────────────────────
async function loadEvents() {
  $('events-container').innerHTML = '<div class="empty-state">Loading events…</div>';
  const { ok, data } = await api('/api/events');
  if (!ok || !Array.isArray(data)) {
    $('events-container').innerHTML = '<div class="empty-state">Failed to load events</div>';
    return;
  }
  state.events = data;

  if (!data.length) {
    $('events-container').innerHTML = '<div class="empty-state">No events found</div>';
    return;
  }

  $('events-container').innerHTML = `
    <div class="events-list">
      ${data.map(ev => {
        const seats = ev.seats || [];
        const avail = seats.filter(s => s.status === 'available').length;
        const total = seats.length;
        const pct   = total > 0 ? ((total - avail) / total * 100).toFixed(1) : 0;
        return `
          <div class="ecard">
            <div class="ecard-header" onclick="toggleEventDetail('${ev.name}','${ev.event_id}')">
              <div>
                <div class="ecard-name">${ev.name}</div>
                <div class="ecard-venue">${ev.venue_name}${ev.venue_address ? ' · ' + ev.venue_address : ''}</div>
              </div>
              <div class="ecard-date">${fmtDate(ev.start_time)}</div>
            </div>
            ${total > 0 ? `
              <div class="seat-bar"><div class="seat-fill" style="width:${pct}%"></div></div>
              <div class="seat-stats">${avail.toLocaleString()} / ${total.toLocaleString()} seats available</div>
            ` : ''}
            <div class="ecard-detail" id="edetail-${ev.event_id}"></div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function toggleEventDetail(name, id) {
  const el = $(`edetail-${id}`);
  if (el.classList.contains('open')) { el.classList.remove('open'); return; }
  el.innerHTML = '<div class="empty-state" style="padding:12px 0">Loading…</div>';
  el.classList.add('open');

  const { ok, data } = await api(`/api/events/${encodeURIComponent(name)}`);
  if (!ok) { el.innerHTML = '<div class="empty-state">Failed to load</div>'; return; }

  const seats  = data.seats || [];
  const byStatus = seats.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {});
  const sample = seats.filter(s => s.status === 'available').slice(0, 8).map(s => s.seat_number);

  el.innerHTML = [
    drow('Total seats', seats.length.toLocaleString()),
    ...Object.entries(byStatus).map(([k, v]) => drow(k, v.toLocaleString())),
    sample.length ? drow('Sample available', sample.join(', ') + '…') : '',
  ].join('');
}

// ── Purchase ───────────────────────────────────────────────────────────────
async function initPurchase() {
  if (!state.events.length) {
    const { data } = await api('/api/events');
    state.events = Array.isArray(data) ? data : [];
  }
  const sel = $('purchase-event');
  sel.innerHTML = state.events.length
    ? state.events.map(e => `<option value="${e.name}">${e.name}</option>`).join('')
    : '<option value="">— no events —</option>';
  regenerateKey();
}

function regenerateKey()       { $('purchase-idem').value  = uuid(); }
function regenerateRefundKey() { $('refund-idem').value    = uuid(); }

async function submitPurchase() {
  const event          = $('purchase-event').value;
  const seat           = $('purchase-seat').value.trim();
  const amount         = parseFloat($('purchase-amount').value);
  const idempotency_key= $('purchase-idem').value;

  if (!event || !seat || isNaN(amount) || amount <= 0) {
    setPipelineError('Fill in all fields before submitting');
    return;
  }

  const btn = $('purchase-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  $('waitlist-btn').style.display = 'none';

  setPipeline([
    { label: 'Submitted',   detail: 'Sending request…',        state: 'active'  },
    { label: 'Queued',      detail: 'Waiting…',                state: 'waiting' },
    { label: 'Processing',  detail: 'Waiting for worker…',     state: 'waiting' },
    { label: 'Confirmed',   detail: '—',                       state: 'waiting' },
  ]);

  const body = { idempotency_key, event, seat, amount,
    start_time: new Date().toISOString(),
    end_time:   new Date(Date.now() + 86_400_000).toISOString() };

  const { ok, status, data } = await api('/api/purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  btn.disabled = false;
  btn.textContent = 'Purchase Ticket';

  if (!ok) {
    if (status === 409) {
      setPipelineError(`Seat ${seat} is already taken`);
      $('waitlist-btn').style.display = 'block';
    } else {
      setPipelineError(data.error || `Error ${status}`);
    }
    return;
  }

  const purchaseId = data.purchase?.id ?? data.id;

  setPipeline([
    { label: 'Submitted',  detail: `ID: ${purchaseId}`,       state: 'done'   },
    { label: 'Queued',     detail: 'In Redis queue…',         state: 'active' },
    { label: 'Processing', detail: 'Waiting for worker…',     state: 'waiting'},
    { label: 'Confirmed',  detail: '—',                       state: 'waiting'},
  ]);

  let ticks = 0;
  if (state.pollId) clearInterval(state.pollId);

  state.pollId = setInterval(async () => {
    ticks++;
    const { ok: pok, data: pd } = await api(`/api/purchases/${purchaseId}`);
    if (!pok) return;

    if (pd.status === 'confirmed') {
      clearInterval(state.pollId); state.pollId = null;
      setPipeline([
        { label: 'Submitted',  detail: `ID: ${purchaseId}`,         state: 'done' },
        { label: 'Queued',     detail: 'Dequeued by worker',         state: 'done' },
        { label: 'Payment',    detail: 'Charged successfully',       state: 'done' },
        { label: 'Confirmed',  detail: `${timeSince(pd.created_at)}`,state: 'done' },
      ]);
      setResult('ok', [`✓ Purchase confirmed`, `ID: ${purchaseId}`, `Amount: $${pd.amount}`].join('\n'));
      regenerateKey();

    } else if (pd.status === 'failed') {
      clearInterval(state.pollId); state.pollId = null;
      setPipeline([
        { label: 'Submitted',  detail: `ID: ${purchaseId}`,   state: 'done' },
        { label: 'Queued',     detail: 'Dequeued by worker',   state: 'done' },
        { label: 'Payment',    detail: 'Payment declined',     state: 'fail' },
        { label: 'Failed',     detail: 'Purchase unsuccessful',state: 'fail' },
      ]);
    } else if (ticks >= 3) {
      setPipeline([
        { label: 'Submitted',  detail: `ID: ${purchaseId}`,       state: 'done'   },
        { label: 'Queued',     detail: 'Dequeued by worker',       state: 'done'   },
        { label: 'Processing', detail: 'Calling payment service…', state: 'active' },
        { label: 'Confirmed',  detail: '—',                        state: 'waiting'},
      ]);
    }

    if (ticks > 30) { clearInterval(state.pollId); state.pollId = null; }
  }, 2000);
}

function setPipeline(steps) {
  $('pipeline-body').innerHTML = `
    <div class="pipe-steps">
      ${steps.map((s, i) => `
        <div class="pipe-step">
          <div class="pipe-node ${s.state === 'waiting' ? '' : s.state}">
            ${s.state === 'done' ? '✓' : s.state === 'fail' ? '✕' : i + 1}
          </div>
          <div class="pipe-body">
            <div class="pipe-label">${s.label}</div>
            <div class="pipe-detail">${s.detail}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  clearResult();
}

function setPipelineError(msg) {
  $('pipeline-body').innerHTML = `<div class="empty-state" style="color:var(--red);margin-top:24px">${msg}</div>`;
  clearResult();
}

function setResult(cls, text) {
  const el = $('purchase-result');
  el.className = `purchase-result ${cls}`;
  el.textContent = text;
}

function clearResult() {
  const el = $('purchase-result');
  el.className = 'purchase-result';
  el.textContent = '';
}

async function submitWaitlist() {
  const event          = $('purchase-event').value;
  const amount         = parseFloat($('purchase-amount').value);
  const idempotency_key= uuid();

  if (!event || isNaN(amount)) { setPipelineError('Select an event and enter an amount'); return; }

  const { ok, data } = await api('/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotency_key, event, amount }),
  });

  if (ok) {
    setPipelineError(`✓ Added to waitlist for "${event}"`);
    $('waitlist-btn').style.display = 'none';
  } else {
    setPipelineError(data.error || 'Failed to join waitlist');
  }
}

// ── Refund ─────────────────────────────────────────────────────────────────
async function submitRefund() {
  const purchase_id    = $('refund-purchase-id').value.trim();
  const amount         = parseFloat($('refund-amount').value);
  const idempotency_key= $('refund-idem').value;
  const el             = $('refund-result-card');

  if (!purchase_id || isNaN(amount) || amount <= 0) {
    el.innerHTML = '<div class="empty-state" style="color:var(--red)">Enter a valid purchase ID and amount</div>';
    return;
  }

  el.innerHTML = '<div class="empty-state">Processing…</div>';

  const { ok, data } = await api('/api/refunds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purchase_id: parseInt(purchase_id, 10), amount, idempotency_key }),
  });

  if (ok) {
    el.innerHTML = `
      <div style="width:100%">
        <div class="section-label" style="color:var(--green);margin-bottom:14px">Refund Processed</div>
        <div class="detail-card">
          ${drow('Purchase ID', purchase_id)}
          ${drow('Amount',      `$${amount.toFixed(2)}`)}
          ${drow('Status',      data.status || 'completed', 'ok')}
          ${data.id ? drow('Refund ID', data.id) : ''}
        </div>
      </div>
    `;
    regenerateRefundKey();
  } else {
    el.innerHTML = `<div class="empty-state" style="color:var(--red)">${data.error || data.message || 'Refund failed'}</div>`;
  }
}

// ── Analytics ──────────────────────────────────────────────────────────────
async function loadAnalytics() {
  const { ok, data } = await api('/api/analytics');
  if (!ok) return;

  const processed = data.processedCount ?? data.processed_count ?? 0;
  const browseQ   = data.eventBrowseQueueDepth ?? data.browse_queue_depth ?? 0;
  const dlq       = data.dlqDepth ?? 0;
  const lastAt    = data.lastProcessedAt ?? data.last_processed_at ?? null;

  $('analytics-stats').innerHTML = [
    stat(processed, 'Purchases Tracked', 'c-accent'),
    stat(browseQ,   'Browse Queue',       browseQ > 10 ? 'c-amber' : ''),
    stat(dlq,       'DLQ Depth',          dlq     >  0 ? 'c-red'   : ''),
  ].join('');

  $('analytics-detail').innerHTML = `
    <div class="detail-card">
      ${drow('Worker status',         data.status ?? '—', data.status === 'healthy' ? 'ok' : '')}
      ${drow('Last purchase processed', timeSince(lastAt))}
      ${data.lastError ? drow('Last error', data.lastError, 'bad') : ''}
    </div>
  `;
}

// ── Fraud ──────────────────────────────────────────────────────────────────
async function loadFraud() {
  const { ok, data } = await api('/api/fraud');
  if (!ok) return;

  const total   = data.totalProcessed ?? 0;
  const flagged = data.totalFlagged   ?? 0;
  const rate    = total > 0 ? ((flagged / total) * 100).toFixed(1) : 0;
  const dlq     = data.dlqDepth ?? 0;

  $('fraud-stats').innerHTML = [
    stat(total,        'Processed',  ''),
    stat(flagged,      'Flagged',    flagged > 0 ? 'c-red'   : ''),
    stat(rate + '%',   'Flag Rate',  flagged > 0 ? 'c-amber' : ''),
    stat(dlq,          'DLQ Depth',  dlq     > 0 ? 'c-red'   : ''),
  ].join('');

  $('fraud-detail').innerHTML = `
    <div class="detail-card">
      ${drow('Worker status', data.status ?? '—', data.status === 'healthy' ? 'ok' : '')}
      ${drow('Last flagged',  timeSince(data.lastFlaggedAt))}
    </div>
  `;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function stat(val, lbl, cls = '') {
  return `<div class="stat ${cls}"><div class="stat-val">${val}</div><div class="stat-lbl">${lbl}</div></div>`;
}

function drow(k, v, cls = '') {
  return `<div class="drow"><span class="dkey">${k}</span><span class="dval ${cls}">${v}</span></div>`;
}

// ── Init ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(el =>
  el.addEventListener('click', () => switchPanel(el.dataset.panel))
);

regenerateKey();
regenerateRefundKey();
switchPanel('system');
