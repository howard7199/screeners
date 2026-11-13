/* ==========================================================================
   投資組合風控中心 | Portfolio Risk Control Center (app.js)
   - AI 風控核心戰情板（勝率滑桿、100萬分5檔、單筆 2% 停損、風報比、10筆期望值對決）
   - 下單前 10 秒部位反推試算表 & 買進前必問 3 題
   - 自選股票、產業類別配置、金額微調、買入時間歷史回溯、相關係數矩陣、壓力測試、10條紀律鐵則
   ========================================================================== */

const STORAGE_KEY = 'antigravity_risk_control_v2';

const CUSTOM_SECTORS = [
    '核心權值', 'AI 與算力', '高股息防禦', '債券避險', '波段成長', '景氣循環', '現金替代'
];

const appState = {
    universe: [],
    stockMap: new Map(),
    symbolLookup: new Map(),
    sectors: [],
    context: null,
    historyTW: null,
    historyUS: null,
    historyReady: false,

    // Risk Configuration (預設：100萬本金、5檔分倉上限20%、單筆 2.0% 停損、勝率70%)
    config: {
        preset: 'video',
        disciplineMode: false,
        winRate: 70,
        totalCapital: 1000000,
        fxRate: 32.90,
        minCashPct: 15,
        maxStockPct: 20,      // 100% / 5 檔 = 單檔上限 20%
        maxSectorPct: 35,
        riskPerTradePct: 2.0, // 華爾街單筆 2% 保命鐵律 ($20,000)
        stopMode: 'fixed',    // fixed | atr | trailing | ma20 | ma60 | turtle
        stopParam: 8,         // 預設 -8% 技術停損，搭配 +28%~+30% 波段停利達成 > 1:3 風報比
        tpPct: 30,
        defaultBuyDate: '',
        entryMode: 'lump',
        fxManual: false,      // 使用者手動調整過匯率才保留，否則每次開啟自動帶入最新匯率
    },

    // 10-Second Pre-Trade Position Sizing Calculator State (預設範例：110買/100停損/145目標)
    calc: {
        pickedStockId: null,
        entryPrice: 110,
        stopPrice: 100,
        targetPrice: 145,
    },

    // User Portfolio Holdings
    holdings: [],

    // Stock Picker UI State
    picker: {
        market: 'ALL',
        sector: 'ALL',
        riskLevel: 'ALL',
        army: 'ALL',
        search: '',
        sort: 'sharpe_desc',
        page: 1,
        pageSize: 25,
        collapsed: false,
        filtered: [],
    },

    chartMode: 'actual',
};

// ==================== Formatting & Color Helpers ====================
const fmtInt = (n) => (n != null && !isNaN(n)) ? Math.round(Number(n)).toLocaleString('zh-TW') : '--';
const fmtNum = (n, d = 2) => (n != null && !isNaN(n)) ? Number(n).toFixed(d) : '--';
const fmtMoney = (n) => (n != null && !isNaN(n)) ? `NT$ ${Math.round(Number(n)).toLocaleString('zh-TW')}` : '--';

function fmtCompactTWD(n) {
    if (n == null || isNaN(n)) return '--';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(2)} 億`;
    if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)} 萬`;
    return `${sign}${Math.round(abs).toLocaleString('zh-TW')}`;
}

function getRiskColor(score) {
    if (score == null) return 'var(--text-secondary)';
    if (score <= 30) return '#22c55e';
    if (score <= 50) return '#84cc16';
    if (score <= 68) return '#eab308';
    if (score <= 82) return '#f97316';
    return '#ef4444';
}

function getRiskLabel(score) {
    if (score == null) return '--';
    if (score <= 28) return '🟢 低波穩健';
    if (score <= 50) return '🟢 風險適中';
    if (score <= 68) return '🟡 積極偏高';
    if (score <= 82) return '🟠 高風險警戒';
    return '🔴 極度危險';
}

function getTempColor(val) {
    if (val == null) return 'var(--text-secondary)';
    const hue = Math.max(0, Math.min(240, (100 - val) * 2.2));
    return `hsl(${hue}, 90%, 55%)`;
}

function debounce(fn, ms) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

function toLocalDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getOffsetDateStr(offsetOrType) {
    const now = new Date();
    if (offsetOrType === 'ytd') {
        return `${now.getFullYear()}-01-02`;
    }
    const d = new Date(now.getTime() - Number(offsetOrType || 0) * 86400000);
    return toLocalDateStr(d);
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 頁面頂部狀態列（資料載入失敗、資料過期、持股已下市等提示）
function showStatus(html, level = 'warn') {
    const el = document.getElementById('app-status-banner');
    if (!el) return;
    if (!html) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.className = `app-status-banner status-${level}`;
    el.innerHTML = html;
    el.style.display = 'flex';
}

// ==================== Input Sanitizing (localStorage / 匯入檔案) ====================
const CONFIG_LIMITS = {
    winRate:         [30, 90, 70],
    totalCapital:    [10000, 1e10, 1000000],
    fxRate:          [20, 50, 32.9],
    minCashPct:      [0, 80, 15],
    maxStockPct:     [5, 100, 20],
    maxSectorPct:    [10, 100, 35],
    riskPerTradePct: [0.25, 5, 2.0],
    stopParam:       [0.5, 30, 8],
    tpPct:           [5, 200, 30],
};
const VALID_STOP_MODES = ['fixed', 'atr', 'trailing', 'ma20', 'ma60', 'turtle'];
const VALID_ENTRY_MODES = ['lump', 'pyramid3', 'dca4'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeConfig(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.entries(CONFIG_LIMITS).forEach(([k, [lo, hi]]) => {
        if (raw[k] === undefined) return;
        const v = Number(raw[k]);
        if (Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
    });
    if (VALID_STOP_MODES.includes(raw.stopMode)) out.stopMode = raw.stopMode;
    if (VALID_ENTRY_MODES.includes(raw.entryMode)) out.entryMode = raw.entryMode;
    if (typeof raw.preset === 'string') out.preset = raw.preset.slice(0, 20);
    if (typeof raw.disciplineMode === 'boolean') out.disciplineMode = raw.disciplineMode;
    if (typeof raw.fxManual === 'boolean') out.fxManual = raw.fxManual;
    if (typeof raw.defaultBuyDate === 'string' && DATE_RE.test(raw.defaultBuyDate)) out.defaultBuyDate = raw.defaultBuyDate;
    return out;
}

function sanitizeHoldings(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const posNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
    return raw
        .filter(h => h && typeof h.id === 'string' && /^(TW|US):[A-Za-z0-9.\-]{1,15}$/.test(h.id))
        .filter(h => { if (seen.has(h.id)) return false; seen.add(h.id); return true; })
        .slice(0, 60)
        .map(h => ({
            id: h.id,
            symbol: String(h.symbol || h.id.split(':')[1]).slice(0, 15),
            market: String(h.market || '').slice(0, 12),
            customSector: typeof h.customSector === 'string' ? h.customSector.replace(/[<>"'&`]/g, '').trim().slice(0, 30) : '',
            buyDate: (typeof h.buyDate === 'string' && DATE_RE.test(h.buyDate)) ? h.buyDate : '',
            costPrice: posNum(h.costPrice),
            customCost: Boolean(h.customCost),
            customStopPrice: posNum(h.customStopPrice),
            customTargetPrice: posNum(h.customTargetPrice),
            amountTWD: Math.min(1e10, Math.max(0, Number(h.amountTWD) || 0)),
            openDetail: false,
        }));
}

// ==================== Initialization ====================
async function init() {
    if (window.__RC_GATED__ || !document.getElementById('hud-winrate-val')) return;
    appState.config.defaultBuyDate = getOffsetDateStr(90);
    loadSavedState();

    const t = Date.now();
    let loadError = null;
    try {
        const [uRes, cRes] = await Promise.all([
            fetch(`../backend/output/risk_universe.json?t=${t}`),
            fetch(`../backend/output/market_context.json?t=${t}`),
        ]);

        if (!uRes.ok) throw new Error(`HTTP ${uRes.status}`);
        const uJson = await uRes.json();
        appState.universe = Array.isArray(uJson.stocks) ? uJson.stocks : [];
        appState.sectors = uJson.sectors || [];
        if (!appState.universe.length) throw new Error('標的清單為空');

        // 匯率：使用者沒有手動調整過，就一律帶入最新匯率
        if (!appState.config.fxManual && Number(uJson.usd_twd) > 20) {
            appState.config.fxRate = Number(uJson.usd_twd);
        }
        if (uJson.updated_at) {
            const upd = new Date(uJson.updated_at);
            document.getElementById('update-time').textContent = upd.toLocaleString('zh-TW', { hour12: false });
            const ageDays = (Date.now() - upd.getTime()) / 86400000;
            if (ageDays > 4) {
                showStatus(`⚠️ 行情資料最後更新於 <b>${toLocalDateStr(upd)}</b>（已超過 ${Math.floor(ageDays)} 天），股價與技術指標可能不是最新，試算結果僅供參考。`, 'warn');
            }
        }
        document.getElementById('stock-count').textContent = `${uJson.total_count || appState.universe.length} 檔`;

        if (cRes.ok) {
            appState.context = await cRes.json();
        }
    } catch (err) {
        loadError = err;
        console.error('載入風控基礎資料失敗:', err);
    }

    if (loadError) {
        showStatus(`❌ 行情資料載入失敗（${escapeHtml(loadError.message || '網路異常')}），目前僅能使用「10 秒試算表」手動輸入功能。
            <button class="btn btn-xs" onclick="location.reload()">🔄 重新載入</button>`, 'error');
    }

    appState.universe.forEach(s => {
        appState.stockMap.set(s.id, s);
        if (!appState.symbolLookup.has(s.symbol)) {
            appState.symbolLookup.set(s.symbol, s);
        }
    });

    // 已儲存的持股若在最新資料中找不到（下市、更名、轉板），提示並移除，避免「看不到又刪不掉」
    if (appState.universe.length && appState.holdings.length) {
        const missing = appState.holdings.filter(h => !appState.stockMap.has(h.id));
        if (missing.length) {
            appState.holdings = appState.holdings.filter(h => appState.stockMap.has(h.id));
            showStatus(`ℹ️ 您先前儲存的 <b>${missing.map(h => escapeHtml(h.symbol || h.id)).join('、')}</b> 已不在最新資料中（可能下市、轉板或暫停交易），已自動從投組移除。`, 'info');
        }
    }

    if (appState.holdings.length === 0 && appState.universe.length > 0 && !localStorage.getItem(STORAGE_KEY)) {
        loadDemoPortfolio('tw', false);
    }

    syncConfigInputs();
    setupEventListeners();
    renderMarketTemps();
    renderTenSecCalculator();
    applyPickerFilters();
    refreshAllRiskViews();

    if (appState.universe.length) loadHistoryFiles(t);
}

async function loadHistoryFiles(cacheBust) {
    const statusEl = document.getElementById('history-load-status');
    try {
        const [twRes, usRes] = await Promise.all([
            fetch(`../backend/output/history_tw.json?t=${cacheBust}`),
            fetch(`../backend/output/history_us.json?t=${cacheBust}`),
        ]);
        if (twRes.ok) appState.historyTW = await twRes.json();
        if (usRes.ok) appState.historyUS = await usRes.json();
        if (!appState.historyTW && !appState.historyUS) throw new Error('history unavailable');
        appState.historyReady = true;
        if (statusEl) {
            const twLen = appState.historyTW?.dates?.length || 0;
            statusEl.textContent = `已載入近 ${twLen} 交易日`;
        }
        applyDateInputBounds();

        appState.holdings.forEach(h => {
            const st = appState.stockMap.get(h.id);
            if (st && !h.customCost) {
                const hs = lookupHistoricalStats(st, h.buyDate);
                if (hs && hs.entryClose > 0) {
                    h.costPrice = hs.entryClose;
                }
            }
        });
        refreshAllRiskViews();
    } catch (e) {
        console.warn('歷史時序載入失敗:', e);
        if (statusEl) statusEl.textContent = '歷史資料載入失敗，僅使用即時指標';
        appState.historyReady = false;
        refreshAllRiskViews();
    }
}

// 買入日期只能選在歷史資料範圍內（最早可回溯日 ~ 最新交易日）
function applyDateInputBounds() {
    const tw = appState.historyTW?.dates || [];
    const us = appState.historyUS?.dates || [];
    const firsts = [tw[0], us[0]].filter(Boolean).sort();
    const minD = firsts[0] || '';
    const maxD = toLocalDateStr(new Date());
    appState.dateBounds = { min: minD, max: maxD };
    document.querySelectorAll('input[type="date"]').forEach(el => {
        if (minD) el.min = minD;
        el.max = maxD;
    });
}

// ==================== Historical Price & Series Lookup ====================
function getHistoryPack(market) {
    return market.startsWith('US') ? appState.historyUS : appState.historyTW;
}

function lookupHistoricalStats(stock, buyDateStr) {
    const pack = getHistoryPack(stock.market);
    if (!pack || !pack.dates || !pack.prices) return null;
    const arr = pack.prices[stock.symbol];
    if (!arr || !arr.length) return null;

    const dates = pack.dates;
    const target = buyDateStr || dates[dates.length - 1];

    let idx = dates.findIndex((d, i) => d >= target && arr[i] != null);
    if (idx === -1) {
        if (target > dates[dates.length - 1]) {
            for (let i = dates.length - 1; i >= 0; i--) {
                if (arr[i] != null) { idx = i; break; }
            }
        } else {
            idx = arr.findIndex(v => v != null);
        }
    }
    if (idx === -1) return null;

    const entryClose = arr[idx];
    let highSince = entryClose;
    let lowSince = entryClose;
    let peak = entryClose;
    let mddSince = 0;

    for (let i = idx; i < arr.length; i++) {
        const p = arr[i];
        if (p == null) continue;
        if (p > highSince) highSince = p;
        if (p < lowSince) lowSince = p;
        if (p > peak) peak = p;
        const dd = (p / peak - 1) * 100;
        if (dd < mddSince) mddSince = dd;
    }

    const dStart = new Date(dates[idx]);
    const dEnd = new Date(dates[dates.length - 1]);
    const holdingDays = Math.max(0, Math.round((dEnd - dStart) / 86400000));

    return {
        actualDate: dates[idx],
        idx,
        entryClose,
        highSince,
        lowSince,
        mddSince: Number(mddSince.toFixed(2)),
        holdingDays,
    };
}

function getDailyReturnMap(stock, maxDays = 252) {
    const pack = getHistoryPack(stock.market);
    if (!pack || !pack.dates || !pack.prices) return null;
    const arr = pack.prices[stock.symbol];
    if (!arr) return null;

    const dates = pack.dates;
    const start = Math.max(1, arr.length - maxDays);
    const map = new Map();
    for (let i = start; i < arr.length; i++) {
        const prev = arr[i - 1];
        const curr = arr[i];
        if (prev != null && curr != null && prev > 0) {
            const r = curr / prev - 1;
            if (Math.abs(r) < 0.75 || stock.is_leveraged) {
                map.set(dates[i], r);
            }
        }
    }
    return map;
}

// ==================== 10-Second Position Sizing Calculator ====================
// 試算表與「加入投組」共用同一套部位計算，避免顯示與實際加入的金額不一致
function computeCalcSizing() {
    const cfg = appState.config;
    const c = appState.calc;
    const st = c.pickedStockId ? appState.stockMap.get(c.pickedStockId) : null;
    const isUSD = st?.currency === 'USD';
    const fx = isUSD ? cfg.fxRate : 1.0;
    const cap = Math.max(10000, Number(cfg.totalCapital || 1000000));
    const entry = Math.max(0.01, Number(c.entryPrice || 0));
    const stop = Math.max(0.01, Number(c.stopPrice || 0));
    const target = Math.max(0.01, Number(c.targetPrice || 0));
    const validStop = stop < entry;
    const diffPerShare = validStop ? (entry - stop) : 0;
    const maxAllowedLossTWD = cap * (cfg.riskPerTradePct / 100);
    const rawSafeShares = (validStop && diffPerShare > 0) ? Math.floor(maxAllowedLossTWD / (diffPerShare * fx)) : 0;
    const rawSafeCapitalTWD = rawSafeShares * entry * fx;
    const slotCapTWD = cap * (cfg.maxStockPct / 100);
    const finalSafeTWD = Math.min(rawSafeCapitalTWD, slotCapTWD);
    const finalShares = entry * fx > 0 ? Math.floor(finalSafeTWD / (entry * fx)) : 0;
    const upsidePerShare = Math.max(0, target - entry);
    const rr = (validStop && diffPerShare > 0) ? (upsidePerShare / diffPerShare) : 0;
    return {
        st, isUSD, fx, cap, entry, stop, target, validStop, diffPerShare, maxAllowedLossTWD,
        rawSafeShares, rawSafeCapitalTWD, slotCapTWD, finalSafeTWD, finalShares, upsidePerShare, rr,
    };
}

function loadStockIntoCalculator(stock) {
    if (!stock) return;
    appState.calc.pickedStockId = stock.id;
    const entry = Number(stock.price.toFixed(2));
    // Pick sensible technical support below current price
    let stop = stock.ma20 && stock.ma20 < entry * 0.99 ? stock.ma20
             : (stock.turtle_low && stock.turtle_low < entry * 0.99 ? stock.turtle_low : entry * 0.92);
    stop = Number(Math.max(0.01, stop).toFixed(2));
    const gap = Math.max(entry * 0.02, entry - stop);
    const target = Number((entry + gap * 3.5).toFixed(2));

    appState.calc.entryPrice = entry;
    appState.calc.stopPrice = stop;
    appState.calc.targetPrice = target;

    document.getElementById('calc-entry-price').value = entry;
    document.getElementById('calc-stop-price').value = stop;
    document.getElementById('calc-target-price').value = target;
    document.getElementById('calc-stock-search').value = `${stock.symbol} ${stock.name}`;
    renderTenSecCalculator();
}

function renderTenSecCalculator() {
    const cfg = appState.config;
    const {
        st, isUSD, fx, cap, entry, stop, target, validStop, diffPerShare, maxAllowedLossTWD,
        rawSafeShares, rawSafeCapitalTWD, slotCapTWD, finalSafeTWD, finalShares, upsidePerShare, rr,
    } = computeCalcSizing();
    const pfx = isUSD ? '$' : 'NT$';

    const capInput = document.getElementById('calc-capital');
    if (capInput && document.activeElement !== capInput) capInput.value = cfg.totalCapital;
    const badge = document.getElementById('calc-picked-badge');
    const currHint = document.getElementById('calc-currency-hint');
    if (st) {
        badge.textContent = `${st.symbol} ${st.name} (${st.sector})`;
        currHint.textContent = isUSD ? `美元 (USD) · 匯率 ${cfg.fxRate}` : `新台幣 (NT$) · 現價 ${st.price}`;
    } else {
        badge.textContent = '手動試算模式';
        currHint.textContent = '新台幣 (NT$) / 每股';
    }

    const lossPerLotTWD = isUSD ? (diffPerShare * fx) : (diffPerShare * 1000); // 台股 1 張 = 1000 股；美股以 1 股計
    const safeLotsTW = rawSafeShares / 1000;

    // Update 3 Formula Cards
    document.getElementById('c-step1-formula').textContent = `買進 ${fmtNum(entry, 1)} - 停損 ${fmtNum(stop, 1)}`;
    if (!validStop) {
        document.getElementById('c-step1-ans').textContent = '⚠️ 停損價必須低於預計買進價！';
    } else if (isUSD) {
        document.getElementById('c-step1-ans').textContent = `每股價差 $${fmtNum(diffPerShare, 2)}（約 NT$ ${fmtInt(diffPerShare * fx)} / 股）`;
    } else {
        document.getElementById('c-step1-ans').textContent = `價差 ${fmtNum(diffPerShare, 2)} 元（買 1 張最多賠 ${fmtInt(lossPerLotTWD)} 元）`;
    }

    document.getElementById('c-step2-pct').textContent = fmtNum(cfg.riskPerTradePct, 1);
    document.getElementById('c-step2-formula').textContent = `${fmtInt(cap)} × ${fmtNum(cfg.riskPerTradePct, 1)}% 鐵律`;
    document.getElementById('c-step2-ans').textContent = `這筆交易最多只准賠 ${fmtMoney(maxAllowedLossTWD)}！`;

    if (!validStop) {
        document.getElementById('c-step3-formula').textContent = '請先修正停損價';
        document.getElementById('c-step3-ans').textContent = '無法進場：尚未設定有效停損';
    } else if (isUSD) {
        document.getElementById('c-step3-formula').textContent = `${fmtInt(maxAllowedLossTWD)} ÷ 每股賠 ${fmtInt(diffPerShare * fx)}`;
        document.getElementById('c-step3-ans').textContent = `安全答案：最多買 ${fmtInt(rawSafeShares)} 股 (${fmtCompactTWD(rawSafeCapitalTWD)})`;
    } else {
        document.getElementById('c-step3-formula').textContent = `${fmtInt(maxAllowedLossTWD)} ÷ 每張賠 ${fmtInt(lossPerLotTWD)}`;
        document.getElementById('c-step3-ans').textContent = `安全答案：最多買 ${fmtNum(safeLotsTW, 2)} 張 (${fmtInt(rawSafeShares)} 股)`;
    }

    // RR Pill
    const rrPill = document.getElementById('calc-rr-pill');
    if (rr >= 3.0) {
        rrPill.className = 'tag-pill tag-ok';
        rrPill.textContent = `風報比 1 : ${fmtNum(rr, 1)}（優 · 綠燈）`;
    } else if (rr >= 2.0) {
        rrPill.className = 'tag-pill tag-warn';
        rrPill.textContent = `風報比 1 : ${fmtNum(rr, 1)}（尚可 · 未滿3倍）`;
    } else {
        rrPill.className = 'tag-pill tag-danger';
        rrPill.textContent = `風報比 1 : ${fmtNum(rr, 1)}（偏低 · 紅燈）`;
    }

    // 3 Pre-Trade Questions Gatekeeper
    document.querySelectorAll('.q2-limit-lbl').forEach(el => { el.textContent = fmtNum(cfg.riskPerTradePct, 1); });

    const q1Pass = validStop && ((entry - stop) / entry) <= 0.35;
    const q2Pass = validStop && rawSafeShares > 0 && cfg.riskPerTradePct <= 2.5;
    const q3Pass = validStop && rr >= 2.99;

    setQuestionRow('c-q1-row', 'c-q1-status', q1Pass,
        q1Pass ? `✅ 已設定 (${pfx} ${fmtNum(stop, 2)}，距買價 -${fmtNum((diffPerShare / entry) * 100, 1)}%)`
               : (validStop ? '❌ 停損距離超過 35%，過寬危險' : '❌ 尚未設定低於買價之停損價'));

    setQuestionRow('c-q2-row', 'c-q2-status', q2Pass,
        q2Pass ? `✅ 鎖死 ${fmtNum(cfg.riskPerTradePct, 1)}% (${fmtMoney(maxAllowedLossTWD)})`
               : (cfg.riskPerTradePct > 2.5 ? `❌ 單筆風險設為 ${cfg.riskPerTradePct}%，超過 2% 保命上限` : '❌ 股價過高或本金不足買進 1 股'));

    setQuestionRow('c-q3-row', 'c-q3-status', q3Pass,
        q3Pass ? `✅ 1 : ${fmtNum(rr, 1)} 達標 (潛在獲利 +${fmtNum((upsidePerShare / entry) * 100, 1)}%)`
               : `❌ 僅 1 : ${fmtNum(rr, 2)}，未達 3 倍停損風險`);

    const allPass = q1Pass && q2Pass && q3Pass;
    const banner = document.getElementById('calc-verdict-banner');
    const vText = document.getElementById('calc-verdict-text');
    const addBtn = document.getElementById('btn-calc-add-portfolio');

    // Cap actual added position at single-stock cap (e.g. 20% for 5-slot diversification)
    const cappedNote = rawSafeCapitalTWD > slotCapTWD ? `（依單檔上限 ${cfg.maxStockPct}% 裁切至 ${fmtCompactTWD(slotCapTWD)}）` : '';
    const sharesTxt = isUSD ? `${fmtInt(finalShares)} 股` : (finalShares >= 1000 ? `${fmtNum(finalShares / 1000, 2)} 張` : `${fmtInt(finalShares)} 股零股`);

    if (allPass) {
        banner.className = 'verdict-banner verdict-pass';
        vText.textContent = `🟢 三關全過・綠燈放行！建議安全買進 ${fmtMoney(finalSafeTWD)}（約 ${sharesTxt}）${cappedNote}`;
        addBtn.disabled = !st;
        addBtn.textContent = st ? `➕ 將 ${st.symbol} 按安全部位加入投組` : '🔎 先於左上方搜尋股票即可加入投組';
    } else {
        banner.className = 'verdict-banner verdict-fail';
        vText.textContent = `🔴 紀律攔截：有題目為「否」，請調整停損／目標價，或放棄這筆交易！`;
        addBtn.disabled = !st;
        addBtn.textContent = st ? `⚠️ 仍強制加入 ${st.symbol} 檢視` : '🔎 可搜尋真實股票測試';
    }
}

function setQuestionRow(rowId, statusId, pass, text) {
    const row = document.getElementById(rowId);
    const st = document.getElementById(statusId);
    if (row) row.className = 'q-row ' + (pass ? 'pass' : 'fail');
    if (st) {
        st.textContent = text;
        st.className = 'num ' + (pass ? 'pos' : 'neg');
    }
}

// ==================== Stop-Loss & Discipline Rules ====================
function computeHoldingRisk(h, stock) {
    const cfg = appState.config;
    const fx = stock.currency === 'USD' ? cfg.fxRate : 1.0;
    const price = stock.price;
    const hist = lookupHistoricalStats(stock, h.buyDate);
    const cost = (h.costPrice && h.costPrice > 0) ? Number(h.costPrice) : (hist?.entryClose || price);
    const highRef = Math.max(price, cost, hist?.highSince || price);

    let stopPrice = price * 0.92;
    let stopModeLabel = '';
    if (h.customStopPrice && h.customStopPrice > 0) {
        stopPrice = Number(h.customStopPrice);
        stopModeLabel = '自訂支撐停損';
    } else if (cfg.stopMode === 'fixed') {
        stopPrice = cost * (1 - cfg.stopParam / 100);
        stopModeLabel = `成本 -${cfg.stopParam}%`;
    } else if (cfg.stopMode === 'atr') {
        stopPrice = price - cfg.stopParam * (stock.atr_14 || price * 0.025);
        stopModeLabel = `現價 -${cfg.stopParam}×ATR`;
    } else if (cfg.stopMode === 'trailing') {
        stopPrice = highRef * (1 - cfg.stopParam / 100);
        stopModeLabel = `高點(${fmtNum(highRef, 1)}) -${cfg.stopParam}%`;
    } else if (cfg.stopMode === 'ma20') {
        stopPrice = stock.ma20 || price * 0.95;
        stopModeLabel = `前鋒 MA20`;
    } else if (cfg.stopMode === 'ma60') {
        stopPrice = stock.ma60 || price * 0.90;
        stopModeLabel = `中軍 MA60`;
    } else if (cfg.stopMode === 'turtle') {
        stopPrice = stock.turtle_low || price * 0.92;
        stopModeLabel = `海龜 20D 低點`;
    }
    stopPrice = Math.max(0.01, Number(stopPrice.toFixed(2)));

    const amountTWD = Math.max(0, Number(h.amountTWD || 0));
    const weightPct = cfg.totalCapital > 0 ? (amountTWD / cfg.totalCapital) * 100 : 0;

    const pnlPct = cost > 0 ? (price / cost - 1) * 100 : 0;
    const entryCapitalTWD = amountTWD;
    const entryShares = (cost * fx) > 0 ? entryCapitalTWD / (cost * fx) : 0;
    const marketValueTWD = entryShares * price * fx;
    const unrealizedPnlTWD = marketValueTWD - entryCapitalTWD;

    const stopDistFromCurrPct = price > 0 ? ((stopPrice - price) / price) * 100 : 0;
    const stopBreached = price <= stopPrice;

    // Principal Stop-Loss Risk against entry cost (aligns with 2% total capital rule:
    // unrealized paper profit is NOT treated as losing original capital; if stop >= cost, principal is locked safe!)
    const effectiveExit = Math.min(price, stopPrice);
    const lossPerShare = Math.max(0, cost - effectiveExit);
    const stopLossAmtTWD = entryShares * lossPerShare * fx;
    const stopLossCapPct = cfg.totalCapital > 0 ? (stopLossAmtTWD / cfg.totalCapital) * 100 : 0;
    const paperGivebackTWD = entryShares * Math.max(0, price - Math.max(cost, stopPrice)) * fx;

    const allowedLossTWD = cfg.totalCapital * (cfg.riskPerTradePct / 100);
    const entryStopFrac = cost > 0 && cost > effectiveExit ? (cost - effectiveExit) / cost : (price > stopPrice ? (price - stopPrice) / price : 0.08);
    const riskFrac = Math.max(0.015, entryStopFrac);
    const recommendedMaxTWD = Math.min(
        cfg.totalCapital * (cfg.maxStockPct / 100),
        allowedLossTWD / riskFrac
    );

    const targetPrice = (h.customTargetPrice && h.customTargetPrice > 0)
        ? Number(h.customTargetPrice)
        : Number((cost * (1 + cfg.tpPct / 100)).toFixed(2));
    const upsideFromEntry = Math.max(0, targetPrice - cost);
    const downsideFromEntry = Math.max(cost * 0.01, cost > stopPrice ? (cost - stopPrice) : Math.abs(price - stopPrice));
    const rrRatio = Number((upsideFromEntry / downsideFromEntry).toFixed(2));
    const expectedProfitTWD = entryShares * Math.max(0, targetPrice - Math.min(cost, price)) * fx;

    // 3 Pre-Trade Questions Score for this holding
    const q1 = !stopBreached && stopPrice > 0;
    const q2 = stopLossCapPct <= cfg.riskPerTradePct + 0.05;
    const q3 = rrRatio >= 2.95;
    const qPassedCount = (q1 ? 1 : 0) + (q2 ? 1 : 0) + (q3 ? 1 : 0);

    const disc = evaluateDisciplineRule(stock, cost, price, pnlPct);

    return {
        fx,
        cost,
        price,
        hist,
        highRef,
        stopPrice,
        stopModeLabel,
        stopDistFromCurrPct,
        stopBreached,
        entryCapitalTWD,
        entryShares,
        marketValueTWD,
        unrealizedPnlTWD,
        pnlPct,
        weightPct,
        stopLossAmtTWD,
        stopLossCapPct,
        paperGivebackTWD,
        recommendedMaxTWD,
        targetPrice,
        expectedProfitTWD,
        rrRatio,
        q1, q2, q3, qPassedCount,
        disc,
        sector: h.customSector || stock.sector,
    };
}

function evaluateDisciplineRule(stock, cost, price, pnlPct) {
    const big = stock.is_etf || stock.is_largecap;
    const lev = stock.is_leveraged;
    const catLabel = lev ? '槓桿/反向ETF' : (stock.is_etf ? 'ETF' : (big ? '大型權值股' : '中小型股'));

    if (pnlPct >= 100) return { icon: '🏆', tag: '達+100%翻倍', text: '紀律停利：賣出剩餘持股一半，留一半核心續抱', level: 'ok', catLabel };
    if (pnlPct >= 60) return { icon: '💰', tag: '達+60%停利', text: '紀律停利：賣出剩餘持股 40% 鎖住獲利', level: 'ok', catLabel };
    if (pnlPct >= 45) return { icon: '💰', tag: '達+45%停利', text: '紀律停利：賣出剩餘持股 30%', level: 'ok', catLabel };
    if (pnlPct >= 35) return { icon: '💰', tag: '達+35%停利', text: '紀律停利：賣出剩餘持股 20%', level: 'ok', catLabel };
    if (pnlPct >= 25) return { icon: '💰', tag: '達+25%停利', text: '紀律停利：賣出剩餘持股 10%', level: 'ok', catLabel };
    if (pnlPct >= 5)  return { icon: '🟢', tag: '讓獲利奔跑', text: '帳面小賺勿急跑！守好停損讓波段獲利奔跑', level: 'ok', catLabel };
    if (pnlPct > -15) return { icon: '⚪', tag: '觀望/守停損', text: '未達停利，嚴守設定之技術停損防線', level: 'info', catLabel };
    if (lev) return { icon: '⛔', tag: '槓桿禁攤平', text: '槓桿/反向ETF具波動耗損，嚴禁攤平，請嚴守停損', level: 'danger', catLabel };
    if (!big) return { icon: '⚠️', tag: '中小股禁攤平', text: '中小型股跌深嚴禁死扛攤平！請執行停損紀律', level: 'warn', catLabel };
    if (pnlPct <= -25) return { icon: '🔵', tag: '權值-25%評估', text: `${catLabel}跌達-25%：若採長線紀律法，確認基本面無虞可分批加碼`, level: 'info', catLabel };
    return { icon: '🔵', tag: '權值-15%評估', text: `${catLabel}跌達-15%：波段單應先停損；長線配置單須查明下跌原因`, level: 'info', catLabel };
}

// ==================== Master Risk Computation ====================
function computePortfolioSummary() {
    const cfg = appState.config;
    const cap = Math.max(10000, Number(cfg.totalCapital || 1000000));
    const items = [];
    const sectorTotals = {};

    let totalEntryTWD = 0;
    let totalMarketValueTWD = 0;
    let totalStopLossTWD = 0;
    let totalExpectedProfitTWD = 0;
    let weightedBetaNum = 0;
    let weightedVolNum = 0;
    let weightedRRNum = 0;
    let maxSingleStopRiskPct = 0;

    appState.holdings.forEach(h => {
        const st = appState.stockMap.get(h.id);
        if (!st) return;
        const r = computeHoldingRisk(h, st);
        items.push({ holding: h, stock: st, risk: r });

        totalEntryTWD += r.entryCapitalTWD;
        totalMarketValueTWD += r.marketValueTWD;
        totalStopLossTWD += r.stopLossAmtTWD;
        totalExpectedProfitTWD += r.expectedProfitTWD;
        weightedBetaNum += r.entryCapitalTWD * (st.beta ?? 1.0);
        weightedVolNum += r.entryCapitalTWD * (st.vol_1y ?? 25.0);
        weightedRRNum += r.entryCapitalTWD * r.rrRatio;
        if (r.stopLossCapPct > maxSingleStopRiskPct) maxSingleStopRiskPct = r.stopLossCapPct;

        sectorTotals[r.sector] = (sectorTotals[r.sector] || 0) + r.entryCapitalTWD;
    });

    const cashTWD = cap - totalEntryTWD;
    const cashPct = (cashTWD / cap) * 100;
    const investedPct = (totalEntryTWD / cap) * 100;
    const totalPnlTWD = totalMarketValueTWD - totalEntryTWD;
    const totalPnlPct = totalEntryTWD > 0 ? (totalPnlTWD / totalEntryTWD) * 100 : 0;
    const totalStopRiskPct = (totalStopLossTWD / cap) * 100;
    const avgRR = totalEntryTWD > 0 ? (weightedRRNum / totalEntryTWD) : (cfg.tpPct / Math.max(1, cfg.stopParam));

    let maxStockPctActual = 0;
    let maxStockSym = '--';
    items.forEach(it => {
        if (it.risk.weightPct > maxStockPctActual) {
            maxStockPctActual = it.risk.weightPct;
            maxStockSym = `${it.stock.symbol} ${it.stock.name}`;
        }
    });

    let maxSectorPctActual = 0;
    let maxSectorName = '--';
    Object.entries(sectorTotals).forEach(([sec, amt]) => {
        const pct = (amt / cap) * 100;
        if (pct > maxSectorPctActual) {
            maxSectorPctActual = pct;
            maxSectorName = sec;
        }
    });

    const corrInfo = computeCorrelationAndPortSeries(items, cap);
    const portBeta = cap > 0 ? weightedBetaNum / cap : 0;
    const portVol = corrInfo.portAnnVol != null ? corrInfo.portAnnVol : (cap > 0 ? weightedVolNum / cap : 0);

    const sSingle = items.length === 0 ? 0 : Math.min(100, Math.round((maxStockPctActual / Math.max(5, cfg.maxStockPct)) * 65));
    const sSector = items.length === 0 ? 0 : Math.min(100, Math.round((maxSectorPctActual / Math.max(10, cfg.maxSectorPct)) * 65));
    const sVol = items.length === 0 ? 0 : Math.min(100, Math.round((portVol / 28) * 65));
    const maxAllowedTotalStop = Math.max(4, cfg.riskPerTradePct * 5); // 5 slots × 2% = 10%
    const sStop = items.length === 0 ? 0 : Math.min(100, Math.round((totalStopRiskPct / maxAllowedTotalStop) * 65));
    const sCorr = items.length <= 1 ? 35 : Math.min(100, Math.max(5, Math.round(((corrInfo.avgCorr + 0.1) / 0.85) * 80)));

    let sCash = 20;
    if (items.length === 0) sCash = 5;
    else if (cashPct < 0) sCash = 100;
    else if (cashPct < cfg.minCashPct) sCash = Math.min(95, Math.round(55 + ((cfg.minCashPct - cashPct) / Math.max(5, cfg.minCashPct)) * 40));
    else sCash = Math.max(8, Math.round(50 - (cashPct - cfg.minCashPct) * 1.1));

    const compositeRisk = items.length === 0
        ? 0
        : Math.min(99, Math.max(5, Math.round(
            0.20 * sSingle +
            0.20 * sSector +
            0.20 * sVol +
            0.15 * sStop +
            0.15 * sCorr +
            0.10 * sCash
        )));

    return {
        cap,
        items,
        sectorTotals,
        totalEntryTWD,
        totalMarketValueTWD,
        totalExpectedProfitTWD,
        avgRR,
        maxSingleStopRiskPct,
        cashTWD,
        cashPct,
        investedPct,
        totalPnlTWD,
        totalPnlPct,
        totalStopLossTWD,
        totalStopRiskPct,
        maxStockPctActual,
        maxStockSym,
        maxSectorPctActual,
        maxSectorName,
        portBeta,
        portVol,
        corrInfo,
        subScores: { sSingle, sSector, sVol, sStop, sCorr, sCash },
        compositeRisk,
    };
}

function computeCorrelationAndPortSeries(items, totalCap) {
    if (!appState.historyReady || items.length === 0) {
        return { matrix: [], avgCorr: 0, highPairs: [], portAnnVol: null, var1d95: null, cvar1d95: null };
    }

    const retMaps = items.map(it => getDailyReturnMap(it.stock, 252));
    const n = items.length;
    const matrix = Array.from({ length: n }, () => Array(n).fill(1));
    let sumCorr = 0;
    let pairCnt = 0;
    const highPairs = [];

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const mA = retMaps[i];
            const mB = retMaps[j];
            let rVal = 0;
            if (mA && mB) {
                const xs = [], ys = [];
                mA.forEach((vA, dt) => {
                    if (mB.has(dt)) { xs.push(vA); ys.push(mB.get(dt)); }
                });
                if (xs.length >= 20) {
                    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
                    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
                    let cov = 0, vX = 0, vY = 0;
                    for (let k = 0; k < xs.length; k++) {
                        const dx = xs[k] - meanX, dy = ys[k] - meanY;
                        cov += dx * dy; vX += dx * dx; vY += dy * dy;
                    }
                    if (vX > 1e-10 && vY > 1e-10) {
                        rVal = Number((cov / Math.sqrt(vX * vY)).toFixed(2));
                    }
                }
            }
            matrix[i][j] = rVal;
            matrix[j][i] = rVal;
            sumCorr += rVal;
            pairCnt++;
            if (rVal >= 0.70) {
                highPairs.push({
                    a: items[i].stock.symbol, aName: items[i].stock.name,
                    b: items[j].stock.symbol, bName: items[j].stock.name,
                    corr: rVal,
                });
            }
        }
    }

    const dateSet = new Set();
    retMaps.forEach(m => { if (m) m.forEach((_, d) => dateSet.add(d)); });
    const sortedDates = Array.from(dateSet).sort().slice(-252);

    const portDailyRets = [];
    sortedDates.forEach(d => {
        let dayRet = 0, activeWeight = 0;
        for (let i = 0; i < n; i++) {
            const w = items[i].risk.entryCapitalTWD / totalCap;
            const r = retMaps[i]?.get(d);
            if (r != null) { dayRet += w * r; activeWeight += w; }
        }
        if (activeWeight > 0) portDailyRets.push(dayRet);
    });

    let portAnnVol = null, var1d95 = null, cvar1d95 = null;
    if (portDailyRets.length >= 20) {
        const mean = portDailyRets.reduce((a, b) => a + b, 0) / portDailyRets.length;
        const variance = portDailyRets.reduce((a, b) => a + (b - mean) ** 2, 0) / (portDailyRets.length - 1);
        portAnnVol = Number((Math.sqrt(variance * 252) * 100).toFixed(2));

        const sortedR = [...portDailyRets].sort((a, b) => a - b);
        const qIdx = Math.max(0, Math.floor(sortedR.length * 0.05));
        var1d95 = Math.max(0.1, -sortedR[qIdx] * 100);
        const tail = sortedR.slice(0, qIdx + 1);
        cvar1d95 = Math.max(var1d95, -(tail.reduce((a, b) => a + b, 0) / tail.length) * 100);
    }

    highPairs.sort((a, b) => b.corr - a.corr);
    return {
        matrix,
        avgCorr: pairCnt > 0 ? Number((sumCorr / pairCnt).toFixed(2)) : 0,
        highPairs,
        portAnnVol,
        var1d95,
        cvar1d95,
    };
}

// ==================== UI Renderers ====================
function refreshAllRiskViews(skipPortfolioTable = false) {
    saveState();
    const summary = computePortfolioSummary();
    renderVideoHUD(summary);
    renderTenSecCalculator();
    renderGaugeAndKPIs(summary);
    if (!skipPortfolioTable) {
        renderPortfolioTable(summary);
    } else {
        updatePortfolioRowMetricsInline(summary);
    }
    renderSectorPills(summary);
    renderSectorHeatmapAndBars(summary);
    renderEquityAndDrawdownChart(summary);
    renderCorrelationMatrix(summary);
    renderStressTests(summary);
    renderRiskChecklist(summary);
}

// 渲染「AI 風控核心戰情板」+ 10 筆期望值對決
function renderVideoHUD(sum) {
    const cfg = appState.config;
    const cap = sum.cap;
    const wr = cfg.winRate;

    document.getElementById('hud-winrate-val').textContent = wr;
    const wrTag = document.getElementById('hud-winrate-tag');
    if (wr >= 65) { wrTag.className = 'tag-pill tag-ok'; wrTag.textContent = '高勝率'; }
    else if (wr >= 50) { wrTag.className = 'tag-pill tag-info'; wrTag.textContent = '五五波實戰'; }
    else { wrTag.className = 'tag-pill tag-warn'; wrTag.textContent = '逆風低勝率'; }

    document.getElementById('hud-capital-val').textContent = fmtMoney(cap);
    const secCount = Object.keys(sum.sectorTotals).length;
    document.getElementById('hud-slots-sub').innerHTML =
        `目前 <b style="color:#fff">${sum.items.length} 檔</b> / 分屬 <b style="color:var(--primary)">${secCount} 個產業</b>`;

    const maxStopAmt = cap * (cfg.riskPerTradePct / 100);
    document.getElementById('hud-stop-pct-tag').textContent = `嚴控 ${fmtNum(cfg.riskPerTradePct, 1)}%`;
    document.getElementById('hud-max-stop-amt').textContent = `-${fmtMoney(maxStopAmt)}`;
    const afterFiveLosses = Math.max(0, cap - maxStopAmt * 5);
    const keepPct = ((afterFiveLosses / cap) * 100).toFixed(0);
    document.getElementById('hud-five-loss-sub').textContent =
        `連錯 5 次仍保本金 ${keepPct}% (${fmtCompactTWD(afterFiveLosses)})`;

    const tpTotal = sum.items.length > 0 ? sum.totalExpectedProfitTWD : cap * 0.15;
    document.getElementById('hud-tp-amt').textContent = `+${fmtMoney(tpTotal)}`;
    document.getElementById('hud-tp-sub').textContent = `目標停利 +${cfg.tpPct}% 波段空間`;

    const rr = sum.avgRR || 3.5;
    document.getElementById('hud-rr-val').textContent = `風報比 ${fmtNum(rr, 1)} 倍`;
    const rrGrade = document.getElementById('hud-rr-grade');
    if (rr >= 3.0) { rrGrade.className = 'tag-pill tag-ok'; rrGrade.textContent = '優 · 綠燈'; }
    else if (rr >= 2.0) { rrGrade.className = 'tag-pill tag-warn'; rrGrade.textContent = '中 · 留意'; }
    else { rrGrade.className = 'tag-pill tag-danger'; rrGrade.textContent = '低 · 警示'; }

    const actualSingleRisk = sum.items.length > 0 ? sum.maxSingleStopRiskPct : cfg.riskPerTradePct;
    const riskSafe = actualSingleRisk <= cfg.riskPerTradePct + 0.05 && cfg.riskPerTradePct <= 2.5;
    const sTxt = document.getElementById('hud-single-risk-txt');
    const sBar = document.getElementById('hud-safety-bar');
    sTxt.textContent = `單筆最大風險：${fmtNum(actualSingleRisk, 2)}% (${riskSafe ? '安全綠燈' : '超標警示'})`;
    sTxt.style.color = riskSafe ? '#4ade80' : '#f87171';
    sBar.style.width = `${Math.min(100, (actualSingleRisk / 5) * 100)}%`;
    sBar.style.background = riskSafe
        ? 'linear-gradient(90deg, #22c55e, #00d4aa)'
        : 'linear-gradient(90deg, #f97316, #ef4444)';

    const overallBadge = document.getElementById('hud-overall-badge');
    if (riskSafe && rr >= 3.0) {
        overallBadge.className = 'tag-pill tag-ok';
        overallBadge.textContent = '🟢 風控綠燈：風險鎖死 · 高風報比';
    } else {
        overallBadge.className = 'tag-pill tag-warn';
        overallBadge.textContent = '🟡 建議微調部位以達 ≤2% 停損與 ≥3倍 風報比';
    }

    // 10-Trade Expectancy Comparison (Disposition Effect vs AI Risk Control)
    const wins = Number((10 * (wr / 100)).toFixed(1));
    const losses = Number((10 - wins).toFixed(1));
    const winTxt = Number.isInteger(wins) ? `${wins}` : wins.toFixed(1);
    const lossTxt = Number.isInteger(losses) ? `${losses}` : losses.toFixed(1);
    const leekUnit = cap * 0.50;
    const leekNet = wins * (leekUnit * 0.02) - losses * (leekUnit * 0.30);
    const badResEl = document.getElementById('exp-bad-result');
    badResEl.textContent = `10 筆期望結算：${leekNet >= 0 ? '+' : '-'}${fmtMoney(Math.abs(leekNet))}`;
    badResEl.className = 'num ' + (leekNet >= 0 ? 'pos' : 'neg');
    document.getElementById('exp-bad-detail').textContent =
        `勝率 ${wr}%（平均 10 次贏 ${winTxt} 次僅賺 +2%，輸 ${lossTxt} 次死扛大賠 -30%），小賺就跑根本不夠賠一次大跌！`;

    // AI Risk Control: Each loss strictly locked at maxStopAmt (e.g. $20,000), each win = rr * maxStopAmt
    const aiWinPerTrade = maxStopAmt * Math.max(1.0, rr);
    const aiNet = wins * aiWinPerTrade - losses * maxStopAmt;
    const goodResEl = document.getElementById('exp-good-result');
    goodResEl.textContent = `10 筆期望獲利：${aiNet >= 0 ? '+' : '-'}${fmtMoney(Math.abs(aiNet))}`;
    goodResEl.className = 'num ' + (aiNet >= 0 ? 'pos' : 'neg');
    document.getElementById('exp-good-detail').textContent =
        `勝率 ${wr}%（錯 ${lossTxt} 次嚴守停損各賠 ${fmtCompactTWD(maxStopAmt)}，對 ${winTxt} 次以 1:${fmtNum(rr, 1)} 風報比各賺 ${fmtCompactTWD(aiWinPerTrade)}），徹底扭轉期望值！`;
}

function renderMarketTemps() {
    const twT = appState.context?.tw_temperature;
    const usT = appState.context?.us_temperature;
    const twEl = document.getElementById('tw-mkt-temp');
    const usEl = document.getElementById('us-mkt-temp');
    if (twEl && twT?.temperature != null) {
        twEl.textContent = `${twT.temperature} (${twT.label || ''})`;
        twEl.style.color = getTempColor(twT.temperature);
    }
    if (usEl && usT?.temperature != null) {
        usEl.textContent = `${usT.temperature} (${usT.label || ''})`;
        usEl.style.color = getTempColor(usT.temperature);
    }
}

function renderGaugeAndKPIs(sum) {
    const cfg = appState.config;
    document.getElementById('portfolio-count-badge').textContent = `${sum.items.length} 檔持股`;

    const score = sum.compositeRisk;
    const gVal = document.getElementById('gauge-value');
    const gLbl = document.getElementById('gauge-label');
    const gFill = document.getElementById('gauge-fill');

    gVal.textContent = sum.items.length ? score : '0';
    gVal.style.color = getRiskColor(score);
    gLbl.textContent = sum.items.length ? getRiskLabel(score) : '尚未配置標的';
    gLbl.style.color = getRiskColor(score);

    const offset = 125.6 - (score / 100) * 125.6;
    gFill.style.strokeDashoffset = offset;
    gFill.style.stroke = getRiskColor(score);

    document.getElementById('kpi-invested').textContent = `${fmtCompactTWD(sum.totalEntryTWD)} / ${fmtCompactTWD(sum.cap)}`;
    const invPctEl = document.getElementById('kpi-invested-pct');
    invPctEl.textContent = `水位 ${fmtNum(sum.investedPct, 1)}% · Beta ${fmtNum(sum.portBeta, 2)}`;
    invPctEl.className = 'k-sub ' + (sum.investedPct > 100 ? 'neg' : '');

    const cashEl = document.getElementById('kpi-cash');
    cashEl.textContent = fmtCompactTWD(sum.cashTWD);
    cashEl.className = 'k-val ' + (sum.cashPct < cfg.minCashPct ? 'neg' : 'pos');
    document.getElementById('kpi-cash-pct').textContent = `佔比 ${fmtNum(sum.cashPct, 1)}% (目標 ≥ ${cfg.minCashPct}%)`;

    const pnlEl = document.getElementById('kpi-pnl');
    pnlEl.textContent = `${sum.totalPnlTWD >= 0 ? '+' : ''}${fmtCompactTWD(sum.totalPnlTWD)}`;
    pnlEl.className = 'k-val ' + (sum.totalPnlTWD > 0 ? 'pos' : (sum.totalPnlTWD < 0 ? 'neg' : ''));
    document.getElementById('kpi-pnl-pct').textContent = `報酬率 ${sum.totalPnlPct >= 0 ? '+' : ''}${fmtNum(sum.totalPnlPct, 2)}% · 現值 ${fmtCompactTWD(sum.totalMarketValueTWD)}`;

    const stopEl = document.getElementById('kpi-stop-risk');
    stopEl.textContent = `-${fmtCompactTWD(sum.totalStopLossTWD)}`;
    stopEl.className = 'k-val ' + (sum.totalStopRiskPct > cfg.riskPerTradePct * 5 ? 'neg' : 'warn-txt');
    document.getElementById('kpi-stop-risk-pct').textContent = `佔總本金 -${fmtNum(sum.totalStopRiskPct, 2)}%`;

    const { sSingle, sSector, sVol, sStop, sCorr, sCash } = sum.subScores;
    const inds = [
        {
            name: '單一持股集中度 (20%)',
            score: sSingle,
            detail: sum.items.length ? `最高：${sum.maxStockSym} (${fmtNum(sum.maxStockPctActual, 1)}% / 上限 ${cfg.maxStockPct}%)` : '無持股',
        },
        {
            name: '產業類別集中度 (20%)',
            score: sSector,
            detail: sum.items.length ? `最高：${escapeHtml(sum.maxSectorName)} (${fmtNum(sum.maxSectorPctActual, 1)}% / 上限 ${cfg.maxSectorPct}%)` : '無持股',
        },
        {
            name: '投組年化波動率 (20%)',
            score: sVol,
            detail: `預估年化波動 ${fmtNum(sum.portVol, 1)}% · 投組 Beta ${fmtNum(sum.portBeta, 2)}`,
        },
        {
            name: '全停損觸發總風險 (15%)',
            score: sStop,
            detail: `若全數跌破停損價，總虧損佔本金 ${fmtNum(sum.totalStopRiskPct, 2)}%`,
        },
        {
            name: '持股同漲同跌相關性 (15%)',
            score: sCorr,
            detail: sum.items.length > 1 ? `兩兩平均相關係數 ${fmtNum(sum.corrInfo.avgCorr, 2)} (${sum.corrInfo.highPairs.length} 組高度重疊)` : '需 2 檔以上計算相關性',
        },
        {
            name: '現金安全墊風險 (10%)',
            score: sCash,
            detail: `剩餘現金 ${fmtNum(sum.cashPct, 1)}% (設定最低保留 ${cfg.minCashPct}%)`,
        },
    ];

    document.getElementById('indicators-container').innerHTML = inds.map(ind => `
        <div class="indicator">
            <div class="ind-header">
                <span>${ind.name}</span>
                <span class="num" style="color:${getRiskColor(ind.score)};font-weight:600;">${ind.score}</span>
            </div>
            <div class="ind-bar-bg">
                <div class="ind-bar-fill" style="width:${ind.score}%;background:${getRiskColor(ind.score)}"></div>
            </div>
            <div class="ind-detail">${ind.detail}</div>
        </div>
    `).join('');
}

// ==================== Portfolio Table Renderer ====================
function getAllSectorOptions(currentSector) {
    const set = new Set([currentSector, ...CUSTOM_SECTORS]);
    appState.sectors.forEach(s => set.add(s.sector));
    return Array.from(set).filter(Boolean);
}

function formatShares(shares, market) {
    if (!shares || shares <= 0) return '0 股';
    if (market.startsWith('TW')) {
        if (shares >= 1000) {
            return `${(shares / 1000).toFixed(2)} 張 (${Math.round(shares).toLocaleString()} 股)`;
        }
        return `${Math.round(shares).toLocaleString()} 股 (零股)`;
    }
    return `${shares.toFixed(2)} 股`;
}

function buildStatusBadgesHTML(it, sum) {
    const cfg = appState.config;
    const r = it.risk;
    const secAmt = sum.sectorTotals[r.sector] || 0;
    const secPct = (secAmt / sum.cap) * 100;
    const badges = [];

    // 買進三問綜合燈號
    if (r.qPassedCount === 3) {
        badges.push(`<span class="tag-pill tag-ok" title="下單前三問全過：①已設停損 ②單筆≤${cfg.riskPerTradePct}% ③風報比≥1:3">🟢 三問全過 (3/3)</span>`);
    } else {
        const failReasons = [];
        if (!r.q1) failReasons.push('跌破停損');
        if (!r.q2) failReasons.push(`停損逾${cfg.riskPerTradePct}%`);
        if (!r.q3) failReasons.push('風報比<3');
        badges.push(`<span class="tag-pill tag-danger" title="未通過項目：${failReasons.join('、')}">🔴 三問 (${r.qPassedCount}/3)：${failReasons[0]}</span>`);
    }

    if (r.weightPct > cfg.maxStockPct + 0.05) {
        badges.push(`<span class="tag-pill tag-danger">🔴 單檔超標 (${fmtNum(r.weightPct, 1)}%&gt;${cfg.maxStockPct}%)</span>`);
    }
    if (secPct > cfg.maxSectorPct + 0.05) {
        badges.push(`<span class="tag-pill tag-warn">🟠 產業超標 (${fmtNum(secPct, 1)}%)</span>`);
    }

    const dCls = r.disc.level === 'danger' ? 'tag-danger' : (r.disc.level === 'warn' ? 'tag-warn' : (r.disc.level === 'ok' ? 'tag-ok' : 'tag-info'));
    badges.push(`<span class="tag-pill ${dCls}" title="${r.disc.text}">${r.disc.icon} ${r.disc.tag}</span>`);
    return `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">${badges.join('')}</div>`;
}

function renderPortfolioTable(sum) {
    const emptyEl = document.getElementById('portfolio-empty');
    const wrapEl = document.getElementById('portfolio-table-wrap');
    const tbody = document.getElementById('portfolio-tbody');

    if (sum.items.length === 0) {
        emptyEl.style.display = 'block';
        wrapEl.style.display = 'none';
        tbody.innerHTML = '';
        return;
    }
    emptyEl.style.display = 'none';
    wrapEl.style.display = 'block';
    tbody.innerHTML = '';

    const cfg = appState.config;

    sum.items.forEach((it, idx) => {
        const { holding: h, stock: s, risk: r } = it;
        const currPrefix = s.currency === 'USD' ? '$' : 'NT$';

        const tr = document.createElement('tr');
        tr.className = 'main-row';
        tr.dataset.hid = h.id;

        const secOpts = getAllSectorOptions(r.sector)
            .map(sec => `<option value="${escapeHtml(sec)}" ${sec === r.sector ? 'selected' : ''}>${escapeHtml(sec)}</option>`)
            .join('');
        const dB = appState.dateBounds || {};
        const dateAttrs = `${dB.min ? `min="${dB.min}"` : ''} ${dB.max ? `max="${dB.max}"` : ''}`;

        const pnlClass = r.pnlPct > 0 ? 'pos' : (r.pnlPct < 0 ? 'neg' : 'neu');
        const holdDaysTxt = r.hist ? `持有 ${r.hist.holdingDays} 天` : '即時試算';

        tr.innerHTML = `
            <td class="clickable-cell" data-toggle-detail="${h.id}" title="點擊展開深度風控診斷">${idx + 1} ▾</td>
            <td>
                <div class="clickable-cell" data-toggle-detail="${h.id}" style="font-weight:700;color:var(--text-primary);">
                    ${s.symbol} <span style="font-weight:500;">${s.name}</span>
                </div>
                <div style="display:flex;gap:4px;align-items:center;margin-top:3px;flex-wrap:wrap;">
                    <span class="tag-pill tag-mkt">${s.market}</span>
                    <button class="chip-btn" data-act="load-calc" data-id="${h.id}" title="帶入上方 10 秒部位反推試算表">🧮 10秒精算</button>
                </div>
            </td>
            <td>
                <select class="pf-select-sector" data-act="sector" data-id="${h.id}">
                    ${secOpts}
                </select>
            </td>
            <td>
                <input type="date" class="pf-input-date" data-act="buydate" data-id="${h.id}" ${dateAttrs} value="${h.buyDate || cfg.defaultBuyDate}">
                <span class="sub-meta" data-cell="holddays-${h.id}">${holdDaysTxt}</span>
            </td>
            <td>
                <div style="display:flex;align-items:center;gap:4px;">
                    <input type="number" class="pf-input-cost" step="0.1" min="0.01" data-act="cost" data-id="${h.id}" value="${Number(r.cost).toFixed(2)}">
                    <button class="btn btn-xs" data-act="reset-cost" data-id="${h.id}" title="依買入日期自動帶入歷史收盤價">↺</button>
                </div>
                <span class="sub-meta">${currPrefix} 計價</span>
            </td>
            <td class="num clickable-cell" data-toggle-detail="${h.id}" data-cell="pnl-${h.id}">
                <div>${currPrefix} ${fmtNum(s.price, 2)}</div>
                <div class="${pnlClass}" style="font-size:12px;font-weight:600;">
                    ${r.pnlPct >= 0 ? '+' : ''}${fmtNum(r.pnlPct, 2)}% (${r.unrealizedPnlTWD >= 0 ? '+' : ''}${fmtCompactTWD(r.unrealizedPnlTWD)})
                </div>
            </td>
            <td>
                <div class="amt-ctrl-wrap">
                    <div class="amt-top-line">
                        <button class="btn btn-xs" data-act="step-amt" data-step="-10000" data-id="${h.id}" title="-1萬">-1萬</button>
                        <input type="number" class="pf-input-amt" step="10000" min="0" data-act="amount" data-id="${h.id}" value="${Math.round(r.entryCapitalTWD)}">
                        <button class="btn btn-xs" data-act="step-amt" data-step="10000" data-id="${h.id}" title="+1萬">+1萬</button>
                    </div>
                    <input type="range" class="amt-slider" min="0" max="${Math.max(50, cfg.maxStockPct * 2)}" step="0.5" value="${Math.min(100, r.weightPct)}" data-act="weight-slider" data-id="${h.id}">
                    <span class="sub-meta" data-cell="shares-${h.id}">佔本金 <b style="color:var(--secondary)">${fmtNum(r.weightPct, 1)}%</b> · ${formatShares(r.entryShares, s.market)}</span>
                </div>
            </td>
            <td class="num" data-cell="stop-${h.id}">
                <div style="font-weight:600;color:${r.stopBreached ? 'var(--danger)' : 'var(--text-primary)'}">${currPrefix} ${fmtNum(r.stopPrice, 2)}</div>
                <span class="sub-meta">${r.stopModeLabel} (${fmtNum(r.stopDistFromCurrPct, 1)}%)</span>
            </td>
            <td class="num" data-cell="stoprisk-${h.id}">
                <div class="${r.stopLossCapPct > cfg.riskPerTradePct + 0.05 ? 'neg' : 'pos'}" style="font-weight:600;">${r.stopLossAmtTWD > 0 ? '-' + fmtMoney(r.stopLossAmtTWD) : 'NT$ 0 (保本鎖利)'}</div>
                <span class="sub-meta">本金風險 -${fmtNum(r.stopLossCapPct, 2)}% ${r.stopLossCapPct <= cfg.riskPerTradePct + 0.05 ? '(安全)' : '(超標)'}</span>
            </td>
            <td class="num" data-cell="rr-${h.id}">
                <div>1 : <b class="${r.rrRatio >= 3 ? 'pos' : (r.rrRatio < 2 ? 'neg' : 'warn-txt')}">${fmtNum(r.rrRatio, 1)}</b></div>
                <span class="sub-meta">目標 ${currPrefix}${fmtNum(r.targetPrice, 1)}</span>
            </td>
            <td data-cell="badges-${h.id}">
                ${buildStatusBadgesHTML(it, sum)}
            </td>
            <td>
                <button class="btn btn-xs btn-danger" data-act="remove" data-id="${h.id}" title="移除此持股">✕</button>
            </td>
        `;

        const trDetail = document.createElement('tr');
        trDetail.className = 'detail-row' + (h.openDetail ? ' open' : '');
        trDetail.id = `detail-${h.id}`;
        trDetail.innerHTML = `<td colspan="12">${buildDetailRowHTML(it, cfg)}</td>`;

        tbody.appendChild(tr);
        tbody.appendChild(trDetail);
    });
}

function buildDetailRowHTML(it, cfg) {
    const { stock: s, risk: r } = it;
    const pfx = s.currency === 'USD' ? '$' : 'NT$';

    let stagingHTML = '';
    if (cfg.entryMode === 'pyramid3') {
        stagingHTML = `
            <div class="detail-item"><span class="lbl">第1批試單 (40%)</span><span class="val">${fmtMoney(r.entryCapitalTWD * 0.4)}</span></div>
            <div class="detail-item"><span class="lbl">第2批加碼 (30%)</span><span class="val">${fmtMoney(r.entryCapitalTWD * 0.3)}</span></div>
            <div class="detail-item"><span class="lbl">第3批滿倉 (30%)</span><span class="val">${fmtMoney(r.entryCapitalTWD * 0.3)}</span></div>
        `;
    } else if (cfg.entryMode === 'dca4') {
        stagingHTML = `<div class="detail-item"><span class="lbl">分 4 批定額進場 (25%×4)</span><span class="val">${fmtMoney(r.entryCapitalTWD * 0.25)} / 批</span></div>`;
    } else {
        stagingHTML = `<div class="detail-item"><span class="lbl">單筆一次到位 (100%)</span><span class="val">${fmtMoney(r.entryCapitalTWD)}</span></div>`;
    }

    const canAdd = (s.is_largecap || s.is_etf) && !s.is_leveraged;

    return `
        <div class="detail-content">
            <div class="detail-group">
                <h4>🎯 2% 保命鐵律與風報比診斷</h4>
                <div class="detail-item"><span class="lbl">目前配置本金</span><span class="val">${fmtMoney(r.entryCapitalTWD)} (${fmtNum(r.weightPct, 1)}%)</span></div>
                <div class="detail-item"><span class="lbl">2% 鐵律建議上限金額</span><span class="val" style="color:var(--primary)">${fmtMoney(r.recommendedMaxTWD)}</span></div>
                <div class="detail-item"><span class="lbl">帳面未實現獲利回吐空間</span><span class="val">${fmtMoney(r.paperGivebackTWD || 0)}</span></div>
                <div class="detail-item"><span class="lbl">波段目標價 / 風報比</span><span class="val ${r.rrRatio >= 3 ? 'pos' : 'warn-txt'}">${pfx} ${fmtNum(r.targetPrice, 2)} (1 : ${fmtNum(r.rrRatio, 2)})</span></div>
                ${stagingHTML}
            </div>
            <div class="detail-group">
                <h4>📉 波動率與歷史回撤指標</h4>
                <div class="detail-item"><span class="lbl">年化波動率 (20D / 1Y)</span><span class="val">${fmtNum(s.vol_20d, 1)}% / ${fmtNum(s.vol_1y, 1)}%</span></div>
                <div class="detail-item"><span class="lbl">14日真實波幅 (ATR)</span><span class="val">${pfx} ${fmtNum(s.atr_14, 2)} (${fmtNum(s.atr_pct, 2)}%)</span></div>
                <div class="detail-item"><span class="lbl">單日 95% VaR / CVaR</span><span class="val neg">-${fmtNum(s.var_95_1d, 2)}% / -${fmtNum(s.cvar_95_1d, 2)}%</span></div>
                <div class="detail-item"><span class="lbl">近 1 年最大回撤 (MDD)</span><span class="val neg">${fmtNum(s.mdd_1y, 2)}%</span></div>
                <div class="detail-item"><span class="lbl">買入後最高價 / 期間回撤</span><span class="val">${pfx} ${fmtNum(r.highRef, 2)} / ${fmtNum(r.hist?.mddSince ?? 0, 2)}%</span></div>
            </div>
            <div class="detail-group">
                <h4>🛡️ 三軍均線與海龜技術支撐</h4>
                <div class="detail-item"><span class="lbl">三軍排列狀態</span><span class="val">${s.army} (MACD: ${s.macd})</span></div>
                <div class="detail-item"><span class="lbl">前鋒線 MA20</span><span class="val">${pfx} ${fmtNum(s.ma20, 2)}</span></div>
                <div class="detail-item"><span class="lbl">中軍線 MA60</span><span class="val">${pfx} ${fmtNum(s.ma60, 2)}</span></div>
                <div class="detail-item"><span class="lbl">後衛線 MA240 (年線)</span><span class="val">${pfx} ${fmtNum(s.ma240, 2)}</span></div>
                <div class="detail-item"><span class="lbl">海龜 20D 通道 (低 ~ 高)</span><span class="val">${fmtNum(s.turtle_low, 2)} ~ ${fmtNum(s.turtle_high, 2)}</span></div>
                <div class="detail-item"><span class="lbl">52週區間 (低 ~ 高)</span><span class="val">${fmtNum(s.low_52w, 1)} ~ ${fmtNum(s.high_52w, 1)}</span></div>
            </div>
            <div class="detail-group">
                <h4>📏 10 條紀律鐵則價位表 (${r.disc.catLabel})</h4>
                ${canAdd ? `
                    <div class="detail-item"><span class="lbl">🔵 長線 -15% 加碼 10% 價</span><span class="val">${pfx} ${fmtNum(r.cost * 0.85, 2)}</span></div>
                    <div class="detail-item"><span class="lbl">🔵 長線 -25% 加碼 25% 價</span><span class="val">${pfx} ${fmtNum(r.cost * 0.75, 2)}</span></div>
                ` : `
                    <div class="detail-item"><span class="lbl" style="color:var(--warning)">⚠️ 下檔防凹單鐵律</span><span class="val warn-txt">${s.is_leveraged ? '槓桿耗損禁攤平' : '中小股跌破均線嚴禁死扛'}</span></div>
                `}
                <div class="detail-item"><span class="lbl">💰 漲 +25% 停利 10% 價</span><span class="val pos">${pfx} ${fmtNum(r.cost * 1.25, 2)}</span></div>
                <div class="detail-item"><span class="lbl">💰 漲 +35% 停利 20% 價</span><span class="val pos">${pfx} ${fmtNum(r.cost * 1.35, 2)}</span></div>
                <div class="detail-item"><span class="lbl">💰 漲 +60% 停利 40% 價</span><span class="val pos">${pfx} ${fmtNum(r.cost * 1.60, 2)}</span></div>
                <div class="detail-item"><span class="lbl">🏆 漲 +100% 賣半留核心</span><span class="val pos">${pfx} ${fmtNum(r.cost * 2.00, 2)}</span></div>
            </div>
        </div>
    `;
}

function updatePortfolioRowMetricsInline(sum) {
    const cfg = appState.config;
    sum.items.forEach(it => {
        const { holding: h, stock: s, risk: r } = it;
        const currPrefix = s.currency === 'USD' ? '$' : 'NT$';
        const pnlClass = r.pnlPct > 0 ? 'pos' : (r.pnlPct < 0 ? 'neg' : 'neu');

        const pnlCell = document.querySelector(`[data-cell="pnl-${h.id}"]`);
        if (pnlCell) {
            pnlCell.innerHTML = `
                <div>${currPrefix} ${fmtNum(s.price, 2)}</div>
                <div class="${pnlClass}" style="font-size:12px;font-weight:600;">
                    ${r.pnlPct >= 0 ? '+' : ''}${fmtNum(r.pnlPct, 2)}% (${r.unrealizedPnlTWD >= 0 ? '+' : ''}${fmtCompactTWD(r.unrealizedPnlTWD)})
                </div>
            `;
        }
        const shCell = document.querySelector(`[data-cell="shares-${h.id}"]`);
        if (shCell) {
            shCell.innerHTML = `佔本金 <b style="color:var(--secondary)">${fmtNum(r.weightPct, 1)}%</b> · ${formatShares(r.entryShares, s.market)}`;
        }
        const slider = document.querySelector(`[data-act="weight-slider"][data-id="${h.id}"]`);
        if (slider && document.activeElement !== slider) slider.value = Math.min(100, r.weightPct);

        const stopCell = document.querySelector(`[data-cell="stop-${h.id}"]`);
        if (stopCell) {
            stopCell.innerHTML = `
                <div style="font-weight:600;color:${r.stopBreached ? 'var(--danger)' : 'var(--text-primary)'}">${currPrefix} ${fmtNum(r.stopPrice, 2)}</div>
                <span class="sub-meta">${r.stopModeLabel} (${fmtNum(r.stopDistFromCurrPct, 1)}%)</span>
            `;
        }
        const srCell = document.querySelector(`[data-cell="stoprisk-${h.id}"]`);
        if (srCell) {
            srCell.innerHTML = `
                <div class="${r.stopLossCapPct > cfg.riskPerTradePct + 0.05 ? 'neg' : 'pos'}" style="font-weight:600;">${r.stopLossAmtTWD > 0 ? '-' + fmtMoney(r.stopLossAmtTWD) : 'NT$ 0 (保本鎖利)'}</div>
                <span class="sub-meta">本金風險 -${fmtNum(r.stopLossCapPct, 2)}% ${r.stopLossCapPct <= cfg.riskPerTradePct + 0.05 ? '(安全)' : '(超標)'}</span>
            `;
        }
        const rrCell = document.querySelector(`[data-cell="rr-${h.id}"]`);
        if (rrCell) {
            rrCell.innerHTML = `
                <div>1 : <b class="${r.rrRatio >= 3 ? 'pos' : (r.rrRatio < 2 ? 'neg' : 'warn-txt')}">${fmtNum(r.rrRatio, 1)}</b></div>
                <span class="sub-meta">目標 ${currPrefix}${fmtNum(r.targetPrice, 1)}</span>
            `;
        }
        const bdgCell = document.querySelector(`[data-cell="badges-${h.id}"]`);
        if (bdgCell) bdgCell.innerHTML = buildStatusBadgesHTML(it, sum);

        const detRow = document.getElementById(`detail-${h.id}`);
        if (detRow) detRow.innerHTML = `<td colspan="12">${buildDetailRowHTML(it, cfg)}</td>`;
    });
}

// ==================== Stock & Sector Picker ====================
function renderSectorPills(sum) {
    const container = document.getElementById('sector-pills-container');
    if (!container) return;

    const mkt = appState.picker.market;
    const secCounts = new Map();
    appState.universe.forEach(s => {
        if (mkt !== 'ALL' && s.market !== mkt) return;
        secCounts.set(s.sector, (secCounts.get(s.sector) || 0) + 1);
    });

    const sortedSecs = Array.from(secCounts.entries()).sort((a, b) => b[1] - a[1]);
    const allActive = appState.picker.sector === 'ALL' ? 'active' : '';
    let html = `<button class="sector-pill ${allActive}" data-sec="ALL">全部產業類別 (${appState.universe.filter(s => mkt === 'ALL' || s.market === mkt).length})</button>`;

    sortedSecs.forEach(([sec, cnt]) => {
        const active = appState.picker.sector === sec ? 'active' : '';
        const heldAmt = sum?.sectorTotals?.[sec] || 0;
        const heldPct = (sum && heldAmt > 0) ? ((heldAmt / sum.cap) * 100).toFixed(0) : null;
        html += `
            <button class="sector-pill ${active}" data-sec="${escapeHtml(sec)}">
                <span>${escapeHtml(sec)} (${cnt})</span>
                ${heldPct ? `<span class="held-tag">已配 ${heldPct}%</span>` : ''}
            </button>
        `;
    });
    container.innerHTML = html;
}

function applyPickerFilters() {
    const p = appState.picker;
    const q = (p.search || '').trim().toLowerCase();

    p.filtered = appState.universe.filter(s => {
        if (p.market !== 'ALL' && s.market !== p.market) return false;
        if (p.sector !== 'ALL' && s.sector !== p.sector) return false;
        if (p.riskLevel !== 'ALL' && s.risk_level !== p.riskLevel) return false;
        if (p.army !== 'ALL' && s.army !== p.army) return false;
        if (q) {
            return s.symbol.toLowerCase().includes(q) ||
                   s.name.toLowerCase().includes(q) ||
                   s.sector.toLowerCase().includes(q);
        }
        return true;
    });

    p.filtered.sort((a, b) => {
        switch (p.sort) {
            case 'risk_asc': return (a.risk_score ?? 50) - (b.risk_score ?? 50);
            case 'risk_desc': return (b.risk_score ?? 50) - (a.risk_score ?? 50);
            case 'vol_asc': return (a.vol_1y ?? 50) - (b.vol_1y ?? 50);
            case 'mdd_asc': return (b.mdd_1y ?? -50) - (a.mdd_1y ?? -50);
            case 'mom_desc': return (b.factors?.momentum ?? -1) - (a.factors?.momentum ?? -1);
            case 'chg_desc': return (b.change_1d_pct ?? 0) - (a.change_1d_pct ?? 0);
            case 'sharpe_desc':
            default:
                return (b.sharpe_1y ?? 0) - (a.sharpe_1y ?? 0);
        }
    });

    p.page = 1;
    document.getElementById('picker-filtered-count').textContent = p.filtered.length;
    renderPickerTable();
}

function renderPickerTable() {
    const p = appState.picker;
    const tbody = document.getElementById('picker-tbody');
    if (!tbody) return;

    const heldIds = new Set(appState.holdings.map(h => h.id));
    const start = (p.page - 1) * p.pageSize;
    const rows = p.filtered.slice(start, start + p.pageSize);

    tbody.innerHTML = rows.map(s => {
        const isHeld = heldIds.has(s.id);
        const pfx = s.currency === 'USD' ? '$' : '';
        const chg = s.change_1d_pct ?? 0;
        const chgCls = chg > 0 ? 'pos' : (chg < 0 ? 'neg' : 'neu');
        const armyIcon = s.army === '多方排列' ? '🟢' : (s.army === '空方排列' ? '🔴' : '⚪');

        return `
            <tr class="main-row">
                <td style="display:flex;gap:5px;">
                    ${isHeld
                        ? `<button class="btn btn-xs" disabled>✓ 已在投組</button>`
                        : `<button class="btn btn-xs btn-primary" data-add-stock="${s.id}">+ 加入投組</button>`}
                    <button class="btn btn-xs" data-calc-stock="${s.id}" title="帶入上方 10 秒試算表計算安全買進張數">🧮 試算</button>
                </td>
                <td class="num" style="font-weight:700;">${s.symbol}</td>
                <td>${s.name}</td>
                <td><span class="tag-pill tag-mkt">${s.market}</span></td>
                <td><span style="font-size:12px;color:var(--text-secondary)">${s.sector}</span></td>
                <td class="num">${pfx}${fmtNum(s.price, 2)}</td>
                <td class="num ${chgCls}">${chg > 0 ? '+' : ''}${fmtNum(chg, 2)}%</td>
                <td><span class="badge" style="background:${getRiskColor(s.risk_score)}">${s.risk_score}</span> <small style="color:var(--text-secondary)">${s.risk_level}</small></td>
                <td class="num">${fmtNum(s.vol_1y, 1)}%</td>
                <td class="num">${fmtNum(s.atr_pct, 2)}%</td>
                <td class="num">${fmtNum(s.beta, 2)}</td>
                <td class="num neg">${fmtNum(s.mdd_1y, 1)}%</td>
                <td class="num ${s.sharpe_1y >= 1 ? 'pos' : ''}">${fmtNum(s.sharpe_1y, 2)}</td>
                <td>${armyIcon} ${s.army}</td>
            </tr>
        `;
    }).join('');

    const totalPages = Math.max(1, Math.ceil(p.filtered.length / p.pageSize));
    document.getElementById('picker-page-info').textContent = `第 ${p.page} / ${totalPages} 頁`;
    document.getElementById('picker-prev').disabled = p.page <= 1;
    document.getElementById('picker-next').disabled = p.page >= totalPages;
}

// ==================== Analytics Panel A: Sector Treemap & Cap Bars ====================
function renderSectorHeatmapAndBars(sum) {
    const hm = document.getElementById('sector-heatmap');
    const barsEl = document.getElementById('sector-bars');
    if (!hm || !barsEl) return;
    hm.innerHTML = '';

    const cfg = appState.config;
    const W = hm.clientWidth || 560;
    const H = hm.clientHeight || 230;

    const blocks = sum.items.map(it => ({
        label: `${it.stock.symbol} ${it.stock.name}`,
        sub: `${fmtNum(it.risk.weightPct, 1)}% (${it.risk.pnlPct >= 0 ? '+' : ''}${fmtNum(it.risk.pnlPct, 1)}%)`,
        val: Math.max(0, it.risk.entryCapitalTWD),
        pnl: it.risk.pnlPct,
        isCash: false,
        overCap: it.risk.weightPct > cfg.maxStockPct + 0.05 ||
                 ((sum.sectorTotals[it.risk.sector] || 0) / sum.cap * 100) > cfg.maxSectorPct + 0.05,
    }));

    if (sum.cashTWD > 0) {
        blocks.push({
            label: '💵 保留現金緩衝',
            sub: `${fmtNum(sum.cashPct, 1)}% (${fmtCompactTWD(sum.cashTWD)})`,
            val: sum.cashTWD,
            pnl: 0,
            isCash: true,
            overCap: false,
        });
    }

    const totalVal = blocks.reduce((a, b) => a + b.val, 0);
    if (totalVal > 0) {
        blocks.sort((a, b) => b.val - a.val);
        layoutTreemap(blocks, 0, 0, W, H, totalVal, hm);
    }

    const entries = Object.entries(sum.sectorTotals)
        .map(([sec, amt]) => ({ sec, amt, pct: (amt / sum.cap) * 100 }))
        .sort((a, b) => b.pct - a.pct);

    if (entries.length === 0) {
        barsEl.innerHTML = `<div class="section-sub">加入持股後將顯示各產業資金集中度與上限門檻對照。</div>`;
        return;
    }

    const capMarkerLeft = Math.min(98, cfg.maxSectorPct);
    barsEl.innerHTML = entries.map(e => {
        const over = e.pct > cfg.maxSectorPct + 0.05;
        const color = over ? 'var(--danger)' : (e.pct > cfg.maxSectorPct * 0.8 ? 'var(--warning)' : 'var(--primary)');
        return `
            <div class="sector-bar-row">
                <div class="sector-bar-hdr">
                    <span>${over ? '🔴 ' : ''}${escapeHtml(e.sec)}</span>
                    <span class="num" style="color:${color};font-weight:600;">${fmtNum(e.pct, 1)}% (${fmtCompactTWD(e.amt)}) / 上限 ${cfg.maxSectorPct}%</span>
                </div>
                <div class="sector-bar-track">
                    <div class="sector-bar-fill" style="width:${Math.min(100, e.pct)}%;background:${color}"></div>
                    <div class="sector-cap-marker" style="left:${capMarkerLeft}%" title="單一產業上限 ${cfg.maxSectorPct}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

function layoutTreemap(nodes, x, y, w, h, total, container) {
    if (!nodes.length || total <= 0 || w < 4 || h < 4) return;
    if (nodes.length === 1) {
        const n = nodes[0];
        const div = document.createElement('div');
        div.className = 'hm-node' + (n.overCap ? ' over-cap' : '');
        div.style.left = `${x + 1}px`;
        div.style.top = `${y + 1}px`;
        div.style.width = `${Math.max(2, w - 2)}px`;
        div.style.height = `${Math.max(2, h - 2)}px`;

        if (n.isCash) div.style.background = 'linear-gradient(135deg, #1e293b, #334155)';
        else if (n.pnl > 10) div.style.background = '#15803d';
        else if (n.pnl > 0) div.style.background = '#16a34a';
        else if (n.pnl < -10) div.style.background = '#991b1b';
        else if (n.pnl < 0) div.style.background = '#dc2626';
        else div.style.background = '#0f766e';

        div.title = `${n.label}\n${n.sub}`;
        if (w > 55 && h > 34) {
            div.innerHTML = `<span class="hm-symbol">${n.label}</span>${h > 50 ? `<span class="hm-change">${n.sub}</span>` : ''}`;
        }
        container.appendChild(div);
        return;
    }

    let half = 0, splitIdx = 0;
    for (let i = 0; i < nodes.length; i++) {
        half += nodes[i].val;
        if (half >= total / 2 || i === nodes.length - 2) { splitIdx = i + 1; break; }
    }
    const leftNodes = nodes.slice(0, splitIdx);
    const rightNodes = nodes.slice(splitIdx);
    const leftSum = leftNodes.reduce((a, b) => a + b.val, 0);
    const ratio = leftSum / total;

    if (w >= h) {
        const w1 = w * ratio;
        layoutTreemap(leftNodes, x, y, w1, h, leftSum, container);
        layoutTreemap(rightNodes, x + w1, y, w - w1, h, total - leftSum, container);
    } else {
        const h1 = h * ratio;
        layoutTreemap(leftNodes, x, y, w, h1, leftSum, container);
        layoutTreemap(rightNodes, x, y + h1, w, h - h1, total - leftSum, container);
    }
}

// ==================== Analytics Panel B: Equity & Underwater Drawdown SVG ====================
function renderEquityAndDrawdownChart(sum) {
    const box = document.getElementById('equity-chart-container');
    if (!box) return;

    if (!appState.historyReady || sum.items.length === 0) {
        ['bt-cum-ret', 'bt-max-dd', 'bt-ann-vol', 'bt-sharpe'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = '--'; el.className = ''; }
        });
        box.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;text-align:center;padding:0 12px;">
            ${sum.items.length === 0 ? '請先加入持股以繪製歷史淨值與水下回撤曲線' : (appState.historyTW || appState.historyUS ? '正在載入近兩年歷史日 K 序列...' : '歷史資料尚未載入或載入失敗')}
        </div>`;
        return;
    }

    const allUS = sum.items.every(it => it.stock.market.startsWith('US'));
    const masterPack = allUS ? appState.historyUS : appState.historyTW;
    const dates = masterPack?.dates || [];
    if (dates.length < 15) return;

    const itemPriceByDate = sum.items.map(it => {
        const pk = getHistoryPack(it.stock.market);
        const arr = pk?.prices?.[it.stock.symbol] || [];
        const dArr = pk?.dates || [];
        const m = new Map();
        for (let i = 0; i < dArr.length; i++) {
            if (arr[i] != null) m.set(dArr[i], arr[i]);
        }
        return m;
    });

    let startIdx = Math.max(0, dates.length - 252);
    if (appState.chartMode === 'actual') {
        const earliestBuy = sum.items.reduce((minD, it) => {
            const bd = it.holding.buyDate || appState.config.defaultBuyDate;
            return bd < minD ? bd : minD;
        }, dates[dates.length - 1]);
        const found = dates.findIndex(d => d >= earliestBuy);
        startIdx = found >= 0 ? Math.min(found, dates.length - 5) : Math.max(0, dates.length - 60);
    }

    const sliceDates = dates.slice(startIdx);
    const equityCurve = [];

    const lastSeen = sum.items.map((it, idx) => {
        const m = itemPriceByDate[idx];
        for (let k = startIdx; k >= 0; k--) {
            if (m.has(dates[k])) return m.get(dates[k]);
        }
        return it.risk.cost || it.stock.price;
    });

    const startPrices1Y = sum.items.map((it, idx) => {
        const m = itemPriceByDate[idx];
        for (let k = startIdx; k < dates.length; k++) {
            if (m.has(dates[k])) return m.get(dates[k]);
        }
        return it.stock.price;
    });

    sliceDates.forEach(d => {
        let valTWD = Math.max(0, sum.cashTWD);
        sum.items.forEach((it, idx) => {
            const m = itemPriceByDate[idx];
            if (m.has(d)) lastSeen[idx] = m.get(d);
            const pNow = lastSeen[idx];
            const alloc = it.risk.entryCapitalTWD;

            if (appState.chartMode === 'actual') {
                const bd = it.holding.buyDate || appState.config.defaultBuyDate;
                if (d < bd) valTWD += alloc;
                else {
                    const entryRef = it.risk.cost > 0 ? it.risk.cost : pNow;
                    valTWD += alloc * (pNow / entryRef);
                }
            } else {
                const p0 = startPrices1Y[idx] > 0 ? startPrices1Y[idx] : pNow;
                valTWD += alloc * (pNow / p0);
            }
        });
        equityCurve.push(valTWD);
    });

    const baseVal = equityCurve[0] || sum.cap;
    const navPct = equityCurve.map(v => ((v / baseVal) - 1) * 100);
    let peak = equityCurve[0];
    const ddCurve = equityCurve.map(v => {
        if (v > peak) peak = v;
        return peak > 0 ? ((v / peak) - 1) * 100 : 0;
    });

    const cumRet = navPct[navPct.length - 1] || 0;
    const maxDD = Math.min(0, ...ddCurve);

    const cRets = [];
    for (let i = 1; i < equityCurve.length; i++) {
        if (equityCurve[i - 1] > 0) cRets.push(equityCurve[i] / equityCurve[i - 1] - 1);
    }
    const meanR = cRets.length ? cRets.reduce((a, b) => a + b, 0) / cRets.length : 0;
    const stdR = cRets.length > 2 ? Math.sqrt(cRets.reduce((a, b) => a + (b - meanR) ** 2, 0) / (cRets.length - 1)) : 0;
    const annVol = stdR * Math.sqrt(252) * 100;
    const sharpe = stdR > 1e-6 ? ((meanR * 252 - 0.02) / (stdR * Math.sqrt(252))) : 0;

    const cumEl = document.getElementById('bt-cum-ret');
    cumEl.textContent = `${cumRet >= 0 ? '+' : ''}${fmtNum(cumRet, 2)}%`;
    cumEl.className = cumRet >= 0 ? 'pos' : 'neg';
    document.getElementById('bt-max-dd').textContent = `${fmtNum(maxDD, 2)}%`;
    document.getElementById('bt-ann-vol').textContent = `${fmtNum(annVol, 1)}%`;
    document.getElementById('bt-sharpe').textContent = fmtNum(sharpe, 2);

    const W = 560, H = 235;
    const padL = 46, padR = 14, topY = 12, topH = 130, botY = 158, botH = 58;
    const plotW = W - padL - padR;

    const minNav = Math.min(-2, ...navPct);
    const maxNav = Math.max(2, ...navPct);
    const navSpan = Math.max(1, maxNav - minNav);

    const xOf = (i) => padL + (i / Math.max(1, navPct.length - 1)) * plotW;
    const yNav = (v) => topY + topH - ((v - minNav) / navSpan) * topH;
    const zeroY = yNav(0);

    const minDD = Math.min(-5, ...ddCurve);
    const yDD = (v) => botY + (Math.abs(v) / Math.abs(minDD)) * botH;

    const navPoints = navPct.map((v, i) => `${xOf(i).toFixed(1)},${yNav(v).toFixed(1)}`).join(' ');
    const ddPoints = ddCurve.map((v, i) => `${xOf(i).toFixed(1)},${yDD(v).toFixed(1)}`).join(' ');
    const ddArea = `${padL},${botY} ${ddPoints} ${xOf(ddCurve.length - 1).toFixed(1)},${botY}`;
    const lineColor = cumRet >= 0 ? '#00d4aa' : '#ef4444';

    box.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">
            <line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" stroke="rgba(255,255,255,0.16)" stroke-dasharray="3,3"/>
            <text x="${padL - 5}" y="${(topY + 10)}" fill="#94a3b8" font-size="10" text-anchor="end">+${maxNav.toFixed(1)}%</text>
            <text x="${padL - 5}" y="${zeroY.toFixed(1)}" fill="#94a3b8" font-size="10" text-anchor="end">0%</text>
            <text x="${padL - 5}" y="${(topY + topH)}" fill="#94a3b8" font-size="10" text-anchor="end">${minNav.toFixed(1)}%</text>
            <polyline fill="none" stroke="${lineColor}" stroke-width="2.2" points="${navPoints}"/>
            <line x1="${padL}" y1="${botY}" x2="${W - padR}" y2="${botY}" stroke="rgba(255,255,255,0.18)"/>
            <polygon fill="rgba(239,68,68,0.28)" points="${ddArea}"/>
            <polyline fill="none" stroke="#ef4444" stroke-width="1.5" points="${ddPoints}"/>
            <text x="${padL - 5}" y="${botY + 9}" fill="#94a3b8" font-size="9.5" text-anchor="end">回撤</text>
            <text x="${padL - 5}" y="${botY + botH}" fill="#ef4444" font-size="9.5" text-anchor="end">${minDD.toFixed(1)}%</text>
            <text x="${padL}" y="${H - 4}" fill="#64748b" font-size="10">${sliceDates[0]}</text>
            <text x="${W / 2}" y="${H - 4}" fill="#64748b" font-size="10" text-anchor="middle">${sliceDates[Math.floor(sliceDates.length / 2)]}</text>
            <text x="${W - padR}" y="${H - 4}" fill="#64748b" font-size="10" text-anchor="end">${sliceDates[sliceDates.length - 1]}</text>
        </svg>
    `;
}

// ==================== Analytics Panel C: Correlation Matrix ====================
function renderCorrelationMatrix(sum) {
    const box = document.getElementById('corr-matrix-container');
    const badge = document.getElementById('corr-summary-badge');
    if (!box) return;

    if (sum.items.length < 2) {
        badge.textContent = '平均相關係數: --';
        box.innerHTML = `<div class="section-sub" style="padding:20px 0;">請選擇至少 2 檔標的以計算兩兩日報酬相關係數矩陣。</div>`;
        return;
    }

    const { matrix, avgCorr } = sum.corrInfo;
    badge.textContent = `平均相關係數: ${fmtNum(avgCorr, 2)}`;
    badge.style.color = avgCorr >= 0.65 ? 'var(--danger)' : (avgCorr <= 0.3 ? 'var(--primary)' : 'var(--secondary)');

    const limit = Math.min(10, sum.items.length);
    let html = `<table class="corr-table"><thead><tr><th>標的</th>`;
    for (let j = 0; j < limit; j++) html += `<th>${sum.items[j].stock.symbol}</th>`;
    html += `</tr></thead><tbody>`;

    for (let i = 0; i < limit; i++) {
        html += `<tr><th style="text-align:left;">${sum.items[i].stock.symbol}</th>`;
        for (let j = 0; j < limit; j++) {
            const v = matrix[i]?.[j] ?? (i === j ? 1 : 0);
            let bg = 'rgba(255,255,255,0.05)', fg = '#e5e5e5';
            if (i === j) { bg = 'rgba(255,255,255,0.08)'; fg = '#94a3b8'; }
            else if (v >= 0.70) { bg = 'rgba(239, 68, 68, 0.42)'; fg = '#fecaca'; }
            else if (v >= 0.45) { bg = 'rgba(249, 115, 22, 0.28)'; fg = '#fed7aa'; }
            else if (v <= 0.05) { bg = 'rgba(0, 212, 170, 0.25)'; fg = '#a7f3d0'; }
            html += `<td style="background:${bg};color:${fg}" title="${sum.items[i].stock.name} vs ${sum.items[j].stock.name}: ${v}">${v.toFixed(2)}</td>`;
        }
        html += `</tr>`;
    }
    html += `</tbody></table>`;
    box.innerHTML = html;
}

// ==================== Analytics Panel D: VaR & Stress Tests ====================
function renderStressTests(sum) {
    const box = document.getElementById('stress-test-container');
    if (!box) return;

    const v1dPct = sum.corrInfo.var1d95 ?? (sum.portVol / Math.sqrt(252) * 1.645);
    const cv1dPct = sum.corrInfo.cvar1d95 ?? (v1dPct * 1.28);
    const v20dPct = Math.min(65, v1dPct * Math.sqrt(20));

    document.getElementById('var-1d-95').textContent = `-${fmtCompactTWD(sum.cap * (v1dPct / 100))}`;
    document.getElementById('var-1d-95-pct').textContent = `佔總本金 -${fmtNum(v1dPct, 2)}%`;
    document.getElementById('cvar-1d-95').textContent = `-${fmtCompactTWD(sum.cap * (cv1dPct / 100))}`;
    document.getElementById('cvar-1d-95-pct').textContent = `極端日平均 -${fmtNum(cv1dPct, 2)}%`;
    document.getElementById('var-20d-95').textContent = `-${fmtCompactTWD(sum.cap * (v20dPct / 100))}`;
    document.getElementById('var-20d-95-pct').textContent = `月度波動上限 -${fmtNum(v20dPct, 2)}%`;

    // Scenario 0: 全部持股同時觸發停損出場（以停損價賣出；已跌破停損者以現價賣出）
    const exitValueTWD = sum.items.reduce((acc, it) => {
        const r = it.risk;
        return acc + r.entryShares * Math.min(r.price, r.stopPrice) * r.fx;
    }, 0);
    const currentEquity = sum.cashTWD + sum.totalMarketValueTWD;
    const afterAllStop = sum.cashTWD + exitValueTWD;
    const allStopLoss = afterAllStop - currentEquity;           // 相對目前市值的回吐
    const keepRatioPct = sum.cap > 0 ? (afterAllStop / sum.cap) * 100 : 100;
    const keepDesc = keepRatioPct >= 100
        ? `停損價已高於成本，就算全部出場仍保有本金 ${fmtNum(keepRatioPct, 1)}%（獲利已部分鎖住）`
        : `驗證單筆 ${appState.config.riskPerTradePct}% 鐵律：就算全部看錯停損出場，仍保留 ${fmtNum(keepRatioPct, 1)}% 本金`;

    const scenarios = [
        {
            name: '🛡️ 紀律停損保命測試：持股全數觸發停損出場',
            desc: keepDesc,
            fixedImpact: allStopLoss,
        },
        {
            name: '📉 大盤中型修正 (-10%)',
            desc: '指數回檔 10%，個股依 Beta 值反映跌幅，公債微漲避險',
            calcShock: (st) => isBondSector(st.sector) ? +0.025 : -0.10 * Math.max(0.4, st.beta || 1.0),
        },
        {
            name: '🦢 系統性黑天鵝股災 (-25%)',
            desc: '類似 2020 疫情熔斷或 2022 升息熊市，高波動與槓桿股重挫',
            calcShock: (st) => isBondSector(st.sector) ? +0.05 : -0.25 * Math.max(0.5, st.beta || 1.0) * (st.is_leveraged ? 1.5 : 1.0),
        },
        {
            name: '💥 半導體 / AI 科技殺估值 (-30%)',
            desc: '半導體、AI 與科技成長股回檔 30%，金融/傳產/高股息僅小跌 8%',
            calcShock: (st) => {
                if (isBondSector(st.sector)) return +0.03;
                if (isTechSector(st.sector)) return -0.30 * Math.max(0.7, Math.min(1.5, st.beta || 1.1));
                return -0.08;
            },
        },
        {
            name: '💱 台幣急升 +5% 匯兌衝擊',
            desc: '美元資產、美股與海外/美債 ETF 產生約 -5% 匯兌折損',
            calcShock: (st) => (st.currency === 'USD' || st.sector.includes('海外') || st.sector.includes('債券')) ? -0.05 : 0.0,
        },
    ];

    box.innerHTML = scenarios.map((sc, idx) => {
        let impactTWD = 0;
        if (sc.fixedImpact !== undefined) {
            impactTWD = sc.fixedImpact;
        } else {
            sum.items.forEach(it => {
                const shock = Math.max(-0.85, sc.calcShock(it.stock));
                impactTWD += it.risk.marketValueTWD * shock;
            });
        }
        const impactPct = sum.cap > 0 ? (impactTWD / sum.cap) * 100 : 0;
        const afterEquity = sum.cashTWD + sum.totalMarketValueTWD + impactTWD;
        const cls = impactPct <= -12 ? 'neg' : (impactPct < 0 ? 'warn-txt' : 'pos');
        const rowStyle = idx === 0 ? 'border-color:rgba(0,212,170,0.4);background:rgba(0,212,170,0.07);' : '';

        return `
            <div class="stress-row" style="${rowStyle}">
                <div>
                    <b>${sc.name}</b>
                    <small>${sc.desc}</small>
                </div>
                <div class="num ${cls}" style="text-align:right;font-weight:700;">
                    ${impactTWD >= 0 ? '+' : ''}${fmtCompactTWD(impactTWD)}
                    <small class="${cls}">${impactPct >= 0 ? '+' : ''}${fmtNum(impactPct, 2)}% 本金</small>
                </div>
                <div class="num" style="text-align:right;">
                    ${fmtCompactTWD(afterEquity)}
                    <small>衝擊後留存資產</small>
                </div>
            </div>
        `;
    }).join('');
}

function isBondSector(sec) { return (sec || '').includes('債券'); }
function isTechSector(sec) {
    const s = sec || '';
    return ['半導體', '電腦週邊', '電子零組件', '光電', '通信網路', '資訊服務', '數位雲端', '其他電子', '科技', 'AI'].some(k => s.includes(k));
}

// ==================== Section 6: Actionable Risk Checklist ====================
function renderRiskChecklist(sum) {
    const listEl = document.getElementById('risk-checklist');
    if (!listEl) return;
    const cfg = appState.config;
    const alerts = [];

    if (sum.items.length === 0) {
        listEl.innerHTML = `<div class="chk-item chk-ok"><span>ℹ️</span><div>請先選擇股票加入投組，系統將即時依「五檔分倉、單筆 2% 鐵律、1:3 風報比」產生專屬風控體檢報告。</div></div>`;
        return;
    }

    if (sum.cashTWD < 0) {
        alerts.push({
            lv: 'crit', icon: '🚨',
            msg: `<b>配置金額超出總本金！</b> 目前已配置 <b>${fmtMoney(sum.totalEntryTWD)}</b>，超出總本金 ${fmtMoney(Math.abs(sum.cashTWD))}，請點選「一鍵裁切超標部位」。`,
        });
    } else if (sum.cashPct < cfg.minCashPct - 0.1) {
        const needTrim = (cfg.minCashPct / 100) * sum.cap - sum.cashTWD;
        alerts.push({
            lv: 'warn', icon: '💧',
            msg: `<b>現金安全墊不足：</b> 目前保留現金僅 <b>${fmtNum(sum.cashPct, 1)}%</b>（低於設定門檻 ${cfg.minCashPct}%），建議釋出約 <b>${fmtMoney(needTrim)}</b> 現金。`,
        });
    }

    sum.items.forEach(it => {
        if (it.risk.weightPct > cfg.maxStockPct + 0.05) {
            const excess = it.risk.entryCapitalTWD - sum.cap * (cfg.maxStockPct / 100);
            alerts.push({
                lv: 'crit', icon: '🔴',
                msg: `<b>違反分倉上限：</b> <b>${it.stock.symbol} ${it.stock.name}</b> 佔總本金 <b>${fmtNum(it.risk.weightPct, 1)}%</b>，超過五檔分倉上限 ${cfg.maxStockPct}%，建議減碼約 <b>${fmtMoney(excess)}</b>。`,
            });
        }
        if (it.risk.stopBreached) {
            alerts.push({
                lv: 'crit', icon: '🛑',
                msg: `<b>觸發停損紅線（嚴禁死扛凹單）：</b> <b>${it.stock.symbol} ${it.stock.name}</b> 現價 <b>${it.stock.price}</b> 已低於停損價 <b>${it.risk.stopPrice}</b>，請務必遵守停損紀律，切勿讓小賠變大賠！`,
            });
        } else if (it.risk.stopLossCapPct > cfg.riskPerTradePct + 0.05) {
            alerts.push({
                lv: 'warn', icon: '⚠️',
                msg: `<b>違反單筆 ${cfg.riskPerTradePct}% 保命鐵律：</b> <b>${it.stock.symbol} ${it.stock.name}</b> 若觸發停損將虧損 <b>${fmtMoney(it.risk.stopLossAmtTWD)}</b>（佔本金 ${fmtNum(it.risk.stopLossCapPct, 2)}%），建議點選「🎯 依停損風險反推部位」降至 <b>${fmtMoney(it.risk.recommendedMaxTWD)}</b> 以內。`,
            });
        }
        if (it.risk.rrRatio < 2.95) {
            alerts.push({
                lv: 'warn', icon: '⚖️',
                msg: `<b>買進必問第 ③ 題提醒：</b> <b>${it.stock.symbol} ${it.stock.name}</b> 目前預估風報比僅 <b>1 : ${fmtNum(it.risk.rrRatio, 1)}</b>（未達 1:3 標準），可點選「🧮 10秒精算」重新檢視支撐停損與波段目標空間。`,
            });
        }
    });

    Object.entries(sum.sectorTotals).forEach(([sec, amt]) => {
        const pct = (amt / sum.cap) * 100;
        if (pct > cfg.maxSectorPct + 0.05) {
            const excess = amt - sum.cap * (cfg.maxSectorPct / 100);
            alerts.push({
                lv: 'crit', icon: '🏭',
                msg: `<b>單一產業過度集中：</b> 「<b>${escapeHtml(sec)}</b>」合計佔總本金 <b>${fmtNum(pct, 1)}%</b>，超過產業上限 ${cfg.maxSectorPct}%（超出 ${fmtMoney(excess)}），請分散至不同產業強勢股。`,
            });
        }
    });

    if (sum.corrInfo.highPairs.length > 0) {
        const topP = sum.corrInfo.highPairs.slice(0, 3).map(p => `${p.a}/${p.b} (r=${p.corr})`).join('、');
        alerts.push({
            lv: 'warn', icon: '🔗',
            msg: `<b>假分散提醒（高度同漲同跌）：</b> 偵測到 ${sum.corrInfo.highPairs.length} 組持股近一年相關係數 ≥ 0.70：<b>${topP}</b>，大盤拉回時容易同步下跌。`,
        });
    }

    if (alerts.length === 0) {
        alerts.push({
            lv: 'ok', icon: '✅',
            msg: `<b>恭喜！全數通過「五檔分倉 ＋ 單筆 ${cfg.riskPerTradePct}% 停損鐵律 ＋ 1:3 高風報比」風控檢核！</b> 風險已完全鎖死，安心讓波段獲利奔跑！`,
        });
    }

    listEl.innerHTML = alerts.map(a => {
        const cls = a.lv === 'crit' ? 'chk-crit' : (a.lv === 'warn' ? 'chk-warn' : 'chk-ok');
        return `<div class="chk-item ${cls}"><span style="font-size:17px;">${a.icon}</span><div>${a.msg}</div></div>`;
    }).join('');
}

// ==================== Portfolio Actions & Smart Sizing ====================
function addStockToPortfolio(stockId, customAmountTWD = null, customStop = null, customTarget = null, customEntry = null) {
    const st = appState.stockMap.get(stockId);
    if (!st) return;

    const cfg = appState.config;
    const buyDate = cfg.defaultBuyDate || getOffsetDateStr(0);
    const hs = lookupHistoricalStats(st, buyDate);
    // 從試算表加入：以「預計買進價」為成本、買入日為今天
    const planEntry = (customEntry && customEntry > 0) ? Number(customEntry) : st.price;
    const costPrice = customStop ? planEntry : (hs?.entryClose || st.price);

    const existing = appState.holdings.find(h => h.id === stockId);
    if (existing) {
        if (customAmountTWD != null) existing.amountTWD = Math.round(customAmountTWD / 1000) * 1000;
        if (customStop != null) {
            existing.buyDate = getOffsetDateStr(0);
            existing.costPrice = planEntry;
            existing.customCost = true;
            existing.customStopPrice = customStop;
        }
        if (customTarget != null) existing.customTargetPrice = customTarget;
        refreshAllRiskViews();
        return;
    }

    const used = appState.holdings.reduce((s, h) => s + Number(h.amountTWD || 0), 0);
    const maxInvestable = cfg.totalCapital * (1 - cfg.minCashPct / 100);
    const remaining = Math.max(0, maxInvestable - used);
    const defaultAmt = customAmountTWD != null
        ? customAmountTWD
        : Math.min(
            cfg.totalCapital * (cfg.maxStockPct / 100),
            remaining > 10000 ? Math.min(remaining, cfg.totalCapital * 0.17) : cfg.totalCapital * 0.15
        );

    appState.holdings.push({
        id: st.id,
        symbol: st.symbol,
        market: st.market,
        customSector: st.sector,
        buyDate: customStop ? getOffsetDateStr(0) : buyDate,
        costPrice,
        customCost: Boolean(customStop),
        customStopPrice: customStop || null,
        customTargetPrice: customTarget || null,
        amountTWD: Math.round(defaultAmt / 1000) * 1000,
        openDetail: false,
    });

    renderPickerTable();
    refreshAllRiskViews();
}

function allocateEqualWeight() {
    const n = appState.holdings.length;
    if (!n) return;
    const cfg = appState.config;
    const investable = cfg.totalCapital * (1 - cfg.minCashPct / 100);
    const perStock = Math.min(investable / n, cfg.totalCapital * (cfg.maxStockPct / 100));
    appState.holdings.forEach(h => { h.amountTWD = Math.round(perStock / 1000) * 1000; });
    refreshAllRiskViews();
}

function allocateRiskParity() {
    const n = appState.holdings.length;
    if (!n) return;
    const cfg = appState.config;
    const investable = cfg.totalCapital * (1 - cfg.minCashPct / 100);
    const invVols = appState.holdings.map(h => 1 / Math.max(6, appState.stockMap.get(h.id)?.vol_1y || 25));
    const totalInv = invVols.reduce((a, b) => a + b, 0);
    const maxPerStock = cfg.totalCapital * (cfg.maxStockPct / 100);

    appState.holdings.forEach((h, i) => {
        const raw = investable * (invVols[i] / totalInv);
        h.amountTWD = Math.round(Math.min(maxPerStock, raw) / 1000) * 1000;
    });
    refreshAllRiskViews();
}

function allocateByStopRiskSizing() {
    if (!appState.holdings.length) return;
    const cfg = appState.config;
    const investable = cfg.totalCapital * (1 - cfg.minCashPct / 100);
    let sumRec = 0;
    const recs = appState.holdings.map(h => {
        const st = appState.stockMap.get(h.id);
        const r = computeHoldingRisk(h, st);
        sumRec += r.recommendedMaxTWD;
        return r.recommendedMaxTWD;
    });
    const scale = sumRec > investable && sumRec > 0 ? investable / sumRec : 1.0;
    appState.holdings.forEach((h, i) => {
        h.amountTWD = Math.round((recs[i] * scale) / 1000) * 1000;
    });
    refreshAllRiskViews();
}

function trimOverCapPositions() {
    if (!appState.holdings.length) return;
    const cfg = appState.config;
    const cap = cfg.totalCapital;
    const maxSingle = cap * (cfg.maxStockPct / 100);
    const maxSec = cap * (cfg.maxSectorPct / 100);
    const maxInvestable = cap * (1 - cfg.minCashPct / 100);

    appState.holdings.forEach(h => {
        if (h.amountTWD > maxSingle) h.amountTWD = Math.floor(maxSingle / 1000) * 1000;
    });

    const secGroups = {};
    appState.holdings.forEach(h => {
        const st = appState.stockMap.get(h.id);
        const sec = h.customSector || st?.sector || '其他';
        if (!secGroups[sec]) secGroups[sec] = [];
        secGroups[sec].push(h);
    });
    Object.values(secGroups).forEach(list => {
        const tot = list.reduce((a, b) => a + b.amountTWD, 0);
        if (tot > maxSec && tot > 0) {
            const ratio = maxSec / tot;
            list.forEach(h => { h.amountTWD = Math.floor((h.amountTWD * ratio) / 1000) * 1000; });
        }
    });

    const totalNow = appState.holdings.reduce((a, b) => a + b.amountTWD, 0);
    if (totalNow > maxInvestable && totalNow > 0) {
        const ratio = maxInvestable / totalNow;
        appState.holdings.forEach(h => { h.amountTWD = Math.floor((h.amountTWD * ratio) / 1000) * 1000; });
    }
    refreshAllRiskViews();
}

// ==================== Presets & Demo Portfolios ====================
function applyRiskPreset(presetName) {
    const cfg = appState.config;
    cfg.preset = presetName;
    cfg.disciplineMode = false;

    if (presetName === 'video') {
        cfg.winRate = 70;
        cfg.minCashPct = 15;
        cfg.maxStockPct = 20;      // 5 檔分倉
        cfg.maxSectorPct = 35;
        cfg.riskPerTradePct = 2.0; // 單筆鎖死 2% ($20,000)
        cfg.stopMode = 'fixed';
        cfg.stopParam = 8;
        cfg.tpPct = 30;            // 風報比 30 / 8 = 3.75 (≥ 1:3)
        cfg.entryMode = 'lump';
    } else if (presetName === 'conservative') {
        cfg.minCashPct = 30;
        cfg.maxStockPct = 12;
        cfg.maxSectorPct = 25;
        cfg.riskPerTradePct = 1.0;
        cfg.stopMode = 'fixed';
        cfg.stopParam = 7;
        cfg.tpPct = 25;
        cfg.entryMode = 'dca4';
    } else if (presetName === 'balanced') {
        cfg.minCashPct = 20;
        cfg.maxStockPct = 20;
        cfg.maxSectorPct = 35;
        cfg.riskPerTradePct = 1.5;
        cfg.stopMode = 'fixed';
        cfg.stopParam = 8;
        cfg.tpPct = 25;
        cfg.entryMode = 'pyramid3';
    } else if (presetName === 'aggressive') {
        cfg.minCashPct = 10;
        cfg.maxStockPct = 25;
        cfg.maxSectorPct = 45;
        cfg.riskPerTradePct = 2.0;
        cfg.stopMode = 'atr';
        cfg.stopParam = 2.0;
        cfg.tpPct = 40;
        cfg.entryMode = 'lump';
    } else if (presetName === 'discipline') {
        cfg.disciplineMode = true;
        cfg.minCashPct = 25;
        cfg.maxStockPct = 20;
        cfg.maxSectorPct = 35;
        cfg.riskPerTradePct = 2.0;
        cfg.stopMode = 'ma60';
        cfg.tpPct = 30;
        cfg.entryMode = 'pyramid3';
    }

    document.querySelectorAll('.quick-filters .btn-primary, #preset-discipline').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`preset-${presetName}`);
    if (activeBtn) activeBtn.classList.add('active');

    syncConfigInputs();
    refreshAllRiskViews();
}

function loadDemoPortfolio(type = 'tw', triggerRender = true) {
    const cap = appState.config.totalCapital || 1000000;
    const d180 = getOffsetDateStr(180);
    const d90 = getOffsetDateStr(90);
    const d45 = getOffsetDateStr(45);

    // 預設示範：100 萬本金，分成 5 檔不同產業標的分散布局，單筆風險控制在 2% 以內
    const picks = type === 'global'
        ? [
            { id: 'TW:2330', weight: 0.18, buyDate: d180 },
            { id: 'TW:0050', weight: 0.17, buyDate: d180 },
            { id: 'US:NVDA', weight: 0.16, buyDate: d90 },
            { id: 'US:QQQ',  weight: 0.17, buyDate: d90 },
            { id: 'US:TLT',  weight: 0.15, buyDate: d45 },
          ]
        : [
            { id: 'TW:2330',   weight: 0.18, buyDate: d180 }, // 半導體 (台積電)
            { id: 'TW:2317',   weight: 0.17, buyDate: d45 },  // 其他電子 (鴻海)
            { id: 'TW:2881',   weight: 0.17, buyDate: d180 }, // 金融保險 (富邦金)
            { id: 'TW:0050',   weight: 0.17, buyDate: d90 },  // 台股ETF・市值型
            { id: 'TW:00679B', weight: 0.15, buyDate: d45 },  // 台股ETF・債券型
          ];

    appState.holdings = [];
    picks.forEach(p => {
        const st = appState.stockMap.get(p.id);
        if (!st) return;
        const hs = lookupHistoricalStats(st, p.buyDate);
        appState.holdings.push({
            id: st.id,
            symbol: st.symbol,
            market: st.market,
            customSector: st.sector,
            buyDate: p.buyDate,
            costPrice: hs?.entryClose || st.price,
            customCost: false,
            customStopPrice: null,
            customTargetPrice: null,
            amountTWD: Math.round((cap * p.weight) / 1000) * 1000,
            openDetail: false,
        });
    });

    if (triggerRender) {
        renderPickerTable();
        refreshAllRiskViews();
    }
}

// ==================== Sync Inputs & Event Listeners ====================
function syncConfigInputs() {
    const cfg = appState.config;
    const setIfIdle = (id, val) => {
        const el = document.getElementById(id);
        if (el && document.activeElement !== el) el.value = val;
    };
    document.getElementById('cfg-win-rate').value = cfg.winRate;
    setIfIdle('fx-rate', Number(cfg.fxRate).toFixed(2));
    setIfIdle('cfg-total-capital', cfg.totalCapital);
    document.getElementById('lbl-total-capital').textContent = fmtCompactTWD(cfg.totalCapital);

    document.getElementById('cfg-min-cash').value = cfg.minCashPct;
    document.getElementById('val-min-cash').textContent = cfg.minCashPct;
    document.getElementById('hint-investable').textContent = `可投入上限: ${fmtMoney(cfg.totalCapital * (1 - cfg.minCashPct / 100))}`;

    document.getElementById('cfg-max-stock').value = cfg.maxStockPct;
    document.getElementById('val-max-stock').textContent = cfg.maxStockPct;
    document.getElementById('hint-max-stock').textContent = `單檔上限: ${fmtMoney(cfg.totalCapital * (cfg.maxStockPct / 100))}`;

    document.getElementById('cfg-max-sector').value = cfg.maxSectorPct;
    document.getElementById('val-max-sector').textContent = cfg.maxSectorPct;
    document.getElementById('hint-max-sector').textContent = `單一產業上限: ${fmtMoney(cfg.totalCapital * (cfg.maxSectorPct / 100))}`;

    document.getElementById('cfg-risk-per-trade').value = cfg.riskPerTradePct;
    document.getElementById('val-risk-per-trade').textContent = cfg.riskPerTradePct;
    document.getElementById('hint-risk-per-trade').textContent = `單檔觸發停損最多賠: ${fmtMoney(cfg.totalCapital * (cfg.riskPerTradePct / 100))}`;

    document.getElementById('cfg-stop-mode').value = cfg.stopMode;
    const stopSlider = document.getElementById('cfg-stop-param');
    const stopLbl = document.getElementById('lbl-stop-param');
    if (cfg.stopMode === 'fixed' || cfg.stopMode === 'trailing') {
        stopSlider.style.display = 'block';
        stopSlider.min = 3; stopSlider.max = 30; stopSlider.step = 1;
        if (cfg.stopParam < 3) cfg.stopParam = 8;
        stopSlider.value = cfg.stopParam;
        stopLbl.textContent = `-${cfg.stopParam}%`;
    } else if (cfg.stopMode === 'atr') {
        stopSlider.style.display = 'block';
        stopSlider.min = 1.0; stopSlider.max = 4.0; stopSlider.step = 0.5;
        if (cfg.stopParam > 4) cfg.stopParam = 2.0;
        stopSlider.value = cfg.stopParam;
        stopLbl.textContent = `${cfg.stopParam}× ATR`;
    } else {
        stopSlider.style.display = 'none';
        stopLbl.textContent = cfg.stopMode.toUpperCase();
    }

    document.getElementById('cfg-default-buy-date').value = cfg.defaultBuyDate;
    document.getElementById('cfg-entry-mode').value = cfg.entryMode;
    document.getElementById('cfg-tp-pct').value = cfg.tpPct;
    document.getElementById('val-tp-pct').textContent = cfg.tpPct;
}

function setupEventListeners() {
    const cfg = appState.config;

    // Win Rate Slider in AI HUD
    document.getElementById('cfg-win-rate').addEventListener('input', e => {
        cfg.winRate = Number(e.target.value) || 70;
        renderVideoHUD(computePortfolioSummary());
        saveState();
    });

    // 10-Second Calculator Inputs & Autocomplete
    ['calc-entry-price', 'calc-stop-price', 'calc-target-price'].forEach(id => {
        document.getElementById(id).addEventListener('input', e => {
            const val = Number(e.target.value) || 0;
            if (id === 'calc-entry-price') appState.calc.entryPrice = val;
            if (id === 'calc-stop-price') appState.calc.stopPrice = val;
            if (id === 'calc-target-price') appState.calc.targetPrice = val;
            renderTenSecCalculator();
        });
    });

    // Calculator Quick Stop & Target Chips
    document.querySelectorAll('[data-calc-stop]').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.calcStop;
            const st = appState.calc.pickedStockId ? appState.stockMap.get(appState.calc.pickedStockId) : null;
            const entry = appState.calc.entryPrice || st?.price || 100;
            let sVal = entry * 0.92;
            if (mode === 'pct5') sVal = entry * 0.95;
            else if (mode === 'pct8') sVal = entry * 0.92;
            else if (mode === 'ma20') sVal = st?.ma20 || entry * 0.95;
            else if (mode === 'ma60') sVal = st?.ma60 || entry * 0.90;
            else if (mode === 'turtle') sVal = st?.turtle_low || entry * 0.92;
            appState.calc.stopPrice = Number(sVal.toFixed(2));
            document.getElementById('calc-stop-price').value = appState.calc.stopPrice;
            renderTenSecCalculator();
        });
    });

    document.querySelectorAll('[data-calc-tp]').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.calcTp;
            const st = appState.calc.pickedStockId ? appState.stockMap.get(appState.calc.pickedStockId) : null;
            const entry = appState.calc.entryPrice || 110;
            const diff = Math.max(entry * 0.02, entry - (appState.calc.stopPrice || entry * 0.92));
            let tVal = entry + diff * 3.0;
            if (mode === 'rr3') tVal = entry + diff * 3.0;
            else if (mode === 'rr5') tVal = entry + diff * 5.0;
            else if (mode === 'rr75') tVal = entry + diff * 7.5;
            else if (mode === 'high52') tVal = (st?.high_52w && st.high_52w > entry) ? st.high_52w : entry * 1.3;
            appState.calc.targetPrice = Number(tVal.toFixed(2));
            document.getElementById('calc-target-price').value = appState.calc.targetPrice;
            renderTenSecCalculator();
        });
    });

    document.getElementById('btn-calc-video-demo').addEventListener('click', () => {
        appState.calc.pickedStockId = null;
        appState.calc.entryPrice = 110;
        appState.calc.stopPrice = 100;
        appState.calc.targetPrice = 145;
        cfg.totalCapital = 1000000;
        cfg.riskPerTradePct = 2.0;
        document.getElementById('calc-stock-search').value = '';
        document.getElementById('calc-entry-price').value = 110;
        document.getElementById('calc-stop-price').value = 100;
        document.getElementById('calc-target-price').value = 145;
        syncConfigInputs();
        refreshAllRiskViews();
    });

    // Calculator Stock Search Autocomplete
    const calcSearch = document.getElementById('calc-stock-search');
    const suggestMenu = document.getElementById('calc-suggest-menu');
    calcSearch.addEventListener('input', () => {
        const q = calcSearch.value.trim().toLowerCase();
        if (!q) { suggestMenu.style.display = 'none'; return; }
        const matches = appState.universe.filter(s =>
            s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
        ).slice(0, 12);
        if (!matches.length) { suggestMenu.style.display = 'none'; return; }
        suggestMenu.innerHTML = matches.map(s => `
            <div class="calc-suggest-item" data-pick-calc="${s.id}">
                <span><b>${s.symbol}</b> ${s.name} <small style="color:var(--text-muted)">(${s.sector})</small></span>
                <span class="num" style="color:var(--secondary)">${s.currency === 'USD' ? '$' : ''}${s.price}</span>
            </div>
        `).join('');
        suggestMenu.style.display = 'block';
    });

    suggestMenu.addEventListener('click', e => {
        const item = e.target.closest('[data-pick-calc]');
        if (!item) return;
        const st = appState.stockMap.get(item.dataset.pickCalc);
        suggestMenu.style.display = 'none';
        loadStockIntoCalculator(st);
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('.calc-stock-picker')) {
            suggestMenu.style.display = 'none';
        }
    });

    document.getElementById('btn-calc-add-portfolio').addEventListener('click', () => {
        const sz = computeCalcSizing();
        if (!sz.st) return;
        if (!sz.validStop) {
            alert('停損價必須低於預計買進價，請先修正停損價。');
            return;
        }
        addStockToPortfolio(sz.st.id, sz.finalSafeTWD, sz.stop, sz.target, sz.entry);
        const pf = document.getElementById('portfolio-table-wrap');
        if (pf) pf.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // FX Rate & Capital
    document.getElementById('fx-rate').addEventListener('change', e => {
        cfg.fxRate = Math.min(50, Math.max(20, Number(e.target.value) || 32.9));
        cfg.fxManual = true;
        e.target.value = cfg.fxRate.toFixed(2);
        refreshAllRiskViews();
    });

    // 總投資本金：輸入中只在數值合理時即時套用，離開欄位時才做下限校正，避免打字到一半被覆蓋
    const bindCapitalInput = (id) => {
        const el = document.getElementById(id);
        el.addEventListener('input', debounce(e => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v) || v < 10000) return;
            cfg.totalCapital = Math.min(1e10, v);
            syncConfigInputs();
            refreshAllRiskViews();
        }, 250));
        el.addEventListener('change', e => {
            const v = Number(e.target.value);
            cfg.totalCapital = Number.isFinite(v) && v >= 10000 ? Math.min(1e10, v) : (cfg.totalCapital || 1000000);
            e.target.value = cfg.totalCapital;
            syncConfigInputs();
            refreshAllRiskViews();
        });
    };
    bindCapitalInput('calc-capital');
    bindCapitalInput('cfg-total-capital');

    document.querySelectorAll('[data-cap]').forEach(btn => {
        btn.addEventListener('click', () => {
            cfg.totalCapital = Number(btn.dataset.cap);
            syncConfigInputs();
            refreshAllRiskViews();
        });
    });

    // Config Range Sliders
    const sliderMap = [
        ['cfg-min-cash', 'minCashPct', parseFloat],
        ['cfg-max-stock', 'maxStockPct', parseFloat],
        ['cfg-max-sector', 'maxSectorPct', parseFloat],
        ['cfg-risk-per-trade', 'riskPerTradePct', parseFloat],
        ['cfg-stop-param', 'stopParam', parseFloat],
        ['cfg-tp-pct', 'tpPct', parseFloat],
    ];
    sliderMap.forEach(([id, key, parser]) => {
        const el = document.getElementById(id);
        el.addEventListener('input', e => {
            cfg[key] = parser(e.target.value);
            syncConfigInputs();
            refreshAllRiskViews(true);
        });
        el.addEventListener('change', () => refreshAllRiskViews(false));
    });

    document.getElementById('cfg-stop-mode').addEventListener('change', e => {
        cfg.stopMode = e.target.value;
        if (cfg.stopMode === 'atr') cfg.stopParam = 2.0;
        else if (cfg.stopMode === 'fixed' || cfg.stopMode === 'trailing') cfg.stopParam = 8;
        appState.holdings.forEach(h => { h.customStopPrice = null; });
        syncConfigInputs();
        refreshAllRiskViews();
    });

    document.getElementById('cfg-entry-mode').addEventListener('change', e => {
        cfg.entryMode = e.target.value;
        refreshAllRiskViews();
    });

    document.getElementById('cfg-default-buy-date').addEventListener('change', e => {
        cfg.defaultBuyDate = e.target.value;
        saveState();
    });

    document.querySelectorAll('[data-date-offset]').forEach(btn => {
        btn.addEventListener('click', () => {
            cfg.defaultBuyDate = getOffsetDateStr(btn.dataset.dateOffset);
            document.getElementById('cfg-default-buy-date').value = cfg.defaultBuyDate;
            saveState();
        });
    });

    document.getElementById('btn-apply-date-all').addEventListener('click', () => {
        const d = cfg.defaultBuyDate || getOffsetDateStr(0);
        appState.holdings.forEach(h => {
            h.buyDate = d;
            h.customCost = false;
            h.customStopPrice = null;
            const st = appState.stockMap.get(h.id);
            if (st) {
                const hs = lookupHistoricalStats(st, d);
                h.costPrice = hs?.entryClose || st.price;
            }
        });
        refreshAllRiskViews();
    });

    // Presets & Demos
    document.getElementById('preset-video').addEventListener('click', () => applyRiskPreset('video'));
    document.getElementById('preset-conservative').addEventListener('click', () => applyRiskPreset('conservative'));
    document.getElementById('preset-balanced').addEventListener('click', () => applyRiskPreset('balanced'));
    document.getElementById('preset-aggressive').addEventListener('click', () => applyRiskPreset('aggressive'));
    document.getElementById('preset-discipline').addEventListener('click', () => applyRiskPreset('discipline'));
    document.getElementById('demo-tw').addEventListener('click', () => loadDemoPortfolio('tw'));
    document.getElementById('demo-global').addEventListener('click', () => loadDemoPortfolio('global'));
    document.getElementById('btn-clear-all').addEventListener('click', () => {
        appState.holdings = [];
        renderPickerTable();
        refreshAllRiskViews();
    });

    document.getElementById('btn-alloc-equal').addEventListener('click', allocateEqualWeight);
    document.getElementById('btn-alloc-risk-parity').addEventListener('click', allocateRiskParity);
    document.getElementById('btn-alloc-atr-sizing').addEventListener('click', allocateByStopRiskSizing);
    document.getElementById('btn-alloc-trim-cap').addEventListener('click', trimOverCapPositions);

    // Portfolio Table Delegation
    const pfTbody = document.getElementById('portfolio-tbody');
    pfTbody.addEventListener('input', e => {
        const t = e.target;
        const h = appState.holdings.find(x => x.id === t.dataset.id);
        if (!h) return;

        if (t.dataset.act === 'amount') {
            h.amountTWD = Math.max(0, Number(t.value) || 0);
            refreshAllRiskViews(true);
        } else if (t.dataset.act === 'cost') {
            h.costPrice = Math.max(0.01, Number(t.value) || h.costPrice);
            h.customCost = true;
            refreshAllRiskViews(true);
        } else if (t.dataset.act === 'weight-slider') {
            const pct = Number(t.value) || 0;
            h.amountTWD = Math.round((cfg.totalCapital * (pct / 100)) / 1000) * 1000;
            const amtInput = pfTbody.querySelector(`[data-act="amount"][data-id="${h.id}"]`);
            if (amtInput) amtInput.value = h.amountTWD;
            refreshAllRiskViews(true);
        }
    });

    pfTbody.addEventListener('change', e => {
        const t = e.target;
        const h = appState.holdings.find(x => x.id === t.dataset.id);
        if (!h) return;

        if (t.dataset.act === 'sector') {
            h.customSector = t.value;
            refreshAllRiskViews();
        } else if (t.dataset.act === 'buydate') {
            h.buyDate = t.value;
            h.customCost = false;
            const st = appState.stockMap.get(h.id);
            if (st) {
                const hs = lookupHistoricalStats(st, h.buyDate);
                if (hs?.entryClose) h.costPrice = hs.entryClose;
            }
            refreshAllRiskViews();
        }
    });

    pfTbody.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (btn) {
            const id = btn.dataset.id;
            const h = appState.holdings.find(x => x.id === id);
            if (btn.dataset.act === 'remove') {
                appState.holdings = appState.holdings.filter(x => x.id !== id);
                renderPickerTable();
                refreshAllRiskViews();
            } else if (btn.dataset.act === 'step-amt' && h) {
                h.amountTWD = Math.max(0, (Number(h.amountTWD) || 0) + (Number(btn.dataset.step) || 0));
                refreshAllRiskViews();
            } else if (btn.dataset.act === 'reset-cost' && h) {
                h.customCost = false;
                const st = appState.stockMap.get(h.id);
                if (st) {
                    const hs = lookupHistoricalStats(st, h.buyDate);
                    h.costPrice = hs?.entryClose || st.price;
                }
                refreshAllRiskViews();
            } else if (btn.dataset.act === 'load-calc' && h) {
                const st = appState.stockMap.get(h.id);
                if (st) {
                    loadStockIntoCalculator(st);
                    document.getElementById('calc-stock-search').scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
            return;
        }

        const toggleCell = e.target.closest('[data-toggle-detail]');
        if (toggleCell) {
            const id = toggleCell.dataset.toggleDetail;
            const h = appState.holdings.find(x => x.id === id);
            if (h) {
                h.openDetail = !h.openDetail;
                const det = document.getElementById(`detail-${id}`);
                if (det) det.classList.toggle('open', h.openDetail);
            }
        }
    });

    // Picker Controls
    document.getElementById('picker-market-tabs').addEventListener('click', e => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        document.querySelectorAll('#picker-market-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        appState.picker.market = btn.dataset.mkt;
        appState.picker.sector = 'ALL';
        renderSectorPills(computePortfolioSummary());
        applyPickerFilters();
    });

    document.getElementById('sector-pills-container').addEventListener('click', e => {
        const pill = e.target.closest('.sector-pill');
        if (!pill) return;
        appState.picker.sector = pill.dataset.sec;
        renderSectorPills(computePortfolioSummary());
        applyPickerFilters();
    });

    document.getElementById('picker-search').addEventListener('input', debounce(e => {
        appState.picker.search = e.target.value;
        applyPickerFilters();
    }, 180));

    document.getElementById('picker-risk-level').addEventListener('change', e => {
        appState.picker.riskLevel = e.target.value;
        applyPickerFilters();
    });
    document.getElementById('picker-army').addEventListener('change', e => {
        appState.picker.army = e.target.value;
        applyPickerFilters();
    });
    document.getElementById('picker-sort').addEventListener('change', e => {
        appState.picker.sort = e.target.value;
        applyPickerFilters();
    });

    document.getElementById('picker-tbody').addEventListener('click', e => {
        const addBtn = e.target.closest('[data-add-stock]');
        if (addBtn) { addStockToPortfolio(addBtn.dataset.addStock); return; }
        const calcBtn = e.target.closest('[data-calc-stock]');
        if (calcBtn) {
            const st = appState.stockMap.get(calcBtn.dataset.calcStock);
            if (st) {
                loadStockIntoCalculator(st);
                document.getElementById('calc-stock-search').scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    });

    document.getElementById('picker-prev').addEventListener('click', () => {
        if (appState.picker.page > 1) { appState.picker.page--; renderPickerTable(); }
    });
    document.getElementById('picker-next').addEventListener('click', () => {
        const total = Math.ceil(appState.picker.filtered.length / appState.picker.pageSize);
        if (appState.picker.page < total) { appState.picker.page++; renderPickerTable(); }
    });

    document.getElementById('btn-toggle-picker-table').addEventListener('click', () => {
        appState.picker.collapsed = !appState.picker.collapsed;
        document.getElementById('picker-table-body-wrap').style.display = appState.picker.collapsed ? 'none' : 'block';
    });

    ['chart-mode-actual', 'chart-mode-1y'].forEach(id => {
        document.getElementById(id).addEventListener('click', e => {
            document.getElementById('chart-mode-actual').classList.remove('active');
            document.getElementById('chart-mode-1y').classList.remove('active');
            e.target.classList.add('active');
            appState.chartMode = e.target.dataset.mode;
            renderEquityAndDrawdownChart(computePortfolioSummary());
        });
    });

    document.getElementById('btn-export-json').addEventListener('click', () => {
        const payload = { exported_at: new Date().toISOString(), config: appState.config, holdings: appState.holdings };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `risk_portfolio_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
    });

    document.getElementById('btn-import-json').addEventListener('click', () => {
        document.getElementById('file-import-json').click();
    });

    document.getElementById('file-import-json').addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result);
                const holdings = sanitizeHoldings(parsed.holdings);
                if (!parsed || (!parsed.config && !holdings.length)) throw new Error('empty');
                Object.assign(appState.config, sanitizeConfig(parsed.config));
                const known = holdings.filter(h => appState.stockMap.size === 0 || appState.stockMap.has(h.id));
                appState.holdings = known;
                syncConfigInputs();
                renderPickerTable();
                refreshAllRiskViews();
                const skipped = holdings.length - known.length;
                showStatus(`✅ 已匯入 ${known.length} 檔持股${skipped ? `（${skipped} 檔已不在最新資料中，已略過）` : ''}。`, 'info');
            } catch (_) {
                alert('匯入格式錯誤，請選擇由本系統「匯出投組」產生的 JSON 檔案。');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    window.addEventListener('resize', debounce(() => {
        renderSectorHeatmapAndBars(computePortfolioSummary());
    }, 220));
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            config: appState.config,
            holdings: appState.holdings,
        }));
    } catch (_) {}
}

function loadSavedState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        Object.assign(appState.config, sanitizeConfig(parsed.config));
        appState.holdings = sanitizeHoldings(parsed.holdings);
    } catch (_) {
        try { localStorage.removeItem(STORAGE_KEY); } catch (__) {}
    }
}

document.addEventListener('DOMContentLoaded', init);
