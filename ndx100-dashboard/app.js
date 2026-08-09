/**
 * 纳指100 量化仪表盘 —— 前端逻辑
 * 仅依赖全局 echarts（vendor/echarts.min.js）。
 *
 * 数据契约（必须严格遵守）：
 *   data/quotes.json = { ticker: { "YYYY-MM-DD": close_float } }
 *   data/meta.json   = { last_success, source, errors, ticker_count,
 *                        expected_count, generated_at, period_start, index, note }
 *
 * 设计要点（修复 Critic-2 审查问题）：
 *   1. 散点图异常值 winsorize（防止 annReturn/annVol 放大到 ~1e25 摧毁坐标轴）。
 *   2. 原生 IndexedDB 缓存（不依赖 vendor/idb-keyval）；不可用时明确无缓存。
 *   3. 测试钩子用 if (window.__TEST__) 守卫，生产 bundle 不污染。
 *   4. fetch 用 AbortController 10s 超时；2 个静态 json 用 Promise.all 可接受。
 */
(function () {
  'use strict';

  // ===== 常量 =====
  var QUOTES_URL = 'data/quotes.json';
  var META_URL = 'data/meta.json';
  var FETCH_TIMEOUT_MS = 10000;
  var TRADING_DAYS = 252;          // 年化用
  var STALE_DAYS = 3;              // 超过 3 天视为过期
  var RF = 0;                      // 无风险利率（Sharpe 简化）
  var WINSOR_LOW = -0.9;           // 年化收益 winsorize 下界（-90%）
  var WINSOR_HIGH = 5.0;           // 年化收益 winsorize 上界（+500%）
  var WINSOR_VOL = 3.0;            // 年化波动率 winsorize 上界（300%）
  var MIN_SAMPLES_FOR_ANN = 20;    // 年化样本下限（太少会放大噪声）

  // ===== 全局状态 =====
  var state = {
    quotes: {},        // { ticker: { 'YYYY-MM-DD': close } }
    meta: null,        // meta.json
    tickers: [],       // 排序后的个股列表（不含 index）
    currentTicker: null,
    charts: {},        // echarts 实例缓存
    idbReady: false    // IndexedDB 是否可用
  };

  // ====================================================================
  // 一、量化指标函数（每个都做边界保护，样本不足/除零返回 null）
  // ====================================================================

  /**
   * 把 quotes[ticker] 形态 { 'YYYY-MM-DD': close } 转为按日期升序的
   * [{date, t(ms), close}]。非法值会被过滤。
   */
  function toSortedSeries(map) {
    var m = map || {};
    var out = [];
    var keys = Object.keys(m);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = m[k];
      if (v === null || v === undefined || v === '') continue;
      var close = typeof v === 'number' ? v : parseFloat(v);
      if (!isFinite(close)) continue;
      var t = Date.parse(k);
      if (!isFinite(t)) continue;
      out.push({ date: k, t: t, close: close });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  /** 简单移动平均 MA(n)，返回与输入等长的数组，前 n-1 个为 null。 */
  function ma(series, n) {
    if (!Array.isArray(series) || series.length === 0 || !n || n < 1) return [];
    var out = new Array(series.length).fill(null);
    if (series.length < n) return out;
    var sum = 0;
    for (var i = 0; i < series.length; i++) {
      sum += series[i].close;
      if (i >= n) sum -= series[i - n].close;
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  /**
   * RSI(14) Wilder 平滑。
   * 全涨=100，全跌=0，全平（无可计算涨跌）=null，样本不足=null。
   */
  function rsi(series, period) {
    period = period || 14;
    if (!Array.isArray(series) || series.length <= period) return [];
    var out = new Array(series.length).fill(null);
    var gain = 0, loss = 0;
    for (var i = 1; i <= period; i++) {
      var diff = series[i].close - series[i - 1].close;
      if (diff >= 0) gain += diff; else loss -= diff;
    }
    var avgGain = gain / period;
    var avgLoss = loss / period;
    out[period] = rsiValue(avgGain, avgLoss);
    for (var j = period + 1; j < series.length; j++) {
      var d = series[j].close - series[j - 1].close;
      var g = d > 0 ? d : 0;
      var l = d < 0 ? -d : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
      out[j] = rsiValue(avgGain, avgLoss);
    }
    return out;
  }
  function rsiValue(avgGain, avgLoss) {
    if (avgLoss === 0) {
      // 没有下跌：若也没有上涨则视为无趋势 -> null；否则 100
      return avgGain === 0 ? null : 100;
    }
    var rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  /**
   * 布林带 (20, 2σ)。返回 { upper: [], mid: [], lower: [] }，前 n-1 个 null。
   */
  function bollinger(series, n, k) {
    n = n || 20; k = (k === undefined ? 2 : k);
    var len = (series || []).length;
    var upper = new Array(len).fill(null);
    var mid = new Array(len).fill(null);
    var lower = new Array(len).fill(null);
    if (len < n) return { upper: upper, mid: mid, lower: lower };
    for (var i = n - 1; i < len; i++) {
      var sum = 0;
      for (var j = i - n + 1; j <= i; j++) sum += series[j].close;
      var mean = sum / n;
      var varSum = 0;
      for (var j2 = i - n + 1; j2 <= i; j2++) {
        var d2 = series[j2].close - mean;
        varSum += d2 * d2;
      }
      var sd = Math.sqrt(varSum / n);
      mid[i] = mean;
      upper[i] = mean + k * sd;
      lower[i] = mean - k * sd;
    }
    return { upper: upper, mid: mid, lower: lower };
  }

  /** 累计收益率 = (末值 / 首值 - 1)。单点/除零返回 null。 */
  function cumulativeReturn(series) {
    if (!Array.isArray(series) || series.length < 2) return null;
    var first = series[0].close;
    var last = series[series.length - 1].close;
    if (!first || !isFinite(first) || first === 0) return null;
    return last / first - 1;
  }

  /** 日对数收益序列（length = series.length - 1）。 */
  function logReturns(series) {
    if (!Array.isArray(series) || series.length < 2) return [];
    var out = [];
    for (var i = 1; i < series.length; i++) {
      var prev = series[i - 1].close;
      var cur = series[i].close;
      if (!prev || prev <= 0 || !cur || cur <= 0) { out.push(NaN); continue; }
      out.push(Math.log(cur / prev));
    }
    return out;
  }

  /** 对数收益的样本均值/标准差（ddof=1）。 */
  function meanStd(arr) {
    var xs = (arr || []).filter(function (x) { return isFinite(x); });
    var n = xs.length;
    if (n === 0) return { mean: NaN, std: 0, n: 0 };
    var s = 0;
    for (var i = 0; i < n; i++) s += xs[i];
    var mean = s / n;
    var vs = 0;
    for (var j = 0; j < n; j++) { var d = xs[j] - mean; vs += d * d; }
    var std = n > 1 ? Math.sqrt(vs / (n - 1)) : 0;
    return { mean: mean, std: std, n: n };
  }

  /** 年化波动率（对数收益 × √252）。样本不足返回 null。 */
  function annVolatility(series) {
    var r = logReturns(series);
    var ms = meanStd(r);
    if (ms.n < 2 || !isFinite(ms.std)) return null;
    return ms.std * Math.sqrt(TRADING_DAYS);
  }

  /**
   * 年化收益（对数收益均值 × 252）。样本不足返回 null。
   * 用对数避免少量样本 + 暴涨产生的 ~1e25 病态值。
   */
  function annReturn(series) {
    var r = logReturns(series);
    var ms = meanStd(r);
    if (ms.n < MIN_SAMPLES_FOR_ANN || !isFinite(ms.mean)) return null;
    return ms.mean * TRADING_DAYS;
  }

  /** Sharpe(rf=0) = annReturn / annVol。σ=0 返回 null。 */
  function sharpe(series) {
    var ar = annReturn(series);
    var av = annVolatility(series);
    if (ar === null || av === null) return null;
    if (!isFinite(av) || av === 0) return null;
    return (ar - RF) / av;
  }

  /**
   * 最大回撤。返回正值（如 0.25 表示回撤 25%）。
   * 100→75→120 ：峰=100，谷=75，回撤=0.25。
   */
  function maxDrawdown(series) {
    if (!Array.isArray(series) || series.length < 2) return null;
    var peak = series[0].close;
    var maxDd = 0;
    for (var i = 1; i < series.length; i++) {
      var c = series[i].close;
      if (c > peak) peak = c;
      if (peak > 0) {
        var dd = (peak - c) / peak;
        if (dd > maxDd) maxDd = dd;
      }
    }
    return maxDd;
  }

  /**
   * 相对 ^NDX 强弱（累计超额收益）= 个股累计收益 - 指数累计收益。
   * 任一序列不足或首值非正返回 null。
   */
  function relativeStrength(stockSeries, indexSeries) {
    if (!Array.isArray(stockSeries) || !Array.isArray(indexSeries)) return null;
    if (stockSeries.length < 2 || indexSeries.length < 2) return null;
    var sRet = cumulativeReturn(stockSeries);
    var iRet = cumulativeReturn(indexSeries);
    if (sRet === null || iRet === null) return null;
    return sRet - iRet;
  }

  /** winsorize：把 x 裁剪到 [lo, hi]，标记是否被裁。 */
  function winsorize(x, lo, hi) {
    if (x === null || x === undefined || !isFinite(x)) {
      return { v: null, clipped: false };
    }
    var v = x, clipped = false;
    if (v < lo) { v = lo; clipped = true; }
    if (v > hi) { v = hi; clipped = true; }
    return { v: v, clipped: clipped };
  }

  // ====================================================================
  // 二、原生 IndexedDB 缓存（不依赖 vendor/idb-keyval）
  // ====================================================================

  var DB_NAME = 'ndx100-cache';
  var DB_VERSION = 1;
  var STORE = 'kv';

  /** 打开/升级数据库，返回 Promise<IDBDatabase>。失败 reject。 */
  function openDB() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB 不可用'));
        return;
      }
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('打开 IndexedDB 失败')); };
    });
  }
  function idbGet(db, key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readonly');
      var r = tx.objectStore(STORE).get(key);
      r.onsuccess = function () { resolve(r.result === undefined ? null : r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function idbSet(db, key, value) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  /**
   * 读缓存：返回 { quotes, meta } 或 null。
   * key 含 meta.last_success，时间戳变了才认为需要重拉（由调用方比较）。
   */
  function readCache() {
    return openDB().then(function (db) {
      state.idbReady = true;
      return Promise.all([idbGet(db, 'quotes'), idbGet(db, 'meta')]);
    }).then(function (results) {
      if (results[0] && results[1]) return { quotes: results[0], meta: results[1] };
      return null;
    }).catch(function () {
      state.idbReady = false;
      return null;
    });
  }
  function writeCache(quotes, meta) {
    if (!state.idbReady) return Promise.resolve(false);
    return openDB().then(function (db) {
      return Promise.all([idbSet(db, 'quotes', quotes), idbSet(db, 'meta', meta)]);
    }).then(function () { return true; }).catch(function () {
      state.idbReady = false;
      return false;
    });
  }

  // ====================================================================
  // 三、网络拉取（AbortController 超时）
  // ====================================================================

  function fetchWithTimeout(url, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, { cache: 'no-store', signal: ctrl.signal })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        clearTimeout(timer);
        return data;
      }, function (err) {
        clearTimeout(timer);
        throw err;
      });
  }

  /** 拉取 quotes + meta；任一失败抛错。 */
  function fetchAll() {
    return Promise.all([
      fetchWithTimeout(QUOTES_URL, FETCH_TIMEOUT_MS),
      fetchWithTimeout(META_URL, FETCH_TIMEOUT_MS)
    ]).then(function (results) {
      var qRes = results[0], mRes = results[1];
      if (!qRes || typeof qRes !== 'object') throw new Error('quotes.json 格式错误');
      if (!mRes || typeof mRes !== 'object') throw new Error('meta.json 格式错误');
      return { quotes: qRes, meta: mRes };
    });
  }

  // ====================================================================
  // 四、加载流程：缓存优先 + meta 时间戳比对
  // ====================================================================

  function load() {
    var btn = document.getElementById('loadBtn');
    var status = document.getElementById('statusBar');
    btn.disabled = true;
    setStatus(status, '⏳ 正在加载数据…', 'loading');

    return readCache().then(function (cached) {
      if (cached && cached.meta && cached.quotes) {
        // 立即渲染缓存（先到先渲染），再后台比对是否需要刷新
        applyData(cached.quotes, cached.meta, { fromCache: true });
        setStatus(status, '📦 已加载缓存，正在校验是否最新…', 'loading');
      }

      return fetchAll().then(function (fresh) {
        var cachedTs = cached && cached.meta ? cached.meta.last_success : null;
        if (cachedTs && fresh.meta && fresh.meta.last_success === cachedTs &&
            fresh.quotes && Object.keys(fresh.quotes).length > 0) {
          // 时间戳未变，复用缓存（避免重复重绘）
          setStatus(status, '✅ 数据已是最新（缓存命中，meta 时间戳未变）', 'ok');
          applyData(cached.quotes, fresh.meta, { fromCache: true });
        } else {
          applyData(fresh.quotes, fresh.meta, { fromCache: false });
          return writeCache(fresh.quotes, fresh.meta).then(function () {
            setStatus(status,
              state.idbReady ? '✅ 已加载最新数据并写入缓存' : '✅ 已加载最新数据（无持久缓存）',
              'ok');
          });
        }
      }).catch(function (err) {
        if (cached && cached.meta && cached.quotes) {
          // 网络失败但有缓存：降级使用缓存
          setStatus(status, '⚠️ 网络失败，已降级使用缓存数据：' + err.message, 'warn');
        } else {
          // 无缓存且失败：显示错误与空状态
          setStatus(status, '⛔ 加载失败：' + err.message, 'error');
          showErrorState(err.message);
        }
      });
    }).then(function () {
      btn.disabled = false;
    }, function () {
      btn.disabled = false;
    });
  }

  // ====================================================================
  // 五、UI 渲染
  // ====================================================================

  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className = 'status-bar' + (kind ? ' status-' + kind : '');
  }

  function applyData(quotes, meta, opts) {
    state.quotes = quotes || {};
    state.meta = meta || null;
    // tickers 排除指数
    state.tickers = Object.keys(state.quotes)
      .filter(function (t) { return t !== '^NDX'; })
      .sort();
    if (state.tickers.length === 0) {
      showErrorState('quotes 为空，无可显示的个股。');
      return;
    }
    // 显示图表区，隐藏空状态
    show(document.getElementById('chartsArea'));
    hide(document.getElementById('emptyState'));

    populateTickerSelect();
    renderBanners(meta);
    renderMetrics();
    renderNormalized();
    renderScatter();
    renderRelative();
    // 默认渲染第一只个股
    if (!state.currentTicker || !state.quotes[state.currentTicker]) {
      state.currentTicker = state.tickers[0];
    }
    var sel = document.getElementById('tickerSelect');
    if (sel) sel.value = state.currentTicker;
    renderTrend(state.currentTicker);
  }

  function populateTickerSelect() {
    var sel = document.getElementById('tickerSelect');
    if (!sel) return;
    sel.innerHTML = '';
    state.tickers.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t; o.textContent = t;
      sel.appendChild(o);
    });
  }

  function renderBanners(meta) {
    var stale = document.getElementById('staleBanner');
    var staleText = document.getElementById('staleText');
    var failed = document.getElementById('failedBanner');
    var failedText = document.getElementById('failedText');
    hide(stale); hide(failed);
    if (!meta) return;

    // 过期检测
    if (meta.last_success) {
      var t = Date.parse(meta.last_success);
      var now = Date.now();
      if (isFinite(t) && (now - t) > STALE_DAYS * 86400000) {
        staleText.textContent =
          'meta.last_success = ' + meta.last_success + '（已超过 ' + STALE_DAYS + ' 天）。请到 Actions tab 检查 daily workflow 是否被禁用。';
        show(stale);
      }
    }
    // FAILED / cached 检测
    if (typeof meta.source === 'string') {
      if (meta.source.indexOf('FAILED') >= 0) {
        failedText.textContent =
          'meta.source = "' + meta.source + '"。数据源全部失败，请检查 Actions 日志。';
        show(failed);
      } else if (meta.source === 'cached') {
        failedText.textContent =
          'meta.source = "cached"。本次未抓到新数据，展示的是上次缓存。';
        show(failed);
      }
    }
  }

  // ----- 指标卡片 -----
  function renderMetrics() {
    var box = document.getElementById('metricCards');
    if (!box) return;
    var tk = state.currentTicker || state.tickers[0];
    var series = toSortedSeries(state.quotes[tk] || {});
    var idxSeries = toSortedSeries(state.quotes['^NDX'] || {});
    var items = [
      ['当前个股', tk || '—', 'ticker'],
      ['样本天数', String(series.length), 'count'],
      ['累计收益', fmtPct(cumulativeReturn(series)), 'ret'],
      ['年化收益', fmtPct(annReturn(series)), 'ret'],
      ['年化波动', fmtPct(annVolatility(series)), 'vol'],
      ['Sharpe(rf=0)', fmtNum(sharpe(series), 3), 'sharpe'],
      ['最大回撤', fmtPct(maxDrawdown(series)), 'dd'],
      ['相对^NDX', fmtPct(relativeStrength(series, idxSeries)), 'rel']
    ];
    box.innerHTML = items.map(function (it) {
      return '<div class="metric-card m-' + it[2] + '">' +
        '<div class="m-label">' + it[0] + '</div>' +
        '<div class="m-value">' + it[1] + '</div></div>';
    }).join('');
  }

  // ----- 1. 个股趋势图 -----
  function renderTrend(ticker) {
    var el = document.getElementById('chartTrend');
    if (!el) return;
    var chart = getChart(el);
    var series = toSortedSeries(state.quotes[ticker] || {});
    if (series.length === 0) {
      chart.setOption({ xAxis: { type: 'time' }, yAxis: { type: 'value' }, series: [] }, true);
      return;
    }
    var closes = series.map(function (s) { return [s.date, s.close]; });
    var ma20 = ma(series, 20);
    var ma50 = ma(series, 50);
    var bb = bollinger(series, 20, 2);
    var opt = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: { data: ['收盘价', 'MA20', 'MA50', 'BOLL上', 'BOLL中', 'BOLL下'], top: 0 },
      grid: { left: 50, right: 30, top: 50, bottom: 70 },
      dataZoom: [
        { type: 'inside', start: 60, end: 100 },
        { type: 'slider', start: 60, end: 100, height: 20 }
      ],
      xAxis: { type: 'time' },
      yAxis: { type: 'value', scale: true },
      series: [
        lineSeries('收盘价', closes, '#2b6cb0', 2),
        lineSeries('MA20', zip(series, ma20), '#dd6b20', 1),
        lineSeries('MA50', zip(series, ma50), '#38a169', 1),
        lineSeries('BOLL上', zip(series, bb.upper), '#bbb', 1),
        lineSeries('BOLL中', zip(series, bb.mid), '#888', 1),
        lineSeries('BOLL下', zip(series, bb.lower), '#bbb', 1)
      ]
    };
    chart.setOption(opt, true); // notMerge 刷新
  }
  function lineSeries(name, data, color, width) {
    return {
      name: name, type: 'line', data: data, smooth: false,
      showSymbol: false, lineStyle: { color: color, width: width || 1.5 },
      itemStyle: { color: color },
      connectNulls: false
    };
  }
  function zip(series, arr) {
    var out = [];
    for (var i = 0; i < series.length; i++) {
      var v = arr[i];
      out.push(v === null ? [series[i].date, '-'] : [series[i].date, v]);
    }
    return out;
  }

  // ----- 2. 百股归一化（首日=100） -----
  function renderNormalized() {
    var el = document.getElementById('chartNormalized');
    if (!el) return;
    var chart = getChart(el);
    var seriesList = [];
    var legend = [];
    var tkList = state.tickers.slice(0, 100);
    for (var i = 0; i < tkList.length; i++) {
      var tk = tkList[i];
      var s = toSortedSeries(state.quotes[tk] || {});
      if (s.length < 2) continue;
      var base = s[0].close;
      if (!base || base <= 0) continue;
      var data = s.map(function (p) { return [p.date, +(p.close / base * 100).toFixed(2)]; });
      legend.push(tk);
      seriesList.push({
        name: tk, type: 'line', data: data, showSymbol: false,
        lineStyle: { width: 1 }, emphasis: { focus: 'series' }
      });
    }
    chart.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'line' } },
      legend: { type: 'scroll', top: 0, data: legend },
      grid: { left: 50, right: 30, top: 40, bottom: 60 },
      dataZoom: [{ type: 'inside', start: 0, end: 100 }],
      xAxis: { type: 'time' },
      yAxis: { type: 'value', name: '归一化(首日=100)', scale: true },
      series: seriesList
    }, true);
  }

  // ----- 3. 风险-回报散点（winsorize） -----
  function renderScatter() {
    var el = document.getElementById('chartScatter');
    if (!el) return;
    var chart = getChart(el);
    var normal = [];      // 正常点
    var outliers = [];    // 被 winsorize 裁剪的离群点
    for (var i = 0; i < state.tickers.length; i++) {
      var tk = state.tickers[i];
      var s = toSortedSeries(state.quotes[tk] || {});
      var ar = annReturn(s);
      var av = annVolatility(s);
      if (ar === null || av === null) continue;
      var arW = winsorize(ar, WINSOR_LOW, WINSOR_HIGH);
      var avW = winsorize(av, 0, WINSOR_VOL);
      if (arW.v === null || avW.v === null) continue;
      var point = [+(avW.v * 100).toFixed(2), +(arW.v * 100).toFixed(2), tk];
      if (arW.clipped || avW.clipped) outliers.push(point);
      else normal.push(point);
    }
    chart.setOption({
      tooltip: {
        formatter: function (p) {
          return (p.data[2] || '') + '<br/>波动: ' + p.data[0] + '%<br/>收益: ' + p.data[1] + '%';
        }
      },
      legend: { data: ['正常', '离群(winsorize裁剪)'], top: 0 },
      grid: { left: 60, right: 30, top: 40, bottom: 50 },
      xAxis: { type: 'value', name: '年化波动率(%)', scale: true,
               max: WINSOR_VOL * 100 },
      yAxis: { type: 'value', name: '年化收益(%)', scale: true,
               min: WINSOR_LOW * 100, max: WINSOR_HIGH * 100 },
      series: [
        {
          name: '正常', type: 'scatter', data: normal,
          symbolSize: 8, itemStyle: { color: '#3182ce', opacity: 0.7 }
        },
        {
          name: '离群(winsorize裁剪)', type: 'scatter', data: outliers,
          symbolSize: 10, itemStyle: { color: '#e53e3e' },
          label: {
            show: true, position: 'top', formatter: function (p) { return p.data[2]; },
            fontSize: 10, color: '#e53e3e'
          }
        }
      ]
    }, true);
  }

  // ----- 4. 相对 NDX 强弱条形（排序） -----
  function renderRelative() {
    var el = document.getElementById('chartRelative');
    if (!el) return;
    var chart = getChart(el);
    var idxSeries = toSortedSeries(state.quotes['^NDX'] || {});
    var rows = [];
    for (var i = 0; i < state.tickers.length; i++) {
      var tk = state.tickers[i];
      var s = toSortedSeries(state.quotes[tk] || {});
      var rs = relativeStrength(s, idxSeries);
      if (rs === null) continue;
      rows.push({ tk: tk, v: rs });
    }
    if (rows.length === 0) {
      chart.setOption({ xAxis: { type: 'value' }, yAxis: { type: 'category' }, series: [] }, true);
      return;
    }
    rows.sort(function (a, b) { return a.v - b.v; });
    // 太多则只显示头尾各 20，避免轴过密
    var display = rows;
    if (rows.length > 40) {
      display = rows.slice(0, 20).concat(rows.slice(rows.length - 20));
    }
    var yCats = display.map(function (r) { return r.tk; });
    var data = display.map(function (r) {
      return {
        value: +(r.v * 100).toFixed(2),
        itemStyle: { color: r.v >= 0 ? '#38a169' : '#e53e3e' }
      };
    });
    chart.setOption({
      tooltip: { formatter: function (p) { return p.name + ': ' + p.value + '%'; } },
      grid: { left: 70, right: 40, top: 20, bottom: 40 },
      xAxis: { type: 'value', name: '相对^NDX(%)' },
      yAxis: { type: 'category', data: yCats },
      dataZoom: [{ type: 'slider', yAxisIndex: 0, width: 14, start: 0, end: 100 }],
      series: [{ type: 'bar', data: data }]
    }, true);
  }

  // ====================================================================
  // 六、工具
  // ====================================================================

  function getChart(el) {
    var id = el.id;
    if (state.charts[id]) return state.charts[id];
    var c = echarts.init(el);
    state.charts[id] = c;
    window.addEventListener('resize', function () {
      Object.keys(state.charts).forEach(function (k) { state.charts[k].resize(); });
    });
    return c;
  }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function showErrorState(msg) {
    var es = document.getElementById('emptyState');
    if (!es) return;
    show(es);
    var card = es.querySelector('.empty-card');
    if (card) {
      card.innerHTML =
        '<div class="empty-icon">⛔</div>' +
        '<h2>无法加载</h2>' +
        '<p>' + (msg || '未知错误') + '</p>' +
        '<p class="hint">请稍后重试，或检查 data/ 目录是否存在数据文件。</p>';
    }
    // 隐藏图表区
    hide(document.getElementById('chartsArea'));
  }
  function fmtPct(x) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return (x * 100).toFixed(2) + '%';
  }
  function fmtNum(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return Number(x).toFixed(d || 2);
  }

  // ====================================================================
  // 七、绑定事件 + 启动
  // ====================================================================

  function bind() {
    var btn = document.getElementById('loadBtn');
    if (btn) btn.addEventListener('click', load);
    var sel = document.getElementById('tickerSelect');
    if (sel) sel.addEventListener('change', function () {
      state.currentTicker = sel.value;
      renderTrend(state.currentTicker);
      renderMetrics();
    });
  }

  function init() {
    bind();
    // 测试钩子：仅当显式设置 window.__TEST__ 时暴露，生产 bundle 不污染
    if (window.__TEST__) {
      window.NDX100 = {
        // 指标
        toSortedSeries: toSortedSeries,
        ma: ma,
        rsi: rsi,
        rsiValue: rsiValue,
        bollinger: bollinger,
        cumulativeReturn: cumulativeReturn,
        logReturns: logReturns,
        meanStd: meanStd,
        annVolatility: annVolatility,
        annReturn: annReturn,
        sharpe: sharpe,
        maxDrawdown: maxDrawdown,
        relativeStrength: relativeStrength,
        winsorize: winsorize,
        // 常量
        TRADING_DAYS: TRADING_DAYS,
        MIN_SAMPLES_FOR_ANN: MIN_SAMPLES_FOR_ANN,
        // IO（测试可注入）
        _state: state
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
