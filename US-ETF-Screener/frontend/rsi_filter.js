/**
 * RSI(14) 範圍篩選（四大篩選器共用，2026-11-19）
 * - 在「篩選條件」區塊加上 RSI 最低／最高兩條滑桿＋快速按鈕（超賣、中性、過熱）
 * - RSI 跟著「日線／1H」週期切換（各篩選器 applyFilters 內用 window.rsiPass 判斷）
 * - 按任何快速篩選或「全部重置」時，RSI 範圍回到 0～100
 */
(function () {
    const st = { min: 0, max: 100 };
    window.RSI_FILTER = st;

    // 回傳 true = 保留。範圍是 0～100（未設定）時全部保留，包含沒有 RSI 資料的標的
    window.rsiPass = function (v) {
        if (st.min <= 0 && st.max >= 100) return true;
        if (v == null || isNaN(v)) return false;
        return v >= st.min && v <= st.max;
    };

    const PRESETS = [
        { label: '超賣 <30', min: 0, max: 30 },
        { label: '偏弱 30–50', min: 30, max: 50 },
        { label: '偏強 50–70', min: 50, max: 70 },
        { label: '過熱 >70', min: 70, max: 100 },
        { label: '不限', min: 0, max: 100 },
    ];

    function rerun() {
        if (typeof window.applyFilters === 'function') window.applyFilters();
    }

    function syncUI() {
        const a = document.getElementById('filter-rsi-min');
        const b = document.getElementById('filter-rsi-max');
        if (!a || !b) return;
        a.value = st.min; b.value = st.max;
        document.getElementById('val-rsi').textContent = (st.min <= 0 && st.max >= 100) ? '不限' : `${st.min}～${st.max}`;
        document.querySelectorAll('.rsi-preset').forEach(btn => {
            const on = +btn.dataset.min === st.min && +btn.dataset.max === st.max;
            btn.style.background = on ? 'rgba(56,189,248,0.22)' : 'transparent';
            btn.style.borderColor = on ? '#38bdf8' : 'rgba(255,255,255,0.18)';
            btn.style.color = on ? '#7dd3fc' : 'inherit';
        });
    }

    function build() {
        const grid = document.querySelector('.filter-grid');
        if (!grid || document.getElementById('filter-rsi-min')) return;
        const box = document.createElement('div');
        box.className = 'filter-group rsi-filter-group';
        box.style.gridColumn = '1 / -1';
        box.innerHTML = `
            <label>RSI(14) 範圍：<span id="val-rsi" style="color:#fcd34d;font-weight:700">不限</span>
                <span style="opacity:.6;font-size:11px">（跟著日線／1H 週期；30 以下常稱超賣、70 以上常稱過熱）</span></label>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 16px">
                <div style="display:flex;gap:10px;align-items:center">
                    <span style="font-size:12px;opacity:.75;white-space:nowrap;width:28px">最低</span>
                    <input type="range" id="filter-rsi-min" min="0" max="100" value="0" style="flex:1;min-width:0">
                </div>
                <div style="display:flex;gap:10px;align-items:center">
                    <span style="font-size:12px;opacity:.75;white-space:nowrap;width:28px">最高</span>
                    <input type="range" id="filter-rsi-max" min="0" max="100" value="100" style="flex:1;min-width:0">
                </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px">
                ${PRESETS.map(p => `<button type="button" class="rsi-preset" data-min="${p.min}" data-max="${p.max}"
                    style="font-size:12px;padding:4px 10px;border-radius:99px;border:1px solid rgba(255,255,255,0.18);background:transparent;color:inherit;cursor:pointer">${p.label}</button>`).join('')}
            </div>`;
        grid.appendChild(box);

        let timer = null;
        const onSlide = (which) => (e) => {
            let v = parseInt(e.target.value, 10);
            if (which === 'min') { st.min = Math.min(v, st.max); } else { st.max = Math.max(v, st.min); }
            syncUI();
            clearTimeout(timer);
            timer = setTimeout(rerun, 150);
        };
        document.getElementById('filter-rsi-min').addEventListener('input', onSlide('min'));
        document.getElementById('filter-rsi-max').addEventListener('input', onSlide('max'));
        box.querySelectorAll('.rsi-preset').forEach(btn => btn.addEventListener('click', () => {
            st.min = +btn.dataset.min; st.max = +btn.dataset.max;
            syncUI(); rerun();
        }));
        syncUI();
    }

    // 快速篩選／全部重置：先把 RSI 歸零（capture 階段，早於各篩選器原本的處理）
    document.addEventListener('click', (e) => {
        const t = e.target.closest && e.target.closest('[id^="qf-"]');
        if (!t) return;
        st.min = 0; st.max = 100;
        syncUI();
    }, true);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
