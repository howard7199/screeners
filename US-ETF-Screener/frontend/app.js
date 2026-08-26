const appState = {
    screenerData: null,
    temperatureData: null,
    filteredData: [],
    
    // Filters
    filters: {
        category: 'All',
        subCategory: 'All',
        signal: 'All',
        army: 'All',
        macd: 'All',
        turtle: 'All',
        momentumMin: 0,
        qualityMin: 0,
        valuationMin: 0,
        growthMin: 0,
        search: '',
        timeframe: 'daily'
    },
    
    // Sorting
    sort: {
        column: 'signal.score',
        direction: 'desc'
    },
    
    // Pagination
    page: 1,
    pageSize: 50
};

// Utilities
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

const getGaugeColor = (val) => {
    if (val == null) return 'rgba(255,255,255,0.1)';
    const hue = ((val) * 1.2).toString(10); // 0 -> 0 (red), 50 -> 60 (yellow), 100 -> 120 (green)
    return `hsl(${hue}, 100%, 50%)`;
};

// Signal label mapping: English -> Chinese
const signalLabelMap = {
    'Strong Buy': '強烈買入',
    'Buy': '買入',
    'Neutral': '中性',
    'Sell': '賣出',
    'Strong Sell': '強烈賣出'
};
const toZhSignal = (label) => signalLabelMap[label] || label || '--';

const getSignalClass = (label) => {
    if (label === 'Strong Buy') return 'sig-strong-buy';
    if (label === 'Buy') return 'sig-buy';
    if (label === 'Neutral') return 'sig-neutral';
    if (label === 'Sell') return 'sig-sell';
    if (label === 'Strong Sell') return 'sig-strong-sell';
    return 'sig-neutral';
};

const getSignalIcon = (label) => {
    if (label === 'Strong Buy') return '🔥';
    if (label === 'Buy') return '🟢';
    if (label === 'Neutral') return '🟡';
    if (label === 'Sell') return '🟠';
    if (label === 'Strong Sell') return '🔴';
    return '⚪';
};

const formatNum = (num, decimals = 2) => num != null ? Number(num).toFixed(decimals) : '--';
const formatCurrency = (num) => num != null ? '$' + Number(num).toFixed(2) : '--';
const formatAUM = (num) => {
    if (num == null) return '--';
    if (num >= 1e12) return '$' + (num / 1e12).toFixed(2) + '兆';
    if (num >= 1e8) return '$' + (num / 1e8).toFixed(2) + '億';
    if (num >= 1e4) return '$' + (num / 1e4).toFixed(0) + '萬';
    return '$' + num.toLocaleString();
};

// Category mapping: English -> Chinese
const categoryMap = {
    'Equity': '股票指數型', 'Bond': '債券型', 'Commodity': '商品型',
    'Real Estate': '不動產型', 'Sector': '產業型', 'International': '國際型',
    'Dividend': '配息型', 'Leveraged': '槓桿型', 'Thematic': '主題型',
    'Strategy': '策略型', 'Other': '其他'
};
const toZhCategory = (cat) => categoryMap[cat] || cat || '--';

// Alignment mapping
const alignmentMap = {
    'Bullish': '多方排列', 'Bearish': '空方排列', 'Mixed': '糾結'
};
const toZhAlignment = (a) => alignmentMap[a] || a || '--';

// Turtle status mapping
const turtleMap = {
    'Breakout': '突破', 'Breakdown': '跌破', 'Consolidation': '盤整'
};
const toZhTurtle = (t) => turtleMap[t] || t || '--';

// MACD status mapping
const macdMap = {
    'Positive': '紅柱', 'Expanding': '紅柱', 'Negative': '綠柱', 'Contracting': '綠柱',
    'Positive+': '紅柱放大', 'Expanding+': '紅柱放大',
    'Positive-': '紅柱縮小', 'Expanding-': '紅柱縮小',
    'Negative+': '綠柱放大', 'Contracting+': '綠柱放大',
    'Negative-': '綠柱縮小', 'Contracting-': '綠柱縮小',
    'Shrinking+': '綠柱縮小', 'Shrinking-': '綠柱放大',
    'Shrinking': '綠柱'
};
const toZhMacd = (m) => macdMap[m] || m || '--';

