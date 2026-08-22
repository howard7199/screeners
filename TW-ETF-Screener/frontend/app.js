const appState = {
    screenerData: null,
    temperatureData: null,
    filteredData: [],
    
    // Filters
    filters: {
        category: 'all',
        subCategory: 'all',
        signal: 'all',
        premium: 'all',
        army: 'all',
        institutional: 'all',
        macd: 'all',
        yield: 'all',
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

const getSignalClass = (label) => {
    if (label === '強烈買入') return 'sig-strong-buy';
    if (label === '買入') return 'sig-buy';
    if (label === '中性') return 'sig-neutral';
    if (label === '賣出') return 'sig-sell';
    if (label === '強烈賣出') return 'sig-strong-sell';
    return 'sig-neutral';
};

const getSignalIcon = (label) => {
    if (label === '強烈買入') return '🔥';
    if (label === '買入') return '🟢';
    if (label === '中性') return '🟡';
    if (label === '賣出') return '🟠';
    if (label === '強烈賣出') return '🔴';
    return '⚪';
};

const formatNum = (num, decimals = 2) => num != null ? Number(num).toFixed(decimals) : '--';
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
    document.getElementById('update-time').textContent = data?.updated_at ? new Date(data.updated_at).toLocaleString('zh-TW') : '--';
    document.getElementById('etf-count').textContent = data?.etf_count ?? '--';
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
    document.getElementById('gauge-label').textContent = data.label ?? '--';
    
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
            'premium_distribution': '折溢價分佈',
            'above_ma': '站上均線',
            'institutional_net': '法人淨買超',
            'yield_percentile_inverse': '殖利率位階',
            'macd_positive': 'MACD正向',
            'turtle_net': '海龜突破'
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
    
    // Sub-category population
    const updateSubCategories = () => {
        const cat = appState.filters.category;
        let subCats = [];
        if (cat === 'all') {
            subCats = [...new Set(appState.screenerData.etfs.map(e => e?.sub_category))].filter(Boolean);
        } else {
            subCats = [...new Set(appState.screenerData.etfs.filter(e => e?.category === cat).map(e => e?.sub_category))].filter(Boolean);
        }
        
        const select = document.getElementById('filter-sub-category');
        if (select) {
            select.innerHTML = '<option value="all">全部</option>';
            subCats.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                select.appendChild(opt);
            });
            select.value = 'all';
            appState.filters.subCategory = 'all';
        }
    };
    
    document.getElementById('filter-category')?.addEventListener('change', debounce((e) => {
        appState.filters.category = e.target.value;
        updateSubCategories();
        applyFilters();
    }, 150));
    
    updateSubCategories();
}

