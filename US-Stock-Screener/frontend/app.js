function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

const appState = {
    screenerData: null,
    temperatureData: null,
    filteredData: [],
    
    // Filters
    filters: {
        momentum: 0,
        quality: 0,
        valuation: 0,
        growth: 0,
        timeframe: 'daily',
        army: 'all',
        macd: 'all',
        turtle: 'all',
        sector: 'all',
        search: ''
    },
    
    // Sorting
    sort: {
        column: 'factors.momentum',
        direction: 'desc'
    },
    
    // Pagination
    page: 1,
    pageSize: 50
};

// Utilities
const getFactorColor = (val) => {
    if (val < 20) return 'var(--c-0)';
    if (val < 40) return 'var(--c-20)';
    if (val < 60) return 'var(--c-40)';
    if (val < 80) return 'var(--c-60)';
    return 'var(--c-80)';
};

const getGaugeColor = (val) => {
    const hue = ((100 - val) * 2.4).toString(10); // 100 -> 0 (red), 50 -> 120 (green), 0 -> 240 (blue)
    return `hsl(${hue}, 100%, 50%)`;
};

const formatNum = (num, decimals = 2) => num != null ? Number(num).toFixed(decimals) : '--';
const getNestedValue = (obj, path) => path.split('.').reduce((acc, part) => (acc != null ? acc[part] : undefined), obj);

// Initialization
async function init() {
    try {
        const [screenerRes, tempRes] = await Promise.all([
            fetch('../backend/output/screener_data.json'),
            fetch('../backend/output/temperature.json')
        ]);
        
        if(screenerRes.ok) {
            appState.screenerData = await screenerRes.json();
        } else {
            console.error('Failed to load screener_data.json, creating mock data...');
            appState.screenerData = generateMockData();
        }

        if(tempRes.ok) {
            appState.temperatureData = await tempRes.json();
        } else {
            console.error('Failed to load temperature.json, creating mock data...');
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
        // Fallback to mock data if fetch fails (e.g., viewing directly in browser via file://)
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
    document.getElementById('update-time').textContent = new Date(data.updated_at).toLocaleString('zh-TW');
    document.getElementById('stock-count').textContent = data.stock_count;
}

function updateTemperature() {
    const tf = appState.filters.timeframe; // 'daily' or 'hourly'
    const tfKey = tf === 'hourly' ? '1h' : 'daily';
    const data = appState.temperatureData[tfKey] || appState.temperatureData[tf];
    
    // Update Gauge
    const val = data.temperature;
    document.getElementById('gauge-value').textContent = val;
    document.getElementById('gauge-value').style.color = getGaugeColor(val);
    document.getElementById('gauge-label').textContent = data.label;
    
    const fill = document.getElementById('gauge-fill');
    // SVG Path length is approx 125.6
    const offset = 125.6 - (val / 100) * 125.6;
    fill.style.strokeDashoffset = offset;
    fill.style.stroke = getGaugeColor(val);
    
    // Add defs for gradient if not exists
    if (!document.getElementById('gauge-gradient')) {
        const svg = document.querySelector('.gauge-svg');
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `
            <linearGradient id="gauge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="blue" />
                <stop offset="50%" stop-color="green" />
                <stop offset="100%" stop-color="red" />
            </linearGradient>
        `;
        svg.insertBefore(defs, svg.firstChild);
    }
    
    // Update Indicators
    const container = document.getElementById('indicators-container');
    container.innerHTML = '';
    
    const names = {
        'army_alignment': '三軍排列',
        'above_ma': '站上均線',
        'macd_positive': 'MACD 多空',
        'vix_inverse': 'VIX 恐慌指數',
        'turtle_net': '海龜淨突破',
        'pc_ratio_inverse': '買賣權比率'
    };
    
    for (const [key, comp] of Object.entries(data.components)) {
        const div = document.createElement('div');
        div.className = 'indicator';
        div.innerHTML = `
            <div class="ind-header">
                <span>${names[key] || key} (${comp.weight}%)</span>
                <span class="num">${comp.value}</span>
            </div>
            <div class="ind-bar-bg">
                <div class="ind-bar-fill" style="width: ${comp.value}%; background: ${getGaugeColor(comp.value)}"></div>
            </div>
            <div class="ind-detail">${comp.detail}</div>
        `;
        container.appendChild(div);
    }
}

function populateSelectors() {
    const sectors = [...new Set(appState.screenerData.stocks.map(s => s.sector_zh || s.sector))].filter(Boolean);
    const select = document.getElementById('filter-sector');
    sectors.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        select.appendChild(opt);
    });
}