// Temperature label mapping
const tempLabelMap = {
    'Frozen': '極凍', 'Cold': '偏冷', 'Neutral': '中性',
    'Warm': '偏熱', 'Hot': '過熱'
};
const toZhTempLabel = (l) => tempLabelMap[l] || l || '--';

const getNestedValue = (obj, path) => path.split('.').reduce((acc, part) => (acc != null ? acc[part] : undefined), obj);

// Initialization
async function init() {
    try {
        const t = Date.now();
        const [screenerRes, tempRes] = await Promise.all([
            fetch(`../backend/output/etf_screener.json?t=${t}`),
            fetch(`../backend/output/etf_temperature.json?t=${t}`)
        ]);
        
        if(screenerRes.ok) {
            appState.screenerData = await screenerRes.json();
        } else {
            console.error('Failed to load etf_screener.json, creating mock data...');
            appState.screenerData = generateMockData();
        }

        if(tempRes.ok) {
            appState.temperatureData = await tempRes.json();
        } else {
            console.error('Failed to load etf_temperature.json, creating mock data...');
            appState.temperatureData = generateMockTemp();
        }
        
        setupEventListeners();
        populateSelectors();
        
        // Initial render
        updateHeader();
        updateTemperature();
        applyFilters();
    } catch (e) {
        console.error('Error during init:', e);
        // Fallback to mock data
        appState.screenerData = generateMockData();
        appState.temperatureData = generateMockTemp();
        setupEventListeners();
        populateSelectors();
        updateHeader();
        updateTemperature();
        applyFilters();
    }
}

function updateHeader() {
    const data = appState.screenerData;
    document.getElementById('update-time').textContent = data?.updated_at ? new Date(data.updated_at).toLocaleString() : '--';
    document.getElementById('etf-count').textContent = data?.etfs?.length ?? '--';
}

function updateTemperature() {
    const tf = appState.filters.timeframe; // 'daily' or 'hourly'
    const tfKey = tf === 'hourly' ? '1h' : 'daily';
    const data = appState.temperatureData?.[tfKey] || appState.temperatureData?.[tf];
    
    if (!data) return;
    
    // Update Gauge
    const val = data.temperature;
    document.getElementById('gauge-value').textContent = val ?? '--';
    document.getElementById('gauge-value').style.color = getGaugeColor(val);
    document.getElementById('gauge-label').textContent = toZhTempLabel(data.label) ?? '--';
    
    const fill = document.getElementById('gauge-fill');
    // SVG Path length is approx 125.6
    const offset = val != null ? 125.6 - (val / 100) * 125.6 : 125.6;
    fill.style.strokeDashoffset = offset;
    fill.style.stroke = getGaugeColor(val);
    
    // Add defs for gradient if not exists
    if (!document.getElementById('gauge-gradient')) {
        const svg = document.querySelector('.gauge-svg');
        if (svg) {
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            defs.innerHTML = `
                <linearGradient id="gauge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#ef4444" />
                    <stop offset="50%" stop-color="#f0b90b" />
                    <stop offset="100%" stop-color="#22c55e" />
                </linearGradient>
            `;
            svg.insertBefore(defs, svg.firstChild);
        }
    }
    
    // Update Indicators
    const container = document.getElementById('indicators-container');
    if (container && data.components) {
        container.innerHTML = '';
        
        const names = {
            '3_blade_ma': '三軍陣列均線',
            'above_ma': '站上均線比例',
            'macd_momentum': 'MACD 動能',
            'macd_positive': 'MACD 動能',
            'vix_inverse': 'VIX 恐慌指數',
            'turtle_net': '海龜通道',
            'pc_ratio_inverse': '買賣權比率'
        };
        
        for (const [key, comp] of Object.entries(data.components)) {
            const div = document.createElement('div');
            div.className = 'indicator';
            div.innerHTML = `
                <div class="ind-header">
                    <span>${names[key] || key} (${comp.weight ?? 0}%)</span>
                    <span class="num">${comp.value ?? '--'}</span>
                </div>
                <div class="ind-bar-bg">
                    <div class="ind-bar-fill" style="width: ${comp.value ?? 0}%; background: ${getGaugeColor(comp.value)}"></div>
                </div>
                <div class="ind-detail">${comp.detail ?? ''}</div>
            `;
            container.appendChild(div);
        }
    }
}