function applyFilters() {
    const f = appState.filters;
    const search = f.search?.toLowerCase() || '';
    
    if (!appState.screenerData?.etfs) return;
    
    appState.filteredData = appState.screenerData.etfs.filter(s => {
        if (!s) return false;
        
        if (f.category !== 'all' && s.category !== f.category) return false;
        if (f.subCategory !== 'all' && s.sub_category !== f.subCategory) return false;
        
        if (f.signal !== 'all' && s.signal?.label !== f.signal) return false;
        if (f.premium !== 'all' && s.nav?.signal !== f.premium) return false;
        if (f.institutional !== 'all' && s.institutional?.signal !== f.institutional) return false;
        
        if (f.yield !== 'all' && s.yield?.signal !== f.yield) return false;
        
        const tfKey = f.timeframe === 'daily' ? 'technical_daily' : 'technical_1h';
        const tech = s[tfKey] || {};
        if (f.army !== 'all' && tech.army?.alignment !== f.army) return false;
        if (f.macd !== 'all' && tech.macd?.status !== f.macd) return false;
        
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
    if (countEl) countEl.textContent = `${appState.filteredData.length}`;
    
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
    const btKey = appState.filters.timeframe === 'daily' ? 'backtest_1h' : 'backtest_1h';
    
    pageData.forEach((s, idx) => {
        const tech = s[tfKey] || {};
        const tr = document.createElement('tr');
        tr.className = 'main-row';
        
        const premiumClass = (s.nav?.premium_pct ?? 0) > 1 ? 'neg' : ((s.nav?.premium_pct ?? 0) < -1 ? 'pos' : 'neu');
        
        tr.innerHTML = `
            <td>${start + idx + 1}</td>
            <td class="num font-weight-bold">${s.symbol ?? '--'}</td>
            <td>${s.name ?? '--'}</td>
            <td>${s.category ?? '--'}</td>
            <td class="num">${formatNum(s.price, 2)}</td>
            <td class="num ${(s.change_1d_pct ?? 0) > 0 ? 'pos' : ((s.change_1d_pct ?? 0) < 0 ? 'neg' : 'neu')}">${(s.change_1d_pct ?? 0) > 0 ? '+' : ''}${formatNum(s.change_1d_pct)}%</td>
            <td>
                <span class="signal-badge ${getSignalClass(s.signal?.label)}">
                    ${getSignalIcon(s.signal?.label)} ${s.signal?.label || '-'} ${s.signal?.score ?? 0}
                </span>
            </td>
            <td class="num ${premiumClass}">${formatNum(s.nav?.premium_pct)}%</td>
            <td class="num">${formatNum(s.yield?.annual_pct)}%</td>
            <td class="num">${s.yield?.percentile ?? '-'}%</td>
            <td>${tech.army?.alignment || '-'}</td>
            <td class="${s.institutional?.signal === '法人加碼' || s.institutional?.signal === '法人偏多' ? 'pos' : (s.institutional?.signal === '法人減碼' || s.institutional?.signal === '法人偏空' ? 'neg' : '')}">${s.institutional?.signal || '-'}</td>
        `;
        
        const trDetail = document.createElement('tr');
        trDetail.className = 'detail-row';
        const cols = 12;
        
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
                        <h4>淨值與配息</h4>
                        <div class="detail-item"><span class="lbl">預估淨值</span><span class="val">${formatNum(s.nav?.value)}</span></div>
                        <div class="detail-item"><span class="lbl">折溢價狀態</span><span class="val">${s.nav?.signal ?? '--'}</span></div>
                        <div class="detail-item"><span class="lbl">近四季配息</span><span class="val">${formatNum(s.yield?.last_4q_div)}</span></div>
                        <div class="detail-item"><span class="lbl">配息頻率</span><span class="val">${s.yield?.frequency ?? '--'}</span></div>
                        <div class="detail-item"><span class="lbl">下次除息日</span><span class="val">${s.yield?.next_ex_date ?? '--'}</span></div>
                    </div>
                    <div class="detail-group">
                        <h4>技術面與籌碼</h4>
                        <div class="detail-item"><span class="lbl">MACD 狀態</span><span class="val">${tech.macd?.status ?? '--'} (${formatNum(tech.macd?.histogram)})</span></div>
                        <div class="detail-item"><span class="lbl">前鋒 (20MA)</span><span class="val">${formatNum(tech.army?.vanguard)}</span></div>
                        <div class="detail-item"><span class="lbl">中軍 (60MA)</span><span class="val">${formatNum(tech.army?.center)}</span></div>
                        <div class="detail-item"><span class="lbl">後衛 (240MA)</span><span class="val">${formatNum(tech.army?.rearguard)}</span></div>
                        <div class="detail-item"><span class="lbl">前鋒斜率</span><span class="val">${formatNum(tech.army?.vanguard_slope, 4)}</span></div>
                        <div class="detail-item"><span class="lbl">RSI</span><span class="val">${formatNum(tech.rsi?.value)}</span></div>
                        <div class="detail-item"><span class="lbl">海龜狀態</span><span class="val">${tech.turtle?.status ?? '--'}</span></div>
                        <div class="detail-item"><span class="lbl">外資近5日</span><span class="val">${s.institutional?.foreign_net_5d != null ? Number(s.institutional.foreign_net_5d).toLocaleString('zh-TW') : '--'} 股</span></div>
                        <div class="detail-item"><span class="lbl">投信近5日</span><span class="val">${s.institutional?.trust_net_5d != null ? Number(s.institutional.trust_net_5d).toLocaleString('zh-TW') : '--'} 股</span></div>
                    </div>
                    <div class="detail-group">
                        <h4>基本資料 & 回測</h4>
                        <div class="detail-item"><span class="lbl">發行商</span><span class="val">${s.metadata?.issuer ?? '--'}</span></div>
                        <div class="detail-item"><span class="lbl">追蹤指數</span><span class="val">${s.metadata?.tracking_index ?? '--'}</span></div>
                        <div class="detail-item"><span class="lbl">內扣費用</span><span class="val">${formatNum(s.metadata?.expense_ratio)}%</span></div>
                        <div class="detail-item"><span class="lbl">基金規模</span><span class="val">${s.metadata?.fund_size ? (s.metadata.fund_size / 1e8).toFixed(0) + ' 億' : '--'}</span></div>
                        ${s[btKey]?.army ? `
                            <div class="detail-item"><span class="lbl">三軍陣列回測</span><span class="val ${(s[btKey].army?.return_pct ?? 0) > 0 ? 'pos' : 'neg'}">${formatNum(s[btKey].army?.return_pct)}% (勝率 ${s[btKey].army?.win_rate}%)</span></div>
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
    if (pageInfo) pageInfo.textContent = `第 ${appState.page} / ${totalPages || 1} 頁`;
    
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
        appState.filteredData.forEach(s => {
        const cat = s.category || '其他';
        if (!categories[cat]) categories[cat] = { name: cat, children: [], totalChange: 0 };
        categories[cat].children.push(s);
        categories[cat].totalChange += (s.change_1d_pct ?? 0);
    });
    
    // Use equal weight (count) since most ETFs lack fund_size
    let catNodes = Object.values(categories).map(c => ({
        ...c,
        value: c.children.length,
        avgChange: c.totalChange / c.children.length
    })).sort((a, b) => b.value - a.value);
    
    const W = container.clientWidth;
    const H = container.clientHeight || 350;
    const totalValue = catNodes.reduce((s, n) => s + n.value, 0);
    
    if (totalValue === 0) return;
    
    // Layout: horizontal slices for categories, grid within each category
    let catY = 0;
    let itemCount = 0;
    const fragment = document.createDocumentFragment();
    
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
            if (itemCount >= 200) return;
            itemCount++;
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
            node.title = `${etf.symbol} ${etf.name}\n漲跌: ${change > 0 ? '+' : ''}${change.toFixed(2)}%\n訊號: ${etf.signal?.label ?? '-'} ${etf.signal?.score ?? '-'}`;
            
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
    // Selects and Text
    ['sub-category', 'signal', 'premium', 'army', 'institutional', 'macd', 'yield', 'search'].forEach(filter => {
        const el = document.getElementById(`filter-${filter}`);
        if (el) {
            const stateKey = filter === 'sub-category' ? 'subCategory' : filter;
            el.addEventListener('change', debounce((e) => {
                appState.filters[stateKey] = e.target.value;
                applyFilters();
            }, 150));
            if(filter === 'search') {
                // Keep the change debounced listener or remove it? The previous code added a change listener for everything and a keyup for search.
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
        ['qf-value', () => { 
            resetFilters(); 
            appState.filters.premium = '合理'; 
            appState.filters.yield = '殖利率相對高'; 
        }],
        ['qf-technical', () => { 
            resetFilters(); 
            appState.filters.army = '多方排列';
            // MACD is not specifically in a dropdown for ETF screener based on prompt, handle manually if needed or leave as is
        }],
        ['qf-institutional', () => { 
            resetFilters(); 
            appState.filters.institutional = '法人加碼'; // Simplified mapping, would need actual partial matching if complex
        }],
        ['qf-reset', () => { resetFilters(); }]
    ];
    
    qfSetup.forEach(([id, fn]) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', () => {
                fn();
                updateUI();
                applyFilters();
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
        category: 'all', subCategory: 'all', signal: 'all', premium: 'all',
        army: 'all', institutional: 'all', macd: 'all', yield: 'all', search: '',
        timeframe: appState.filters.timeframe
    };
    
    // reset subcategory options correctly
    const select = document.getElementById('filter-sub-category');
    if (select) {
        select.innerHTML = '<option value="all">全部</option>';
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
        ['filter-premium', f.premium],
        ['filter-army', f.army],
        ['filter-institutional', f.institutional],
        ['filter-macd', f.macd],
        ['filter-yield', f.yield],
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
    const categories = ['市值型', '高股息', '債券型', '主題型', '海外型', '主動型'];
    const signals = ['強烈買入', '買入', '中性', '賣出', '強烈賣出'];
    
    return {
        updated_at: new Date().toISOString(),
        etf_count: 258,
        etfs: Array.from({length: 258}, (_, i) => {
            const cat = categories[Math.floor(Math.random() * categories.length)];
            const symbol = String(50 + i).padStart(4, '0');
            const sigScore = Math.floor(Math.random() * 100);
            let sigLabel = '中性';
            if (sigScore >= 80) sigLabel = '強烈買入';
            else if (sigScore >= 60) sigLabel = '買入';
            else if (sigScore <= 20) sigLabel = '強烈賣出';
            else if (sigScore <= 40) sigLabel = '賣出';
            
            return {
                symbol: symbol,
                name: `台灣 ETF ${symbol}`,
                category: cat,
                sub_category: cat + '子類',
                market: '上市',
                price: (Math.random() * 190 + 10).toFixed(2),
                change_1d_pct: (Math.random() * 6 - 3).toFixed(2),
                nav: { 
                    value: (Math.random() * 190 + 10).toFixed(2), 
                    premium_pct: (Math.random() * 4 - 2).toFixed(2), 
                    signal: ['折價', '合理', '溢價'][Math.floor(Math.random() * 3)] 
                },
                yield: { 
                    annual_pct: (Math.random() * 10).toFixed(2), 
                    percentile: Math.floor(Math.random() * 100), 
                    last_4q_div: (Math.random() * 5).toFixed(2), 
                    next_ex_date: "2026-10-16", 
                    frequency: "季配", 
                    signal: "中性" 
                },
                signal: {
                    score: sigScore, 
                    label: sigLabel,
                    components: {
                        yield: {value: Math.floor(Math.random() * 100), weight: 10, label: "殖利率"},
                        premium: {value: Math.floor(Math.random() * 100), weight: 20, label: "折溢價"},
                        technical: {value: Math.floor(Math.random() * 100), weight: 25, label: "技術面"},
                        institutional: {value: Math.floor(Math.random() * 100), weight: 20, label: "籌碼面"},
                        momentum: {value: Math.floor(Math.random() * 100), weight: 15, label: "動能"},
                        turtle: {value: Math.floor(Math.random() * 100), weight: 10, label: "海龜"}
                    }
                },
                institutional: { 
                    foreign_net_5d: Math.floor(Math.random() * 20000 - 10000), 
                    trust_net_5d: Math.floor(Math.random() * 10000 - 5000), 
                    foreign_streak: Math.floor(Math.random() * 10), 
                    signal: ['法人加碼', '法人偏多', '觀望', '法人偏空', '法人減碼'][Math.floor(Math.random() * 5)] 
                },
                metadata: { 
                    fund_size: Math.random() * 100000000000 + 100000000, 
                    expense_ratio: 0.43, 
                    tracking_index: "某某指數", 
                    issuer: "某某投信" 
                },
                technical_daily: {
                    army: { 
                        alignment: ['多方排列', '空方排列', '糾結'][Math.floor(Math.random() * 3)], 
                        vanguard: 193.2, center: 190.5, rearguard: 185.3, vanguard_slope: 0.15 
                    },
                    turtle: { status: "盤整", upper: 198.5, lower: 188.0 },
                    macd: { positive: Math.random() > 0.5, histogram: (Math.random() * 2 - 1).toFixed(2), status: "紅柱放大" },
                    rsi: 58.3
                },
                technical_1h: {},
                backtest_1h: { army: { return_pct: 12.5, win_rate: 52, trades: 28 } }
            };
        })
    };
}

function generateMockTemp() {
    const gen = () => ({
        temperature: Math.floor(Math.random() * 100), 
        label: "中性",
        components: {
            premium_distribution: {value: Math.floor(Math.random() * 100), weight: 25, detail: "平均折溢價 +0.12%"},
            above_ma: {value: Math.floor(Math.random() * 100), weight: 20, detail: "站上均線 128/258"},
            institutional_net: {value: Math.floor(Math.random() * 100), weight: 20, detail: "法人淨買超 15.2億"},
            yield_inverse: {value: Math.floor(Math.random() * 100), weight: 15, detail: "平均殖利率位階 60%"},
            macd_positive: {value: Math.floor(Math.random() * 100), weight: 10, detail: "MACD正 124/258"},
            turtle_net: {value: Math.floor(Math.random() * 100), weight: 10, detail: "突破 12 / 破低 18"}
        }
    });
    return {
        updated_at: "2026-08-02",
        daily: gen(),
        '1h': gen()
    };
}

// Boot
document.addEventListener('DOMContentLoaded', init);
