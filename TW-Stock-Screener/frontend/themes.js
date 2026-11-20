/**
 * 主題族群快速篩選（2026-11-20）
 * 影片第 3 集「AI 四大賽道」：點一下只顯示該賽道的成分股，可再疊加四因子、三軍、RSI 等條件。
 * 修改成分股：直接改下面的 codes 清單即可（只放台股代號）。
 */
(function () {
    window.TW_THEMES = [
        {
            id: 'cowos', no: '01', color: '#22d3ee',
            title: '先進製程與 CoWoS 封測總咽喉',
            kpi: 'CoWoS 產能稼動率、長約排程至 2027',
            group: '晶圓代工與先進封測類股',
            codes: ['2330', '3711', '2449', '6239', '3374', '8046', '3037', '3189', '3131', '6187',
                    '3583', '6640', '2467', '3680', '1560', '6515', '6223', '2360', '5443'],
        },
        {
            id: 'ccl', no: '02', color: '#fbbf24',
            title: '高階 M8 銅箔基板與伺服器 PCB',
            kpi: '高階高速材料市佔率、毛利率逐季創高',
            group: '高階銅箔基板與伺服器板類股',
            codes: ['2383', '6213', '6274', '2368', '3044', '2313', '8358', '4958', '6191', '5469',
                    '1815', '1802', '4927'],
        },
        {
            id: 'cooling', no: '03', color: '#34d399',
            title: '液冷散熱模組與高壓伺服器電源',
            kpi: '單櫃瓦數翻倍升級、水冷板與高壓電源單價',
            group: '高壓電源與液冷散熱模組類股',
            codes: ['2308', '3017', '3324', '2301', '6230', '8996', '3653', '2421', '6282', '3015',
                    '3483', '6125'],
        },
        {
            id: 'rack', no: '04', color: '#a78bfa',
            title: 'AI 整櫃系統 Co-design 與 TPU 設計',
            kpi: '四大美系雲端廠直供比重、自研 ASIC 專案數',
            group: 'AI 整櫃代工與自研晶片設計類股',
            codes: ['2317', '2382', '6669', '3231', '2356', '2376', '3706', '2454', '3443', '3661',
                    '3035', '6643', '2059', '8210'],
        },
    ];

    const st = { id: '' };
    const sets = {};
    window.TW_THEMES.forEach(t => { sets[t.id] = new Set(t.codes); });

    // 各篩選器 applyFilters 內呼叫：沒選賽道時全部保留
    window.themePass = function (symbol) {
        if (!st.id) return true;
        return sets[st.id] ? sets[st.id].has(String(symbol)) : true;
    };

    function render() {
        document.querySelectorAll('.theme-btn').forEach(b => {
            const t = window.TW_THEMES.find(x => x.id === b.dataset.id);
            const on = st.id === t.id;
            b.style.background = on ? t.color : 'rgba(255,255,255,0.04)';
            b.style.color = on ? '#0b1220' : '#e5e7eb';
            b.style.borderColor = t.color;
        });
        const bn = document.getElementById('theme-banner');
        if (!bn) return;
        const t = window.TW_THEMES.find(x => x.id === st.id);
        if (!t) { bn.style.display = 'none'; bn.innerHTML = ''; return; }
        bn.style.display = 'block';
        bn.style.borderColor = t.color;
        bn.innerHTML = `<div style="font-weight:700;color:${t.color}">賽道 ${t.no}｜${t.title}</div>
            <div style="margin-top:3px">核心指標：${t.kpi}</div>
            <div style="opacity:.75">代表族群：${t.group}（共 ${t.codes.length} 檔，可再搭配上方滑桿或三軍、RSI 條件縮小範圍）</div>
            <button type="button" id="theme-clear" style="margin-top:6px;font-size:12px;padding:3px 10px;border-radius:99px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;cursor:pointer">✕ 取消賽道，看全部股票</button>`;
        document.getElementById('theme-clear').onclick = () => { st.id = ''; render(); if (window.applyFilters) window.applyFilters(); };
    }

    function build() {
        const anchor = document.querySelector('.filters-section .section-header');
        if (!anchor || document.getElementById('theme-filters')) return;
        const box = document.createElement('div');
        box.id = 'theme-filters';
        box.style.cssText = 'margin:4px 0 12px;';
        box.innerHTML = `
            <div style="font-size:12px;opacity:.75;margin-bottom:6px">🎬 影片第 3 集｜AI 四大賽道（點一下只看該族群）</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px">
                ${window.TW_THEMES.map(t => `<button type="button" class="theme-btn" data-id="${t.id}"
                    style="text-align:left;padding:8px 10px;border-radius:8px;border:1px solid ${t.color};background:rgba(255,255,255,0.04);color:#e5e7eb;cursor:pointer;line-height:1.35">
                    <span style="font-size:11px;font-weight:700;opacity:.85">賽道 ${t.no}</span><br>
                    <span style="font-size:13px;font-weight:700">${t.title}</span></button>`).join('')}
            </div>
            <div id="theme-banner" style="display:none;margin-top:8px;padding:8px 10px;border-radius:8px;border:1px solid;background:rgba(255,255,255,0.03);font-size:12.5px;line-height:1.6"></div>`;
        anchor.insertAdjacentElement('afterend', box);
        box.querySelectorAll('.theme-btn').forEach(b => b.addEventListener('click', () => {
            const id = b.dataset.id;
            const again = st.id === id;
            // 先用原本的「全部重置」清掉其他條件，再套用賽道
            const reset = document.getElementById('qf-reset');
            if (reset) reset.click();
            st.id = again ? '' : id;
            render();
            if (window.applyFilters) window.applyFilters();
            const tbl = document.querySelector('.table-section');
            if (st.id && tbl && window.innerWidth < 720) tbl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
        render();
    }

    // 按其他快速篩選或全部重置：取消賽道
    document.addEventListener('click', e => {
        if (e.isTrusted && e.target.closest && e.target.closest('[id^="qf-"]')) { st.id = ''; render(); }
    }, true);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