function populateSelectors() {
    if (!appState.screenerData?.etfs) return;
    
    // Dynamically populate category dropdown from actual data
    const catSelect = document.getElementById('filter-category');
    if (catSelect) {
        const dataCats = [...new Set(appState.screenerData.etfs.map(e => e?.category))].filter(Boolean);
        // Preferred display order
        const catOrder = ['Equity','Bond','Sector','International','Dividend','Leveraged','Strategy','Commodity','Real Estate','Thematic','Other'];
        const orderedCats = catOrder.filter(c => dataCats.includes(c));
        // Add any remaining categories not in our order
        dataCats.forEach(c => { if (!orderedCats.includes(c)) orderedCats.push(c); });
        
        catSelect.innerHTML = '<option value="All">全部</option>';
        orderedCats.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = toZhCategory(cat);
            catSelect.appendChild(opt);
        });
    }
    
    // Sub-category population
    const updateSubCategories = () => {
        const cat = appState.filters.category;
        let subCats = [];
        if (cat === 'All') {
            subCats = [...new Set(appState.screenerData.etfs.map(e => e?.sub_category))].filter(Boolean);
        } else {
            subCats = [...new Set(appState.screenerData.etfs.filter(e => e?.category === cat).map(e => e?.sub_category))].filter(Boolean);
        }
        
        const select = document.getElementById('filter-sub-category');
        if (select) {
            select.innerHTML = '<option value="All">全部</option>';
            subCats.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                select.appendChild(opt);
            });
            select.value = 'All';
            appState.filters.subCategory = 'All';
        }
    };
    
    document.getElementById('filter-category')?.addEventListener('change', (e) => {
        appState.filters.category = e.target.value;
        updateSubCategories();
        applyFilters();
    });
    
    updateSubCategories();
}

function applyFilters() {
    const f = appState.filters;
    const search = f.search?.toLowerCase() || '';
    
    if (!appState.screenerData?.etfs) return;
    
    appState.filteredData = appState.screenerData.etfs.filter(s => {
        if (!s) return false;
        
        if (f.category !== 'All' && s.category !== f.category) return false;
        if (f.subCategory !== 'All' && s.sub_category !== f.subCategory) return false;
        
        if (f.signal !== 'All' && s.signal?.label !== f.signal) return false;
        
        const tfKey = f.timeframe === 'daily' ? 'technical_daily' : 'technical_1h';
        const tech = s[tfKey] || {};
        
        if (f.army !== 'All' && !(tech.army?.alignment || '').startsWith(f.army)) return false;
        if (f.macd !== 'All' && !(tech.macd?.status || '').startsWith(f.macd)) return false;
        if (f.turtle !== 'All' && !(tech.turtle?.status || '').startsWith(f.turtle)) return false;
        
        if ((s.factors?.momentum ?? 0) < f.momentumMin) return false;
        if ((s.factors?.quality ?? 0) < f.qualityMin) return false;
        if ((s.factors?.valuation ?? 0) < f.valuationMin) return false;
        if ((s.factors?.growth ?? 0) < f.growthMin) return false;
        
        if (search) {
            return s.symbol?.toLowerCase().includes(search) || s.name?.toLowerCase().includes(search);
        }
        
        return true;
    });
    
    // Sort
    const { column, direction } = appState.sort;
    const dir = direction === 'asc' ? 1 : -1;
    appState.filteredData.sort((a, b) => {
        let valA = getNestedValue(a, column) ?? 0;
        let valB = getNestedValue(b, column) ?? 0;
        
        if (typeof valA === 'string') {
            return (valA || '').localeCompare(valB || '') * dir;
        }
        return ((valA || 0) - (valB || 0)) * dir;
    });
    
    appState.page = 1;
    
    const countEl = document.getElementById('filtered-count');
    if (countEl) countEl.textContent = `${appState.filteredData.length} / ${appState.screenerData.etfs.length}`;
    
    renderTable();
    renderHeatmap();
}

