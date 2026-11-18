/**
 * 多檔走勢比較（獨立版，2026-11-18）
 * - 從看盤系統「📈 比較」分頁移植，計算方式完全相同；改為讀取每日預先準備的靜態資料（GitHub Pages）
 * - 2～6 檔（台股／美股／ETF／指數可混合）＋比較基準，週線、還原除權息，起點都換算成 0% 後重疊
 * - 每條線可個別勾選；勾選一改，走勢圖、統計、相關係數立刻重算
 * - 相關係數與 Beta 用「每週漲跌幅」計算，只取兩檔都有實際資料的週
 * 資料：../data/meta.json、../data/index.json、../data/w_XX.json
 */
(function () {
    if (window.__gated) return;

    const DATA = '../data/';
    const CFG_KEY = 'trend_cfg_v1';
    const COLORS = ['#f59e0b', '#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fb923c'];
    const BENCH_COLOR = '#cbd5e1';
    const RANGE_LABEL = { '1y': '近 1 年', '3y': '近 3 年', '5y': '近 5 年', '10y': '近 10 年', custom: '自訂' };
    const DEFAULT_CFG = { inputs: ['2330', '2317', '2303', '', '', ''], range: '3y', start: '2020-01-01', bench: 'INDEX:TWII', hidden: [] };
    const EXAMPLES = [
        { label: '半導體三雄', s: ['2330', '2454', '2303'] },
        { label: '台積電 vs 輝達', s: ['2330', 'NVDA'] },
        { label: '0050 vs 高股息', s: ['0050', '0056', '00878'] },
        { label: '台股 vs 美股 ETF', s: ['0050', 'VOO', 'QQQ'] },
        { label: 'AI 美股', s: ['NVDA', 'AMD', 'AVGO', 'MSFT'] },
        { label: '金融雙雄', s: ['2881', '2882', '2891'] },
    ];
    const ALIASES = {
        '加權': 'INDEX:TWII', '大盤': 'INDEX:TWII', '加權指數': 'INDEX:TWII', 'TAIEX': 'INDEX:TWII', '^TWII': 'INDEX:TWII',
        '櫃買': 'INDEX:TWOII', '櫃買指數': 'INDEX:TWOII', 'OTC': 'INDEX:TWOII',
        'S&P500': 'INDEX:SPX', 'S&P 500': 'INDEX:SPX', 'SP500': 'INDEX:SPX', '標普': 'INDEX:SPX', '標普500': 'INDEX:SPX', '^GSPC': 'INDEX:SPX',
        '那斯達克': 'INDEX:IXIC', 'NASDAQ': 'INDEX:IXIC', '^IXIC': 'INDEX:IXIC',
        '道瓊': 'INDEX:DJI', '^DJI': 'INDEX:DJI',
        '費半': 'INDEX:SOX', '費城半導體': 'INDEX:SOX', '^SOX': 'INDEX:SOX',
    };

    // ── 狀態 ──
    let meta = null, index = [], byKey = new Map(), byCode = new Map(), byName = new Map();
    const shardCache = new Map();
    let cfg = loadCfg();
    let lines = [];            // 目前載入的線
    let chart = null, seriesRefs = [];
    const isMobile = () => window.matchMedia('(max-width: 720px)').matches;

    // ── 小工具 ──
    const $ = id => document.getElementById(id);
    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    function std(a) {
        if (a.length < 2) return 0;
        const m = mean(a);
        return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
    }
    function pairStats(a, b) {
        const x = [], y = [];
        for (let i = 0; i < a.length; i++) if (a[i] != null && b[i] != null) { x.push(a[i]); y.push(b[i]); }
        if (x.length < 8) return { corr: null, beta: null, n: x.length };
        const mx = mean(x), my = mean(y);
        let cov = 0, vx = 0, vy = 0;
        for (let i = 0; i < x.length; i++) { cov += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; vy += (y[i] - my) ** 2; }
        return { corr: vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null, beta: vy > 0 ? cov / vy : null, n: x.length };
    }
    const weeklyReturns = a => a.map((v, i) => (i > 0 && v != null && a[i - 1] != null ? v / a[i - 1] - 1 : null));
    const pct = (v, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;
    const shortName = s => (s.length > 6 ? s.slice(0, 6) : s);
    const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function loadCfg() {
        let c = null;
        try { c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { /* 第一次 */ }
        c = Object.assign({}, DEFAULT_CFG, c || {});
        // 網址可帶入：#s=2330,NVDA&r=5y&b=INDEX:SPX
        const h = new URLSearchParams(location.hash.slice(1));
        if (h.get('s')) c.inputs = h.get('s').split(',');
        if (h.get('r') && RANGE_LABEL[h.get('r')]) c.range = h.get('r');
        if (h.get('b') !== null && h.get('b') !== undefined && h.has('b')) c.bench = h.get('b');
        if (h.get('d')) c.start = h.get('d');
        c.inputs = [...(c.inputs || []), '', '', '', '', '', ''].slice(0, 6);
        if (!Array.isArray(c.hidden)) c.hidden = [];
        return c;
    }
    function saveCfg() {
        localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
        const h = new URLSearchParams();
        h.set('s', cfg.inputs.filter(Boolean).join(','));
        h.set('r', cfg.range);
        h.set('b', cfg.bench);
        if (cfg.range === 'custom') h.set('d', cfg.start);
        history.replaceState(null, '', location.pathname + location.search + '#' + h.toString());
    }

    // ── 代號解析 ──
    function resolve(raw) {
        let s = (raw || '').trim();
        if (!s) return null;
        const up = s.toUpperCase();
        if (ALIASES[s] || ALIASES[up]) return byKey.get(ALIASES[s] || ALIASES[up]) || null;
        const first = up.split(/\s+/)[0];                 // 建議清單格式「2330 台積電」
        const pick = list => list.find(e => e[3].startsWith('台股')) || list[0];
        if (byCode.has(up)) return pick(byCode.get(up));
        if (byCode.has(first)) return pick(byCode.get(first));
        if (byName.has(s)) return byName.get(s);
        const hits = index.filter(e => e[2].includes(s) || e[2].toUpperCase().includes(up));
        if (hits.length) return hits.sort((a, b) => a[2].length - b[2].length)[0];
        return null;
    }

    function loadShard(n) {
        if (!shardCache.has(n)) {
            const p = fetch(`${DATA}w_${String(n).padStart(2, '0')}.json?v=${encodeURIComponent(meta.updated_at)}`, { cache: 'no-store' })
                .then(r => { if (!r.ok) throw new Error('shard ' + n); return r.json(); });
            p.catch(() => shardCache.delete(n));
            shardCache.set(n, p);
        }
        return shardCache.get(n);
    }

    async function seriesOf(entry) {
        const [key, code, name, mkt, shard, cur] = entry;
        const obj = (await loadShard(shard))[key];
        if (!obj) return null;
        const map = new Map();
        obj.c.forEach((v, i) => { if (v != null) map.set(addDays(meta.week0, (obj.s + i) * 7), v); });
        return { key, code, name, mkt, cur, map };
    }

    function rangeStart() {
        if (cfg.range === 'custom') return cfg.start || '2016-01-01';
        const yrs = { '1y': 1, '3y': 3, '5y': 5, '10y': 10 }[cfg.range] || 3;
        const d = new Date();
        d.setDate(d.getDate() - Math.round(yrs * 365.25));
        return d.toISOString().slice(0, 10);
    }

    // ── 載入（按更新、Enter、換期間、換基準） ──
    async function load() {
        const warn = [], picked = [];
        cfg.inputs.forEach((raw, i) => {
            if (!raw.trim()) return;
            const e = resolve(raw);
            if (!e) { warn.push(`找不到「${raw}」`); return; }
            if (e[6]) { warn.push(`${e[2]}（${e[1]}）資料暫缺，最新只到 ${e[7]}，暫不顯示`); return; }
            if (picked.some(p => p.entry[0] === e[0])) return;
            picked.push({ entry: e, color: COLORS[i % COLORS.length] });
        });
        if (!picked.length) { $('warn').textContent = warn.join('；') || '請至少輸入 1 檔股票'; lines = []; render(); return; }
        $('btn-go').disabled = true; $('btn-go').textContent = '讀取中…';
        try {
            const out = [];
            for (const p of picked) {
                const s = await seriesOf(p.entry);
                if (s) out.push(Object.assign(s, { color: p.color, isBench: false }));
                else warn.push(`${p.entry[2]} 沒有資料`);
            }
            const be = cfg.bench ? byKey.get(cfg.bench) : null;
            if (be && !picked.some(p => p.entry[0] === be[0])) {
                const s = await seriesOf(be);
                if (s) out.push(Object.assign(s, { color: BENCH_COLOR, isBench: true }));
            }
            lines = out;
        } catch (e) {
            warn.push('資料讀取失敗，請檢查網路後再按「更新」');
        } finally {
            $('btn-go').disabled = false; $('btn-go').textContent = '更新';
        }
        $('warn').textContent = warn.join('；');
        saveCfg();
        render();
    }

    // ── 依勾選計算：對齊、標準化、統計、相關係數 ──
    function calc() {
        const hidden = new Set(cfg.hidden);
        const cut = rangeStart();
        const visible = lines.filter(l => !hidden.has(l.key));
        if (!visible.length) return null;
        const dates = Array.from(new Set(visible.flatMap(l => Array.from(l.map.keys())))).filter(d => d >= cut).sort();
        const prepared = visible.map(l => {
            const actual = dates.map(d => (l.map.has(d) ? l.map.get(d) : null));
            const ff = []; let last = null;
            for (const v of actual) { if (v != null) last = v; ff.push(last); }
            return { l, actual, ff, first: actual.findIndex(v => v != null) };
        });
        if (prepared.some(p => p.first < 0)) return null;
        const startIdx = Math.max(...prepared.map(p => p.first));
        if (startIdx >= dates.length - 2) return null;
        const D = dates.slice(startIdx);
        const benchLine = lines.find(l => l.isBench) || null;
        const benchRet = benchLine ? weeklyReturns(D.map(d => (benchLine.map.has(d) ? benchLine.map.get(d) : null))) : null;

        const rows = prepared.map(p => {
            const a = p.actual.slice(startIdx);
            const f = p.ff.slice(startIdx);
            const norm = f.map(v => (v / f[0]) * 100);
            const rets = weeklyReturns(a);
            let peak = -Infinity, mdd = 0;
            for (const v of f) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
            const tp = !p.l.isBench && benchRet ? pairStats(rets, benchRet) : null;
            const weeks = D.length - 1;
            const growth = f[f.length - 1] / f[0];
            return {
                line: p.l, norm, rets,
                totalRet: (growth - 1) * 100,
                cagr: weeks >= 26 ? (Math.pow(growth, 52 / weeks) - 1) * 100 : null,
                vol: std(rets.filter(v => v != null)) * Math.sqrt(52) * 100,
                mdd: mdd * 100,
                beta: tp ? tp.beta : null,
                corrBench: tp ? tp.corr : null,
            };
        });
        const matrix = rows.map(r1 => rows.map(r2 => (r1 === r2 ? 1 : pairStats(r1.rets, r2.rets).corr)));
        return { D, rows, matrix, benchLine };
    }

    // ── 畫面 ──
    function ensureChart() {
        if (chart) return;
        const LC = window.LightweightCharts;
        chart = LC.createChart($('chart'), {
            autoSize: true,
            layout: { background: { type: LC.ColorType.Solid, color: 'transparent' }, textColor: 'rgba(255,255,255,0.65)', fontSize: isMobile() ? 10 : 12 },
            grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
            rightPriceScale: { borderColor: 'rgba(255,255,255,0.12)' },
            timeScale: { borderColor: 'rgba(255,255,255,0.12)' },
            localization: {
                locale: 'zh-TW',
                priceFormatter: p => { const v = p - 100; return `${v >= 0 ? '+' : ''}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`; },
            },
            handleScroll: !isMobile(),
            handleScale: !isMobile(),
        });
    }

    function render() {
        const LC = window.LightweightCharts;
        const hidden = new Set(cfg.hidden);
        const c = calc();

        // 勾選按鈕
        $('chips').innerHTML = lines.map(l => {
            const on = !hidden.has(l.key);
            const r = c && c.rows.find(x => x.line.key === l.key);
            return `<button class="chip ${on ? '' : 'off'}" data-key="${esc(l.key)}" style="border-color:${on ? l.color : 'rgba(255,255,255,0.12)'}">
                <span class="sw" style="background:${on ? l.color : 'transparent'};border:2px solid ${l.color}"></span>
                <b>${esc(l.name)}</b>${l.isBench ? '<span style="opacity:.6">（基準）</span>' : ''}
                ${on && r ? `<span class="${r.totalRet >= 0 ? 'pos' : 'neg'}">${pct(r.totalRet, 0)}</span>` : ''}</button>`;
        }).join('');

        // 走勢圖
        ensureChart();
        seriesRefs.forEach(s => chart.removeSeries(s));
        seriesRefs = [];
        $('chart-empty').textContent = !lines.length ? '輸入股票後按「更新」' : (c ? '' : '請至少勾選 1 條線，或選擇較長的期間');
        if (c) {
            c.rows.forEach((r, idx) => {
                const s = chart.addLineSeries({
                    color: r.line.color,
                    lineWidth: r.line.isBench ? 2 : (isMobile() ? 2 : 3),
                    lineStyle: r.line.isBench ? LC.LineStyle.Dashed : LC.LineStyle.Solid,
                    title: isMobile() ? '' : shortName(r.line.name),
                    priceLineVisible: false,
                });
                s.setData(c.D.map((d, i) => ({ time: d, value: r.norm[i] })));
                if (idx === 0) s.createPriceLine({ price: 100, color: 'rgba(255,255,255,0.35)', lineWidth: 1, lineStyle: LC.LineStyle.Dotted, axisLabelVisible: false, title: '' });
                seriesRefs.push(s);
            });
            chart.timeScale().fitContent();
            const mixed = new Set(c.rows.filter(r => r.line.cur !== 'PT').map(r => r.line.cur)).size > 1;
            $('period').textContent = `起點 ${c.D[0]}（所有勾選標的都有資料的第一週）～ ${c.D[c.D.length - 1]}，共 ${c.D.length} 週` +
                (mixed ? '；台股以新台幣、美股以美元計算報酬（未換匯）' : '');
        } else {
            $('period').textContent = '';
        }

        // 統計表
        $('stats-panel').hidden = !c;
        if (c) {
            const bName = c.benchLine ? c.benchLine.name : '基準';
            $('stats').innerHTML = `<thead><tr><th>標的</th><th>區間報酬</th><th>年化報酬</th><th>年化波動</th><th>最大回檔</th><th>Beta</th><th class="col-corr-bench">與${esc(shortName(bName))}相關</th></tr></thead><tbody>` +
                c.rows.map(r => `<tr>
                    <td><span style="color:${r.line.color}">●</span> ${esc(isMobile() ? shortName(r.line.name) : r.line.name)} <span style="opacity:.45;font-size:11px">${esc(r.line.code)}</span></td>
                    <td class="${r.totalRet >= 0 ? 'pos' : 'neg'}">${pct(r.totalRet)}</td>
                    <td class="${r.cagr == null ? '' : r.cagr >= 0 ? 'pos' : 'neg'}">${r.cagr == null ? '—' : pct(r.cagr)}</td>
                    <td>${r.vol.toFixed(1)}%</td>
                    <td class="neg">${r.mdd.toFixed(1)}%</td>
                    <td>${r.line.isBench ? '1.00' : r.beta != null ? r.beta.toFixed(2) : '—'}</td>
                    <td class="col-corr-bench">${r.line.isBench ? '—' : r.corrBench != null ? r.corrBench.toFixed(2) : '—'}</td></tr>`).join('') + '</tbody>';
        }

        // 相關係數
        $('corr-panel').hidden = !(c && c.rows.length >= 2);
        if (c && c.rows.length >= 2) {
            $('corr').innerHTML = `<thead><tr><th></th>${c.rows.map(r => `<th style="color:${r.line.color}">${esc(shortName(r.line.name))}</th>`).join('')}</tr></thead><tbody>` +
                c.rows.map((r, i) => `<tr><td style="color:${r.line.color}">${esc(shortName(r.line.name))}</td>${c.matrix[i].map((v, j) =>
                    `<td style="background:${corrBg(v, i === j)};opacity:${i === j ? 0.4 : 1};font-weight:${i === j ? 400 : 700}">${v == null ? '—' : v.toFixed(2)}</td>`).join('')}</tr>`).join('') + '</tbody>';
        }
    }

    function corrBg(v, diag) {
        if (v == null || diag) return 'transparent';
        const a = Math.min(Math.abs(v), 1) * 0.55;
        return v >= 0 ? `rgba(239,68,68,${a})` : `rgba(34,197,94,${a})`;
    }

    // ── 輸入區 ──
    function buildInputs() {
        $('inputs').innerHTML = cfg.inputs.map((v, i) =>
            `<input data-i="${i}" list="sym-list" value="${esc(v)}" placeholder="第 ${i + 1} 檔" autocomplete="off" style="border-color:${v ? COLORS[i] + '99' : 'rgba(255,255,255,0.15)'}">`).join('');
        document.querySelectorAll('#ranges button').forEach(b => b.classList.toggle('on', b.dataset.r === cfg.range));
        $('start-date').classList.toggle('hidden', cfg.range !== 'custom');
        $('start-date').value = cfg.start;
        $('bench').value = cfg.bench;
    }
    function readInputs() {
        cfg.inputs = Array.from(document.querySelectorAll('#inputs input')).map(x => x.value.trim());
    }

    function bind() {
        $('inputs').addEventListener('keydown', e => { if (e.key === 'Enter') { e.target.blur(); readInputs(); buildInputs(); load(); } });
        $('inputs').addEventListener('input', e => {
            const i = +e.target.dataset.i;
            e.target.style.borderColor = e.target.value ? COLORS[i] + '99' : 'rgba(255,255,255,0.15)';
        });
        $('btn-go').addEventListener('click', () => { readInputs(); buildInputs(); load(); });
        $('ranges').addEventListener('click', e => {
            const r = e.target.dataset && e.target.dataset.r;
            if (!r) return;
            cfg.range = r; readInputs(); buildInputs();
            if (r !== 'custom') { saveCfg(); render(); }
        });
        $('start-date').addEventListener('change', e => { cfg.start = e.target.value; saveCfg(); render(); });
        $('bench').addEventListener('change', e => { cfg.bench = e.target.value; readInputs(); load(); });
        $('chips').addEventListener('click', e => {
            const b = e.target.closest('.chip');
            if (!b) return;
            const k = b.dataset.key;
            cfg.hidden = cfg.hidden.includes(k) ? cfg.hidden.filter(x => x !== k) : [...cfg.hidden, k];
            saveCfg(); render();
        });
        $('examples').innerHTML = EXAMPLES.filter(ex => ex.s.every(s => resolve(s))).map((ex, i) =>
            `<button data-ex="${i}">${esc(ex.label)}</button>`).join('');
        $('examples').addEventListener('click', e => {
            const i = e.target.dataset && e.target.dataset.ex;
            if (i == null) return;
            cfg.inputs = [...EXAMPLES[+i].s, '', '', '', '', '', ''].slice(0, 6);
            cfg.hidden = [];
            if (EXAMPLES[+i].s.every(s => { const e2 = resolve(s); return e2 && e2[3].startsWith('美股'); })) cfg.bench = 'INDEX:SPX';
            buildInputs(); load();
        });
    }

    // ── 啟動 ──
    async function init() {
        try {
            meta = await (await fetch(`${DATA}meta.json?t=${Date.now()}`, { cache: 'no-store' })).json();
            index = await (await fetch(`${DATA}index.json?v=${encodeURIComponent(meta.updated_at)}`, { cache: 'no-store' })).json();
        } catch (e) {
            $('warn').textContent = '資料讀取失敗，請稍後重新整理頁面';
            return;
        }
        index.forEach(e => {
            byKey.set(e[0], e);
            const code = String(e[1]).toUpperCase();
            if (!byCode.has(code)) byCode.set(code, []);
            byCode.get(code).push(e);
            if (!byName.has(e[2])) byName.set(e[2], e);
        });
        $('upd').textContent = new Date(meta.updated_at).toLocaleString('zh-TW', { hour12: false }).replace(/:\d\d$/, '');
        $('cnt').textContent = meta.count.toLocaleString();
        $('hdr-count').textContent = (Math.floor(meta.count / 100) * 100).toLocaleString() + '+';
        $('sym-list').innerHTML = index.filter(e => !e[6]).map(e => `<option value="${esc(e[1] + ' ' + e[2])}">${esc(e[3])}</option>`).join('');
        buildInputs();
        bind();
        window.addEventListener('resize', () => { if (chart) chart.timeScale().fitContent(); });
        load();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