function applyFilters() {
    const f = appState.filters;
    const search = f.search.toLowerCase();
    const tfKey = f.timeframe === 'daily' ? 'technical_daily' : 'technical_1h';
    
    appState.filteredData = appState.screenerData.stocks.filter(s => {
        const fac = s.factors || {};
        if ((fac.momentum ?? 0) < f.momentum) return false;
        if ((fac.quality ?? 0) < f.quality) return false;
        if ((fac.valuation ?? 0) < f.valuation) return false;
        if ((fac.growth ?? 0) < f.growth) return false;
        
        if (f.sector !== 'all' && s.sector_zh !== f.sector && s.sector !== f.sector) return false;
        
        const tech = s[tfKey];
        if (f.army !== 'all' && tech?.army?.alignment !== f.army) return false;
        if (f.macd !== 'all' && tech?.macd?.status !== f.macd && (f.macd === '柱狀圖為正' ? !tech?.macd?.positive : true)) return false;
        if (f.turtle !== 'all' && tech?.turtle?.status !== f.turtle) return false;
        
        if (search) {
            return s.symbol.toLowerCase().includes(search) || s.name.toLowerCase().includes(search);
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
    
    document.getElementById('filtered-count').textContent = `${appState.filteredData.length}`;
    
    renderTable();
    renderHeatmap();
}

function renderTable() {
    requestAnimationFrame(() => {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';
    
    const start = (appState.page - 1) * appState.pageSize;
    const end = start + appState.pageSize;
    const pageData = appState.filteredData.slice(start, end);
    const tfKey = appState.filters.timeframe === 'daily' ? 'technical_daily' : 'technical_1h';
    const btKey = appState.filters.timeframe === 'daily' ? 'backtest_daily' : 'backtest_1h';
    
    pageData.forEach((s, idx) => {
        const tech = s[tfKey] || {};
        const tr = document.createElement('tr');
        tr.className = 'main-row';
        tr.innerHTML = `
            <td>${start + idx + 1}</td>
            <td class="num font-weight-bold">${s.symbol}</td>
            <td>${s.name}</td>
            <td class="num">${formatNum(s.price)}</td>
            <td class="num ${s.change_1d_pct > 0 ? 'pos' : (s.change_1d_pct < 0 ? 'neg' : 'neu')}">${s.change_1d_pct > 0 ? '+' : ''}${formatNum(s.change_1d_pct)}%</td>
            <td><span class="badge" style="background:${getFactorColor(s.factors?.momentum)}">${s.factors?.momentum ?? '-'}</span></td>
            <td><span class="badge" style="background:${getFactorColor(s.factors?.quality)}">${s.factors?.quality ?? '-'}</span></td>
            <td><span class="badge" style="background:${getFactorColor(s.factors?.valuation)}">${s.factors?.valuation ?? '-'}</span></td>
            <td><span class="badge" style="background:${getFactorColor(s.factors?.growth)}">${s.factors?.growth ?? '-'}</span></td>
            <td>${getAlignmentIcon(tech.army?.alignment)} ${tech.army?.alignment || '-'}</td>
            <td>${tech.turtle?.status || '-'}</td>
            <td>${tech.macd?.status || (tech.macd?.positive ? '柱狀圖為正' : '柱狀圖為負')}</td>
        `;
        
        const trDetail = document.createElement('tr');
        trDetail.className = 'detail-row';
        const cols = 12;
        trDetail.innerHTML = `
            <td colspan="${cols}">
                <div class="detail-content">
                    <div class="detail-group">
                        <h4>基本面數據 (Raw)</h4>
                        <div class="detail-item"><span class="lbl">PE Ratio</span><span class="val">${formatNum(s.raw?.pe)}</span></div>
                        <div class="detail-item"><span class="lbl">PS Ratio</span><span class="val">${formatNum(s.raw?.ps)}</span></div>
                        <div class="detail-item"><span class="lbl">EPS</span><span class="val">${formatNum(s.raw?.eps)}</span></div>
                        <div class="detail-item"><span class="lbl">ROE</span><span class="val">${formatNum(s.raw?.roe)}%</span></div>
                        <div class="detail-item"><span class="lbl">淨利率</span><span class="val">${formatNum(s.raw?.net_margin)}%</span></div>
                        <div class="detail-item"><span class="lbl">營收成長</span><span class="val">${formatNum(s.raw?.revenue_growth)}%</span></div>
                    </div>
                    <div class="detail-group">
                        <h4>技術面 (${appState.filters.timeframe === 'daily' ? '日線' : '1H'})</h4>
                        <div class="detail-item"><span class="lbl">前鋒 (快線)</span><span class="val">${formatNum(tech.army?.vanguard)}</span></div>
                        <div class="detail-item"><span class="lbl">中軍 (中線)</span><span class="val">${formatNum(tech.army?.center)}</span></div>
                        <div class="detail-item"><span class="lbl">後衛 (慢線)</span><span class="val">${formatNum(tech.army?.rearguard)}</span></div>
                        <div class="detail-item"><span class="lbl">海龜上軌</span><span class="val">${formatNum(tech.turtle?.upper)}</span></div>
                        <div class="detail-item"><span class="lbl">海龜下軌</span><span class="val">${formatNum(tech.turtle?.lower)}</span></div>
                        <div class="detail-item"><span class="lbl">MACD Hist</span><span class="val">${formatNum(tech.macd?.histogram)}</span></div>
                    </div>
                    <div class="detail-group">
                        <h4>回測表現 (${appState.filters.timeframe === 'daily' ? '日線' : '1H'} 三軍陣列)</h4>
                        ${s[btKey]?.army ? `
                            <div class="detail-item"><span class="lbl">總報酬率</span><span class="val ${s[btKey].army.return_pct>0?'pos':'neg'}">${formatNum(s[btKey].army.return_pct)}%</span></div>
                            <div class="detail-item"><span class="lbl">勝率</span><span class="val">${formatNum(s[btKey].army.win_rate)}%</span></div>
                            <div class="detail-item"><span class="lbl">交易筆數</span><span class="val">${s[btKey].army.trades}</span></div>
                        ` : '無回測資料'}
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
    document.getElementById('page-info').textContent = `第 ${appState.page} / ${totalPages || 1} 頁`;
    document.getElementById('page-prev').disabled = appState.page <= 1;
    document.getElementById('page-next').disabled = appState.page >= totalPages;
    });
}

function getAlignmentIcon(alignment) {
    if (alignment === '多方排列') return '🟢';
    if (alignment === '空方排列') return '🔴';
    return '⚪';
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
        
        const fragment = document.createDocumentFragment();
        
        // Sector translation map
        const sectorZhMap = {
            'Technology': '資訊科技', 'Healthcare': '醫療保健',
            'Financial Services': '金融服務', 'Consumer Cyclical': '非必需消費',
            'Consumer Defensive': '必需消費', 'Basic Materials': '基本材料',
            'Communication Services': '通訊服務', 'Real Estate': '不動產',
            'Utilities': '公用事業', 'Energy': '能源', 'Industrials': '工業',
            'Other': '其他', 'Unknown': '未知'
        };
        
        // Group by sector
        const categories = {};
        appState.filteredData.forEach(s => {
            const rawCat = s.sector_zh || s.sector || 'Other';
            const cat = sectorZhMap[rawCat] || rawCat;
            if (!categories[cat]) categories[cat] = { name: cat, children: [], totalChange: 0 };
            categories[cat].children.push(s);
            categories[cat].totalChange += (s.change_1d_pct ?? 0);
        });
        
        // Use count as weight (equal-weight) since most stocks lack market_cap data
        let catNodes = Object.values(categories).map(c => ({
            ...c,
            value: c.children.length,
            avgChange: c.totalChange / c.children.length
        })).sort((a, b) => b.value - a.value);
        
        // Only show top 15 categories to avoid clutter
        if (catNodes.length > 15) catNodes = catNodes.slice(0, 15);
        
        const W = container.clientWidth;
        const H = container.clientHeight || 400;
        const totalValue = catNodes.reduce((s, n) => s + n.value, 0);
        
        if (totalValue === 0) {
            renderHeatmap._rendering = false;
            return;
        }
        
        let catY = 0;
        let itemCount = 0;
        
        catNodes.forEach(cat => {
            const catRatio = cat.value / totalValue;
            const catH = Math.max(H * catRatio, 28);
            
            // Category label
            const label = document.createElement('div');
            label.className = 'hm-cat-label';
            label.style.cssText = `position:absolute;left:0;top:${catY}px;width:${W}px;height:20px;line-height:20px;font-size:0.7rem;font-weight:700;color:#00d4aa;padding-left:6px;z-index:5;background:rgba(13,13,15,0.7);`;
            const avgChg = cat.avgChange;
            const chgColor = avgChg > 0 ? '#22c55e' : (avgChg < 0 ? '#ef4444' : '#888');
            label.innerHTML = `${cat.name} (${cat.children.length}) <span style="color:${chgColor};margin-left:6px;">${avgChg > 0 ? '+' : ''}${avgChg.toFixed(2)}%</span>`;
            fragment.appendChild(label);
            
            const areaY = catY + 20;
            const areaH = catH - 20;
            if (areaH < 6) { catY += catH; return; }
            
            const etfs = cat.children.sort((a, b) => (b.change_1d_pct ?? 0) - (a.change_1d_pct ?? 0));
            const cols = Math.max(1, Math.ceil(Math.sqrt(etfs.length * (W / Math.max(areaH, 1)))));
            const rows = Math.ceil(etfs.length / cols);
            const cellW = W / cols;
            const cellH = areaH / rows;
            
            etfs.forEach((s, i) => {
                if (itemCount >= 200) return;
                
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
                
                const change = s.change_1d_pct ?? 0;
                let color;
                if (change > 3) color = '#15803d';
                else if (change > 1.5) color = '#16a34a';
                else if (change > 0) color = '#22c55e';
                else if (change < -3) color = '#991b1b';
                else if (change < -1.5) color = '#dc2626';
                else if (change < 0) color = '#ef4444';
                else color = '#525252';
                
                node.style.backgroundColor = color;
                node.title = `${s.symbol || '--'} ${s.name || '--'}\nChange: ${change > 0 ? '+' : ''}${change.toFixed(2)}%`;
                
                if (cellW > 38 && cellH > 24) {
                    node.innerHTML = `
                        <span class="hm-symbol">${s.symbol || s.yf_ticker || '--'}</span>
                        ${cellH > 36 ? `<span class="hm-change">${change > 0 ? '+' : ''}${change.toFixed(1)}%</span>` : ''}
                    `;
                }
                
                fragment.appendChild(node);
                itemCount++;
            });
            
            catY += catH;
        });
        
        container.appendChild(fragment);
        renderHeatmap._rendering = false;
    });
}

function setupEventListeners() {
    // Range inputs
    ['momentum', 'quality', 'valuation', 'growth'].forEach(factor => {
        const input = document.getElementById(`filter-${factor}`);
        const span = document.getElementById(`val-${factor}`);
        input.addEventListener('input', (e) => {
            span.textContent = e.target.value;
        });
        input.addEventListener('input', debounce((e) => {
            appState.filters[factor] = parseInt(e.target.value);
            applyFilters();
        }, 150));
    });
    
    // Selects and Text
    ['timeframe', 'army', 'macd', 'turtle', 'sector', 'search'].forEach(filter => {
        const el = document.getElementById(`filter-${filter}`);
        el.addEventListener('change', (e) => {
            appState.filters[filter] = e.target.value;
            if(filter === 'timeframe') updateTemperature();
            applyFilters();
        });
        if(filter === 'search') {
            el.addEventListener('keyup', debounce((e) => {
                appState.filters[filter] = e.target.value;
                applyFilters();
            }, 250));
        }
    });
    
    // Timeframe toggle
    document.getElementById('temp-tf-daily').addEventListener('click', (e) => {
        document.getElementById('temp-tf-daily').classList.add('active');
        document.getElementById('temp-tf-hourly').classList.remove('active');
        document.getElementById('filter-timeframe').value = 'daily';
        appState.filters.timeframe = 'daily';
        updateTemperature();
        applyFilters();
    });
    document.getElementById('temp-tf-hourly').addEventListener('click', (e) => {
        document.getElementById('temp-tf-hourly').classList.add('active');
        document.getElementById('temp-tf-daily').classList.remove('active');
        document.getElementById('filter-timeframe').value = 'hourly';
        appState.filters.timeframe = 'hourly';
        updateTemperature();
        applyFilters();
    });
    
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
    document.getElementById('page-prev').addEventListener('click', () => {
        if (appState.page > 1) {
            appState.page--;
            renderTable();
        }
    });
    document.getElementById('page-next').addEventListener('click', () => {
        const totalPages = Math.ceil(appState.filteredData.length / appState.pageSize);
        if (appState.page < totalPages) {
            appState.page++;
            renderTable();
        }
    });
    
    // Quick Filters
    document.getElementById('qf-momentum').addEventListener('click', () => { resetFilters(); appState.filters.momentum = 80; updateUI(); applyFilters(); });
    document.getElementById('qf-value').addEventListener('click', () => { resetFilters(); appState.filters.valuation = 70; updateUI(); applyFilters(); });
    document.getElementById('qf-growth').addEventListener('click', () => { resetFilters(); appState.filters.quality = 70; appState.filters.growth = 70; updateUI(); applyFilters(); });
    document.getElementById('qf-army').addEventListener('click', () => { resetFilters(); appState.filters.army = '多方排列'; updateUI(); applyFilters(); });
    document.getElementById('qf-reset').addEventListener('click', () => { resetFilters(); updateUI(); applyFilters(); });
    
    window.addEventListener('resize', () => {
        // Debounce resize
        clearTimeout(window.resizeTimer);
        window.resizeTimer = setTimeout(renderHeatmap, 200);
    });
}

function resetFilters() {
    appState.filters = {
        momentum: 0, quality: 0, valuation: 0, growth: 0,
        timeframe: appState.filters.timeframe, // preserve
        army: 'all', macd: 'all', turtle: 'all', sector: 'all', search: ''
    };
}

function updateUI() {
    const f = appState.filters;
    document.getElementById('filter-momentum').value = f.momentum; document.getElementById('val-momentum').textContent = f.momentum;
    document.getElementById('filter-quality').value = f.quality; document.getElementById('val-quality').textContent = f.quality;
    document.getElementById('filter-valuation').value = f.valuation; document.getElementById('val-valuation').textContent = f.valuation;
    document.getElementById('filter-growth').value = f.growth; document.getElementById('val-growth').textContent = f.growth;
    
    document.getElementById('filter-army').value = f.army;
    document.getElementById('filter-macd').value = f.macd;
    document.getElementById('filter-turtle').value = f.turtle;
    document.getElementById('filter-sector').value = f.sector;
    document.getElementById('filter-search').value = f.search;
}

// Mock Data Generator for Development
function generateMockData() {
    const sectors = ['Information Technology', 'Financials', 'Health Care', 'Consumer Discretionary', 'Industrials'];
    const sectors_zh = ['資訊科技', '金融', '醫療保健', '非必需消費品', '工業'];
    
    return {
        updated_at: new Date().toISOString(),
        stock_count: 503,
        stocks: Array.from({length: 503}, (_, i) => {
            const secIdx = Math.floor(Math.random() * sectors.length);
            return {
                symbol: `STK${i}`,
                name: `Stock ${i}`,
                sector: sectors[secIdx],
                sector_zh: sectors_zh[secIdx],
                price: (Math.random() * 500).toFixed(2),
                change_1d_pct: (Math.random() * 10 - 5).toFixed(2),
                market_cap: Math.random() * 2000000000000,
                factors: {
                    momentum: Math.floor(Math.random() * 101),
                    quality: Math.floor(Math.random() * 101),
                    valuation: Math.floor(Math.random() * 101),
                    growth: Math.floor(Math.random() * 101)
                },
                raw: {
                    pe: (Math.random() * 100).toFixed(1),
                    ps: (Math.random() * 20).toFixed(1),
                    eps: (Math.random() * 10).toFixed(2),
                    roe: (Math.random() * 50).toFixed(1),
                    net_margin: (Math.random() * 40).toFixed(1),
                    revenue_growth: (Math.random() * 100).toFixed(1)
                },
                technical_daily: {
                    army: {
                        alignment: ['多方排列', '空方排列', '糾結'][Math.floor(Math.random() * 3)],
                        vanguard: Math.random() * 200,
                        center: Math.random() * 200,
                        rearguard: Math.random() * 200
                    },
                    turtle: {
                        status: ['突破', '破低', '盤整'][Math.floor(Math.random() * 3)],
                        upper: Math.random() * 250,
                        lower: Math.random() * 150
                    },
                    macd: {
                        status: ['紅柱放大', '綠柱放大', '縮小'][Math.floor(Math.random() * 3)],
                        positive: Math.random() > 0.5,
                        histogram: (Math.random() * 2 - 1).toFixed(2)
                    }
                },
                technical_1h: { /* similar */ },
                backtest_daily: {
                    army: {
                        return_pct: (Math.random() * 100 - 20).toFixed(1),
                        win_rate: Math.floor(Math.random() * 100),
                        trades: Math.floor(Math.random() * 100)
                    }
                },
                backtest_1h: { /* similar */ }
            };
        })
    };
}

function generateMockTemp() {
    const gen = () => ({
        temperature: Math.floor(Math.random() * 101),
        label: ['極凍', '偏冷', '中性', '偏熱', '過熱'][Math.floor(Math.random() * 5)],
        components: {
            army_alignment: { value: Math.floor(Math.random() * 101), weight: 25, detail: "多方 230 · 糾結 193 · 空方 93" },
            above_ma: { value: Math.floor(Math.random() * 101), weight: 25, detail: "前鋒 274 · 中軍 318 · 後衛 342" },
            macd_positive: { value: Math.floor(Math.random() * 101), weight: 15, detail: "柱狀圖為正 263/516" },
            vix_inverse: { value: Math.floor(Math.random() * 101), weight: 15, detail: "VIX 15.99" },
            turtle_net: { value: Math.floor(Math.random() * 101), weight: 10, detail: "突破 13 · 破低 21" },
            pc_ratio_inverse: { value: Math.floor(Math.random() * 101), weight: 10, detail: "P/C 0.82" }
        }
    });
    return {
        updated_at: new Date().toISOString(),
        daily: gen(),
        hourly: gen()
    };
}

// Boot
document.addEventListener('DOMContentLoaded', init);