function renderTable() {
    requestAnimationFrame(() => {
        const tbody = document.getElementById('table-body');
        if (!tbody) return;
        tbody.innerHTML = '';
    
    const start = (appState.page - 1) * appState.pageSize;
    const end = start + appState.pageSize;
    const pageData = appState.filteredData.slice(start, end);
    const tfKey = appState.filters.timeframe === 'daily' ? 'technical_daily' : 'technical_1h';
    const btKey = appState.filters.timeframe === 'daily' ? 'backtest_1h' : 'backtest_1h'; // Assuming backtest keys are similar
    
    pageData.forEach((s, idx) => {
        const tech = s[tfKey] || {};
        const tr = document.createElement('tr');
        tr.className = 'main-row';
        
        tr.innerHTML = `
            <td>${start + idx + 1}</td>
            <td class="num font-weight-bold">${s.symbol ?? '--'}</td>
            <td>${s.name ?? '--'}</td>
            <td>${toZhCategory(s.category)}</td>
            <td class="num">${formatCurrency(s.price)}</td>
            <td class="num ${(s.change_1d_pct ?? 0) > 0 ? 'pos' : ((s.change_1d_pct ?? 0) < 0 ? 'neg' : 'neu')}">${(s.change_1d_pct ?? 0) > 0 ? '+' : ''}${formatNum(s.change_1d_pct)}%</td>
            <td>
                <span class="signal-badge ${getSignalClass(s.signal?.label)}">
                    ${getSignalIcon(s.signal?.label)} ${toZhSignal(s.signal?.label)} ${s.signal?.score ?? 0}
                </span>
            </td>
            <td class="num">${formatNum(s.factors?.momentum, 0)}</td>
            <td class="num">${formatNum(s.factors?.quality, 0)}</td>
            <td class="num">${formatNum(s.factors?.valuation, 0)}</td>
            <td class="num">${formatNum(s.factors?.growth, 0)}</td>
            <td class="num">${formatNum(s.dividend_yield)}%</td>
            <td class="num">${formatNum(s.expense_ratio)}%</td>
            <td class="num">${formatAUM(s.aum)}</td>
            <td>${toZhAlignment(tech.army?.alignment)}</td>
            <td>${toZhTurtle(tech.turtle?.status)}</td>
            <td>${toZhMacd(tech.macd?.status)}</td>
        `;
        
        const trDetail = document.createElement('tr');
        trDetail.className = 'detail-row';
        const cols = 17;
        
        const compHTML = Object.entries(s.signal?.components || {}).map(([k, c]) => `
            <div class="detail-item">
                <span class="lbl" style="width: 80px;">${c.label}</span>
                <div style="flex-grow: 1; display: flex; align-items: center;">
                    <div class="signal-comp-bar" style="width: 100px;">
                        <div class="signal-comp-fill" style="width: ${c.value}%; background: ${getGaugeColor(c.value)}"></div>
                    </div>
                    <span class="val" style="margin-left: 8px;">${c.value} / ${c.weight}w</span>
                </div>
            </div>
        `).join('');
        
        trDetail.innerHTML = `
            <td colspan="${cols}">
                <div class="detail-content">
                    <div class="detail-group">
                        <h4>訊號組成 (總分: ${s.signal?.score ?? 0})</h4>
                        ${compHTML || '無資料'}
                    </div>
                    <div class="detail-group">
                        <h4>四大因子 與 基本面</h4>
                        <div class="detail-item"><span class="lbl">動能分數</span><span class="val">${formatNum(s.factors?.momentum, 0)}</span></div>
                        <div class="detail-item"><span class="lbl">品質分數</span><span class="val">${formatNum(s.factors?.quality, 0)}</span></div>
                        <div class="detail-item"><span class="lbl">估值分數</span><span class="val">${formatNum(s.factors?.valuation, 0)}</span></div>
                        <div class="detail-item"><span class="lbl">成長分數</span><span class="val">${formatNum(s.factors?.growth, 0)}</span></div>
                        <div class="detail-item"><span class="lbl">殖利率</span><span class="val">${formatNum(s.dividend_yield)}%</span></div>
                        <div class="detail-item"><span class="lbl">費用率</span><span class="val">${formatNum(s.expense_ratio)}%</span></div>
                        <div class="detail-item"><span class="lbl">基金規模</span><span class="val">${formatAUM(s.aum)}</span></div>
                        <div class="detail-item"><span class="lbl">類別</span><span class="val">${toZhCategory(s.category)}</span></div>
                    </div>
                    <div class="detail-group">
                        <h4>技術分析</h4>
                        <div class="detail-item"><span class="lbl">MACD 狀態</span><span class="val">${toZhMacd(tech.macd?.status)} (${formatNum(tech.macd?.histogram)})</span></div>
                        <div class="detail-item"><span class="lbl">前鋒 (20MA)</span><span class="val">${formatCurrency(tech.army?.vanguard)}</span></div>
                        <div class="detail-item"><span class="lbl">中軍 (60MA)</span><span class="val">${formatCurrency(tech.army?.center)}</span></div>
                        <div class="detail-item"><span class="lbl">後衛 (240MA)</span><span class="val">${formatCurrency(tech.army?.rearguard)}</span></div>
                        <div class="detail-item"><span class="lbl">RSI (14)</span><span class="val">${formatNum(tech.rsi?.value)}</span></div>
                        <div class="detail-item"><span class="lbl">海龜通道</span><span class="val">${toZhTurtle(tech.turtle?.status)}</span></div>
                    </div>
                    <div class="detail-group">
                        <h4>基本資訊 與 回測</h4>
                        <div class="detail-item"><span class="lbl">發行商</span><span class="val">${s.metadata?.issuer ?? '--'}</span></div>
                        <div class="detail-item"><span class="lbl">追蹤指數</span><span class="val">${s.metadata?.tracking_index ?? '--'}</span></div>
                        ${s[btKey]?.army ? `
                            <div class="detail-item"><span class="lbl">小時線策略報酬</span><span class="val ${(s[btKey].army?.return_pct ?? 0) > 0 ? 'pos' : 'neg'}">${formatNum(s[btKey].army?.return_pct)}% (勝率 ${s[btKey].army?.win_rate}%)</span></div>
                        ` : ''}
                    </div>
                </div>
            </td>
        `;
        
        tr.addEventListener('click', () => {
            trDetail.classList.toggle('open');
        });
        
        tbody.appendChild(tr);
        tbody.appendChild(trDetail);
    });
    
    // Update pagination
    const totalPages = Math.ceil(appState.filteredData.length / appState.pageSize);
    const pageInfo = document.getElementById('page-info');
    if (pageInfo) pageInfo.textContent = `第 ${appState.page} 頁 / 共 ${totalPages || 1} 頁`;
    
    const btnPrev = document.getElementById('page-prev');
    if (btnPrev) btnPrev.disabled = appState.page <= 1;
    
        const btnNext = document.getElementById('page-next');
        if (btnNext) btnNext.disabled = appState.page >= totalPages;
    });
}

