/**
 * 拉里·威廉斯（Larry Williams）實證雷達篩選（四大篩選器共用，2026-11-26）
 * - 經 2 年台美雙市場實證，保留具正 Alpha 訊號：
 *   重擊反殺 (Smash Day 5d)、急殺撿鑽 (%R(3)<=-95+長多)、跳空反轉 (Oops!)、
 *   壓縮待爆 (NR7+季線)、假突破避雷 (台股專用)
 * - 跟著「日線／1H」週期切換（各篩選器 applyFilters 內以 window.williamsPass 判斷）
 * - 按任何快速篩選或「全部重置」([id^="qf-"]) 時自動重設為「全部」
 */
(function () {
    const BUY_SIGNALS = ['重擊反殺', '急殺撿鑽', '跳空反轉', '壓縮待爆'];
    const BUY_SET = new Set(BUY_SIGNALS);

    const META = {
        '重擊反殺': { icon: '💥', bg: 'rgba(249,115,22,0.22)', border: '#fb923c', color: '#fdba74', rank: 50 },
        '急殺撿鑽': { icon: '🎯', bg: 'rgba(14,165,233,0.22)', border: '#38bdf8', color: '#7dd3fc', rank: 40 },
        '跳空反轉': { icon: '😱', bg: 'rgba(168,85,247,0.22)', border: '#c084fc', color: '#d8b4fe', rank: 30 },
        '壓縮待爆': { icon: '⚡', bg: 'rgba(234,179,8,0.20)',  border: '#facc15', color: '#fde047', rank: 20 },
        '假突破避雷': { icon: '⚠️', bg: 'rgba(239,68,68,0.22)', border: '#f87171', color: '#fca5a5', rank: 10 },
    };

    const OPTIONS = [
        { value: 'all',      label: '全部' },
        { value: 'buy_any',  label: '🔥 全部買訊' },
        { value: '重擊反殺', label: '💥 重擊反殺' },
        { value: '急殺撿鑽', label: '🎯 急殺撿鑽' },
        { value: '跳空反轉', label: '😱 跳空反轉' },
        { value: '壓縮待爆', label: '⚡ 壓縮待爆' },
        { value: '假突破避雷', label: '⚠️ 假突破避雷' },
    ];

    const st = { mode: 'all' };
    window.WILLIAMS_FILTER = st;

    function getSignals(w) {
        if (!w) return [];
        if (Array.isArray(w.signals) && w.signals.length) return w.signals;
        if (w.signal && w.signal !== '無') return [w.signal];
        return [];
    }

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    window.williamsPass = function (w) {
        if (st.mode === 'all') return true;
        const sigs = getSignals(w);
        if (!sigs.length) return false;
        if (st.mode === 'buy_any') return sigs.some(s => BUY_SET.has(s));
        return sigs.includes(st.mode);
    };

    window.williamsRank = function (w) {
        if (!w || !w.signal || w.signal === '無') return 0;
        const m = META[w.signal];
        return m ? m.rank : 0;
    };

    window.renderWilliamsBadge = function (w) {
        const sigs = getSignals(w);
        if (!sigs.length) {
            return '<span style="opacity:.38">--</span>';
        }
        const primary = sigs[0];
        const m = META[primary] || { icon: '•', bg: 'rgba(148,163,184,0.2)', border: '#94a3b8', color: '#e2e8f0' };
        const extra = sigs.length > 1 ? ` +${sigs.length - 1}` : '';
        const tip = w.hint ? esc(w.hint) : esc(sigs.join('、'));
        return `<span title="${tip}" style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;white-space:nowrap;background:${m.bg};border:1px solid ${m.border};color:${m.color}">${m.icon} ${esc(primary)}${extra}</span>`;
    };

    window.renderWilliamsDetail = function (w) {
        if (!w) return '';
        const sigs = getSignals(w);
        const sigText = sigs.length ? sigs.map(s => `${(META[s] && META[s].icon) || ''} ${s}`).join(' / ') : '無訊號';
        const wr3Text = w.wr3 != null ? `${Number(w.wr3).toFixed(1)}${Number(w.wr3) <= -95 ? ' (極端超賣)' : ''}` : '--';
        const vbText = w.vb_offset != null ? `開盤價 + ${Number(w.vb_offset).toFixed(2)}` : '--';
        const limitRow = w.limit_ref != null
            ? `<div class="detail-item"><span class="lbl">限價參考(昨收)</span><span class="val">${Number(w.limit_ref).toFixed(2)}</span></div>`
            : '';
        const stopRow = w.stop_ref != null
            ? `<div class="detail-item"><span class="lbl">形態停損參考</span><span class="val neg">${Number(w.stop_ref).toFixed(2)}</span></div>`
            : '';
        const hintRow = w.hint
            ? `<div style="margin-top:6px;padding:6px 8px;border-radius:6px;background:rgba(251,191,36,0.10);border:1px solid rgba(251,191,36,0.28);color:#fde68a;font-size:11px;line-height:1.45">${esc(w.hint)}</div>`
            : '';
        return `
            <div class="detail-group">
                <h4>拉里·威廉斯雷達</h4>
                <div class="detail-item"><span class="lbl">威廉斯訊號</span><span class="val">${esc(sigText)}</span></div>
                <div class="detail-item"><span class="lbl">3期 Williams %R</span><span class="val">${esc(wr3Text)}</span></div>
                <div class="detail-item"><span class="lbl">隔日波動突破</span><span class="val">${esc(vbText)}</span></div>
                ${limitRow}
                ${stopRow}
                ${hintRow}
            </div>`;
    };

    window.updateWilliamsCounts = function (items, tfKey) {
        if (!Array.isArray(items)) return;
        const counts = { all: items.length, buy_any: 0, '重擊反殺': 0, '急殺撿鑽': 0, '跳空反轉': 0, '壓縮待爆': 0, '假突破避雷': 0 };
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const tech = it && it[tfKey];
            const sigs = getSignals(tech && tech.williams);
            if (!sigs.length) continue;
            if (sigs.some(s => BUY_SET.has(s))) counts.buy_any++;
            for (let j = 0; j < sigs.length; j++) {
                if (counts[sigs[j]] != null) counts[sigs[j]]++;
            }
        }
        document.querySelectorAll('.lw-pill').forEach(btn => {
            const val = btn.dataset.val;
            const base = btn.dataset.label;
            const cnt = counts[val];
            if (val === 'all') {
                btn.textContent = base;
            } else {
                btn.textContent = `${base} (${cnt || 0})`;
                // 美股不產生「假突破避雷」時淡化顯示但不破壞版面
                if (val === '假突破避雷') {
                    btn.style.display = cnt > 0 ? '' : 'none';
                }
            }
        });
    };

    function rerun() {
        if (typeof window.applyFilters === 'function') window.applyFilters();
    }

    function syncUI() {
        const valEl = document.getElementById('val-williams');
        if (valEl) {
            const found = OPTIONS.find(o => o.value === st.mode);
            valEl.textContent = found ? found.label : '全部';
        }
        document.querySelectorAll('.lw-pill').forEach(btn => {
            const val = btn.dataset.val;
            const on = val === st.mode;
            const m = META[val];
            if (on) {
                btn.style.background = m ? m.bg : 'rgba(249,115,22,0.24)';
                btn.style.borderColor = m ? m.border : '#fb923c';
                btn.style.color = m ? m.color : '#fdba74';
                btn.style.fontWeight = '700';
            } else {
                btn.style.background = 'transparent';
                btn.style.borderColor = 'rgba(255,255,255,0.18)';
                btn.style.color = 'inherit';
                btn.style.fontWeight = '400';
            }
        });
    }

    function build() {
        const grid = document.querySelector('.filter-grid');
        if (!grid || document.getElementById('williams-filter-group')) return;
        const box = document.createElement('div');
        box.id = 'williams-filter-group';
        box.className = 'filter-group lw-filter-group';
        box.style.gridColumn = '1 / -1';
        box.innerHTML = `
            <label>拉里·威廉斯雷達：<span id="val-williams" style="color:#fb923c;font-weight:700">全部</span>
                <span style="opacity:.6;font-size:11px">（跟著日線／1H 週期；2年台美實證保留正期望值訊號，可與三軍多方交集）</span></label>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
                ${OPTIONS.map(o => `<button type="button" class="lw-pill" data-val="${o.value}" data-label="${o.label}"
                    style="font-size:12px;padding:5px 11px;border-radius:99px;border:1px solid rgba(255,255,255,0.18);background:transparent;color:inherit;cursor:pointer;transition:all .15s">${o.label}</button>`).join('')}
            </div>`;
        grid.appendChild(box);

        box.querySelectorAll('.lw-pill').forEach(btn => btn.addEventListener('click', () => {
            const val = btn.dataset.val;
            st.mode = (st.mode === val && val !== 'all') ? 'all' : val;
            syncUI();
            rerun();
        }));
        syncUI();
    }

    // 快速篩選／全部重置：把威廉斯濾網歸回「全部」（capture 階段，早於各篩選器原本的處理）
    document.addEventListener('click', (e) => {
        const t = e.target.closest && e.target.closest('[id^="qf-"]');
        if (!t) return;
        st.mode = 'all';
        syncUI();
    }, true);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