function renderHeatmap() {
    if (renderHeatmap._rendering) return;
    renderHeatmap._rendering = true;
    requestAnimationFrame(() => {
        const container = document.getElementById('heatmap-container');
        if (!container) {
            renderHeatmap._rendering = false;
            return;
        }
        container.innerHTML = '';
        
        if (appState.filteredData.length === 0) {
            renderHeatmap._rendering = false;
            return;
        }
        
        // Group by category
        const categories = {};
        const heatmapData = appState.filteredData.slice(0, 200);
        heatmapData.forEach(s => {
        const cat = s.category || 'Other';
        if (!categories[cat]) categories[cat] = { name: cat, children: [], totalChange: 0 };
        categories[cat].children.push(s);
        categories[cat].totalChange += (s.change_1d_pct ?? 0);
    });
    
    // Use equal weight (count)
    let catNodes = Object.values(categories).map(c => ({
        ...c,
        value: c.children.length,
        avgChange: c.totalChange / c.children.length
    })).sort((a, b) => b.value - a.value);
    
    const W = container.clientWidth;
    const H = container.clientHeight || 450;
    const totalValue = catNodes.reduce((s, n) => s + n.value, 0);
    
    if (totalValue === 0) {
        renderHeatmap._rendering = false;
        return;
    }
    
    const fragment = document.createDocumentFragment();
    
    // Layout: horizontal slices for categories, grid within each category
    let catY = 0;
    
    catNodes.forEach(cat => {
        const catRatio = cat.value / totalValue;
        const catH = Math.max(H * catRatio, 28);
        
        // Category label
        const label = document.createElement('div');
        label.className = 'hm-cat-label';
        label.style.position = 'absolute';
        label.style.left = '0';
        label.style.top = `${catY}px`;
        label.style.width = `${W}px`;
        label.style.height = '20px';
        label.style.lineHeight = '20px';
        label.style.fontSize = '0.7rem';
        label.style.fontWeight = '700';
        label.style.color = '#00d4aa';
        label.style.paddingLeft = '6px';
        label.style.zIndex = '5';
        label.style.background = 'rgba(13,13,15,0.7)';
        const avgChg = cat.avgChange;
        const chgColor = avgChg > 0 ? '#22c55e' : (avgChg < 0 ? '#ef4444' : '#888');
        label.innerHTML = `${cat.name} <span style="color:${chgColor};margin-left:6px;">${avgChg > 0 ? '+' : ''}${avgChg.toFixed(2)}%</span>`;
        fragment.appendChild(label);
        
        // ETF nodes in grid within category area
        const areaY = catY + 20;
        const areaH = catH - 20;
        if (areaH < 8) { catY += catH; return; }
        
        const etfs = cat.children.sort((a, b) => (b.change_1d_pct ?? 0) - (a.change_1d_pct ?? 0));
        const cols = Math.max(1, Math.ceil(Math.sqrt(etfs.length * (W / Math.max(areaH, 1)))));
        const rows = Math.ceil(etfs.length / cols);
        const cellW = W / cols;
        const cellH = areaH / rows;
        
        etfs.forEach((etf, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = col * cellW;
            const y = areaY + row * cellH;
            
            if (cellW < 2 || cellH < 2) return;
            
            const node = document.createElement('div');
            node.className = 'hm-node';
            node.style.left = `${x}px`;
            node.style.top = `${y}px`;
            node.style.width = `${cellW - 1}px`;
            node.style.height = `${cellH - 1}px`;
            
            const change = etf.change_1d_pct ?? 0;
            let color;
            if (change > 3) color = '#15803d';
            else if (change > 1.5) color = '#16a34a';
            else if (change > 0) color = '#22c55e';
            else if (change < -3) color = '#991b1b';
            else if (change < -1.5) color = '#dc2626';
            else if (change < 0) color = '#ef4444';
            else color = '#525252';
            
            node.style.backgroundColor = color;
            node.title = `${etf.symbol} ${etf.name}\n漲跌: ${change > 0 ? '+' : ''}${change.toFixed(2)}%\n訊號: ${toZhSignal(etf.signal?.label)} ${etf.signal?.score ?? '-'}`;
            
                if (cellW > 38 && cellH > 24) {
                    node.innerHTML = `
                        <span class="hm-symbol">${etf.symbol}</span>
                        ${cellH > 36 ? `<span class="hm-change">${change > 0 ? '+' : ''}${change.toFixed(1)}%</span>` : ''}
                    `;
                }
                
                fragment.appendChild(node);
            });
            
            catY += catH;
        });
        
        container.appendChild(fragment);
        renderHeatmap._rendering = false;
    });
}

function setupEventListeners() {
    // Range inputs
    const rangeFilters = ['momentum', 'quality', 'valuation', 'growth'];
    rangeFilters.forEach(rf => {
        const input = document.getElementById(`filter-${rf}`);
        const valSpan = document.getElementById(`val-${rf}`);
        if (input && valSpan) {
            input.addEventListener('input', (e) => {
                valSpan.textContent = e.target.value;
            });
            input.addEventListener('input', debounce((e) => {
                appState.filters[`${rf}Min`] = parseInt(e.target.value);
                applyFilters();
            }, 150));
        }
    });
    
    // Selects and Text
    ['category', 'sub-category', 'signal', 'army', 'macd', 'turtle', 'search'].forEach(filter => {
        const el = document.getElementById(`filter-${filter}`);
        if (el) {
            const stateKey = filter === 'sub-category' ? 'subCategory' : filter;
            el.addEventListener('change', (e) => {
                appState.filters[stateKey] = e.target.value;
                applyFilters();
            });
            if(filter === 'search') {
                el.addEventListener('keyup', debounce((e) => {
                    appState.filters[stateKey] = e.target.value;
                    applyFilters();
                }, 250));
            }
        }
    });
    
    // Timeframe toggle
    const btnDaily = document.getElementById('temp-tf-daily');
    const btnHourly = document.getElementById('temp-tf-hourly');
    if (btnDaily && btnHourly) {
        btnDaily.addEventListener('click', (e) => {
            btnDaily.classList.add('active');
            btnHourly.classList.remove('active');
            appState.filters.timeframe = 'daily';
            updateTemperature();
            applyFilters();
        });
        btnHourly.addEventListener('click', (e) => {
            btnHourly.classList.add('active');
            btnDaily.classList.remove('active');
            appState.filters.timeframe = 'hourly';
            updateTemperature();
            applyFilters();
        });
    }
    
    // Sort headers
    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (appState.sort.column === column) {
                appState.sort.direction = appState.sort.direction === 'desc' ? 'asc' : 'desc';
            } else {
                appState.sort.column = column;
                appState.sort.direction = 'desc';
            }
            applyFilters();
        });
    });
    
    // Pagination
    const btnPrev = document.getElementById('page-prev');
    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            if (appState.page > 1) {
                appState.page--;
                renderTable();
            }
        });
    }
    const btnNext = document.getElementById('page-next');
    if (btnNext) {
        btnNext.addEventListener('click', () => {
            const totalPages = Math.ceil(appState.filteredData.length / appState.pageSize);
            if (appState.page < totalPages) {
                appState.page++;
                renderTable();
            }
        });
    }
    
    // Quick Filters
    const qfSetup = [
        ['qf-momentum', () => { 
            resetFilters(); 
            appState.filters.momentumMin = 80; 
        }],
        ['qf-quality', () => { 
            resetFilters(); 
            appState.filters.qualityMin = 70; 
        }],
        ['qf-value', () => { 
            resetFilters(); 
            appState.filters.valuationMin = 70; 
        }],
        ['qf-bullish', () => { 
            resetFilters(); 
            appState.filters.army = 'Bullish';
        }],
        ['qf-yield', () => { 
            resetFilters(); 
            // Yield >= 3% might need a new filter or handled dynamically
        }],
        ['qf-reset', () => { resetFilters(); }]
    ];
    
    qfSetup.forEach(([id, fn]) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', () => {
                fn();
                if (id === 'qf-yield') {
                    appState.filteredData = appState.screenerData.etfs.filter(s => s && (s.dividend_yield ?? 0) >= 3);
                    renderTable();
                    renderHeatmap();
                    updateUI();
                } else {
                    updateUI();
                    applyFilters();
                }
            });
        }
    });
    
    window.addEventListener('resize', () => {
        clearTimeout(window.resizeTimer);
        window.resizeTimer = setTimeout(renderHeatmap, 200);
    });
}

function resetFilters() {
    appState.filters = {
        category: 'All', subCategory: 'All', signal: 'All', army: 'All',
        macd: 'All', turtle: 'All', momentumMin: 0, qualityMin: 0, valuationMin: 0,
        growthMin: 0, search: '', timeframe: appState.filters.timeframe
    };
    
    const select = document.getElementById('filter-sub-category');
    if (select) {
        select.innerHTML = '<option value="All">全部</option>';
        [...new Set(appState.screenerData?.etfs?.map(e => e?.sub_category))].filter(Boolean).forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            select.appendChild(opt);
        });
    }
}

function updateUI() {
    const f = appState.filters;
    const updates = [
        ['filter-category', f.category],
        ['filter-sub-category', f.subCategory],
        ['filter-signal', f.signal],
        ['filter-army', f.army],
        ['filter-macd', f.macd],
        ['filter-turtle', f.turtle],
        ['filter-momentum', f.momentumMin], ['val-momentum', f.momentumMin, true],
        ['filter-quality', f.qualityMin], ['val-quality', f.qualityMin, true],
        ['filter-valuation', f.valuationMin], ['val-valuation', f.valuationMin, true],
        ['filter-growth', f.growthMin], ['val-growth', f.growthMin, true],
        ['filter-search', f.search]
    ];
    
    updates.forEach(([id, val, isText]) => {
        const el = document.getElementById(id);
        if (el) {
            if (isText) el.textContent = val;
            else el.value = val;
        }
    });
}

// Mock Data Generator for Development
function generateMockData() {
    const categories = ['股票指數型', '債券型', '產業型', '國際型', '配息型', '槓桿型', '反向型', '商品型', '主題型', '因子策略', '其他'];
    const signals = ['Strong Buy', 'Buy', 'Neutral', 'Sell', 'Strong Sell'];
    const armys = ['Bullish', 'Bearish', 'Mixed'];
    const macds = ['Expanding+', 'Shrinking+', 'Expanding-', 'Shrinking-'];
    const turtles = ['Breakout', 'Breakdown', 'Consolidation'];
    
    return {
        updated_at: new Date().toISOString(),
        etfs: Array.from({length: 258}, (_, i) => {
            const cat = categories[Math.floor(Math.random() * categories.length)];
            const symbol = 'ETF' + i;
            const sigScore = Math.floor(Math.random() * 100);
            let sigLabel = 'Neutral';
            if (sigScore >= 80) sigLabel = 'Strong Buy';
            else if (sigScore >= 60) sigLabel = 'Buy';
            else if (sigScore <= 20) sigLabel = 'Strong Sell';
            else if (sigScore <= 40) sigLabel = 'Sell';
            
            return {
                symbol: symbol,
                name: `US ETF ${symbol}`,
                category: cat,
                sub_category: cat + ' Sub',
                price: (Math.random() * 190 + 10).toFixed(2),
                change_1d_pct: (Math.random() * 6 - 3).toFixed(2),
                factors: {
                    momentum: Math.floor(Math.random() * 100),
                    quality: Math.floor(Math.random() * 100),
                    valuation: Math.floor(Math.random() * 100),
                    growth: Math.floor(Math.random() * 100)
                },
                yield: { 
                    annual_pct: (Math.random() * 10).toFixed(2)
                },
                signal: {
                    score: sigScore, 
                    label: sigLabel,
                    components: {
                        momentum: {value: Math.floor(Math.random() * 100), weight: 20, label: "Momentum"},
                        quality: {value: Math.floor(Math.random() * 100), weight: 20, label: "Quality"},
                        technical: {value: Math.floor(Math.random() * 100), weight: 40, label: "Technical"},
                        yield: {value: Math.floor(Math.random() * 100), weight: 20, label: "Yield"}
                    }
                },
                metadata: { 
                    fund_size: Math.random() * 10000000000 + 1000000, 
                    expense_ratio: (Math.random() * 1).toFixed(2), 
                    tracking_index: "Some Index", 
                    issuer: "Some Issuer" 
                },
                technical_daily: {
                    army: { 
                        alignment: armys[Math.floor(Math.random() * armys.length)],
                        ma20: (Math.random() * 190 + 10).toFixed(2),
                        ma60: (Math.random() * 190 + 10).toFixed(2),
                        ma240: (Math.random() * 190 + 10).toFixed(2)
                    },
                    turtle: { status: turtles[Math.floor(Math.random() * turtles.length)] },
                    macd: { status: macds[Math.floor(Math.random() * macds.length)], histogram: (Math.random() * 2 - 1).toFixed(2) },
                    rsi: { value: (Math.random() * 100).toFixed(2) }
                },
                backtest_1h: { army: { return_pct: 12.5, win_rate: 52, trades: 28 } }
            };
        })
    };
}

function generateMockTemp() {
    const gen = () => ({
        temperature: Math.floor(Math.random() * 100), 
        label: "Neutral",
        components: {
            '3_blade_ma': {value: Math.floor(Math.random() * 100), weight: 25, detail: "Bullish Alignment"},
            'above_ma': {value: Math.floor(Math.random() * 100), weight: 20, detail: "Above 200MA"},
            'macd_momentum': {value: Math.floor(Math.random() * 100), weight: 20, detail: "Positive Momentum"},
            'vix_inverse': {value: Math.floor(Math.random() * 100), weight: 15, detail: "Low VIX"},
            'turtle_net': {value: Math.floor(Math.random() * 100), weight: 10, detail: "Net Breakouts"},
            'pc_ratio_inverse': {value: Math.floor(Math.random() * 100), weight: 10, detail: "Bullish Option Flow"}
        }
    });
    return {
        updated_at: new Date().toISOString(),
        daily: gen(),
        '1h': gen()
    };
}

// Boot
document.addEventListener('DOMContentLoaded', init);
