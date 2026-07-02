const vscode = require('vscode');
const COOKIE = 'huawei-maas.cookie', PROJECT = 'fe361917fa424d81a8dcba022cbc0fd0'; let bar, panel, last, output, refreshTimer, logoUri, selectedRange = 'today', dailyTokenLimit = 100000000;
const METRICS = {
    requests: ['total_calls', 'request_count', 'total_requests', 'calls', 'total_count', 'request_num', 'request_count_total', 'invoke_count', 'invocation_count', 'total_invocations', 'access_count', 'total_access_count'],
    totalTokens: ['total_tokens', 'total_token', 'token_count', 'tokens', 'total_token_count', 'total_token_num', 'token_num'],
    inputTokens: ['input_tokens', 'input_token', 'prompt_tokens', 'prompt_token', 'input_token_count', 'prompt_token_count', 'input_token_num'],
    outputTokens: ['output_tokens', 'output_token', 'completion_tokens', 'completion_token', 'output_token_count', 'completion_token_count', 'output_token_num'],
    success: ['success_calls', 'success_count', 'successful_requests', 'success_num', 'succeeded_count', 'succ_2xx_count'],
    failures: ['failed_calls', 'failure_count', 'failed_requests', 'failed_count', 'fail_count', 'failure_num', 'error_count', 'req_count4xx5xx']
};
function activate(c) {
    dailyTokenLimit = c.globalState.get('dailyTokenLimit', c.globalState.get('monthlyTokenLimit', 100000000));
    output = vscode.window.createOutputChannel('Huawei MaaS Cockpit');
    bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    bar.command = 'huawei-maas.open'; bar.text = '$(key) MaaS: Sign in'; bar.show();
    c.subscriptions.push(output, bar,
        ...[['huawei-maas.configure', () => configure(c)], ['huawei-maas.open', () => open(c)], ['huawei-maas.refresh', () => refresh(c, true)], ['huawei-maas.clear', () => clear(c)], ['huawei-maas.showLogs', () => output.show(true)]].map(x => vscode.commands.registerCommand(...x)));
    const n = vscode.workspace.getConfiguration('huaweiMaaS').get('refreshInterval', 5);
    if (n > 0) { refreshTimer = setInterval(() => refresh(c), n * 60000); c.subscriptions.push({ dispose: () => clearInterval(refreshTimer) }); }
    refresh(c);
}
async function configure(c) { const project = await vscode.window.showInputBox({ title: 'Huawei MaaS: Project ID', value: c.globalState.get('projectId', PROJECT), ignoreFocusOut: true, validateInput: v => /^[a-f\d]{32}$/i.test(v.trim()) ? undefined : 'Enter a 32-character project ID' }); if (project === undefined) return; const cookie = await vscode.window.showInputBox({ title: 'Huawei MaaS: Console Cookie', prompt: 'Paste the full Cookie request-header value', password: true, ignoreFocusOut: true, validateInput: v => v.includes('=') ? undefined : 'Paste a Cookie header' }); if (cookie === undefined) return; const limitInput = await vscode.window.showInputBox({ title: 'Huawei MaaS: Daily Token Budget', prompt: 'Enter the daily token budget, for example 100M or 100000000', value: compactInput(dailyTokenLimit), ignoreFocusOut: true, validateInput: value => parseTokenLimit(value) > 0 ? undefined : 'Enter a positive value such as 100M' }); if (limitInput === undefined) return; dailyTokenLimit = parseTokenLimit(limitInput); await c.globalState.update('dailyTokenLimit', dailyTokenLimit); await c.globalState.update('projectId', project.trim()); await c.secrets.store(COOKIE, cookie.replace(/^Cookie:\s*/i, '').trim()); await refresh(c, true); }
async function clear(c) { await c.secrets.delete(COOKIE); last = undefined; bar.text = '$(key) MaaS: Sign in'; if (panel) panel.webview.html = view(); }
async function open(c) { if (!panel) { panel = vscode.window.createWebviewPanel('huaweiMaaS', 'Huawei MaaS Cockpit', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true }); const logo = vscode.Uri.joinPath(c.extensionUri, 'media', 'huawei-maas.svg'); logoUri = panel.webview.asWebviewUri(logo).toString(); panel.iconPath = logo; panel.onDidDispose(() => { panel = undefined; logoUri = undefined; }); panel.webview.onDidReceiveMessage(m => m.command === 'configure' ? configure(c) : refresh(c, true, m.days)); } panel.reveal(); panel.webview.html = view(); if (!last) refresh(c); }
async function refresh(c, notify = false, range = selectedRange) {
    selectedRange = ['today', 'yesterday', '1', '7', '30', 'month'].includes(String(range)) ? String(range) : 'today';
    const cookie = await c.secrets.get(COOKIE);
    log('STEP 1', `Refresh started (${rangeLabel(selectedRange)}). Cookie present: ${Boolean(cookie)}.`);
    if (!cookie) { log('STOP', 'No cookie is configured.'); if (panel) panel.webview.html = view(); return; }
    bar.text = '$(sync~spin) MaaS'; if (panel) panel.webview.html = view({ loading: true });
    try {
        last = await request(c.globalState.get('projectId', PROJECT), cookie, selectedRange);
        const resolved = resolvedMetrics(last.summary, last.services);
        log('STEP 6', `Resolved dashboard metrics: ${JSON.stringify(resolved)}`);
        updateStatusBar(last, resolved);
        if (panel) panel.webview.html = view();
        // Production: keep successful background/manual refreshes quiet. Uncomment for diagnostic builds.
        // if (notify) vscode.window.showInformationMessage('Huawei MaaS statistics refreshed. Open Output → Huawei MaaS Cockpit for diagnostics.');
    } catch (e) {
        const msg = [401, 403].includes(e.status) ? 'Console session expired. Configure the cookie again.' : e.message;
        log('FAILED', msg); bar.text = '$(warning) MaaS'; bar.tooltip = msg;
        if (panel) panel.webview.html = view({ error: msg });
        if (notify) { vscode.window.showErrorMessage(`Huawei MaaS: ${msg}`); output.show(true); }
    }
}
function parseTokenLimit(value) { const match = String(value).trim().replace(/,/g, '').match(/^([0-9]*\.?[0-9]+)\s*([KMBT])?$/i); if (!match) return 0; return Math.round(Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase()] || 1)); }
function compactInput(value) { const parts = compactParts(value); return `${parts.number}${parts.suffix}`; }function rangeLabel(range) { return ({ today: 'Today', yesterday: 'Yesterday', '1': '24 hours', '7': '7 days', '30': '30 days', month: 'This month' })[range] || '30 days'; }
function timezoneOffset(timestamp, timezone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - timestamp;
}
function zonedDateParts(timestamp, timezone) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp)).filter(part => ['year', 'month', 'day'].includes(part.type)).map(part => [part.type, Number(part.value)]));
}
function startOfZonedDate(parts, timezone) {
    const guess = Date.UTC(parts.year, parts.month - 1, parts.day);
    return guess - timezoneOffset(guess, timezone);
}
function shiftCalendarDay(parts, days) {
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}
function rangeWindow(range, timezone, now = Date.now()) {
    const today = zonedDateParts(now, timezone), todayStart = startOfZonedDate(today, timezone);
    if (range === 'today') return { start: todayStart, end: now };
    if (range === 'yesterday') return { start: startOfZonedDate(shiftCalendarDay(today, -1), timezone), end: todayStart };
    if (range === 'month') return { start: startOfZonedDate({ year: today.year, month: today.month, day: 1 }, timezone), end: now };
    return { start: now - Number(range || 30) * 86400000, end: now };
}async function request(project, cookie, range) {
    const cfg = vscode.workspace.getConfiguration('huaweiMaaS'), region = cfg.get('region', 'ap-southeast-1'), timezone = cfg.get('timezone', 'Asia/Dubai'), end = Date.now();
    const window = rangeWindow(range, timezone, end);
    const body = { start_time: window.start, end_time: window.end, timezone, service_type: 2, model_type: 'Text Generation', infer_type: 'real_time' };
    const cm = parseCookie(cookie), headers = { 'Content-Type': 'application/json; charset=UTF-8', Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7', 'X-Requested-With': 'XMLHttpRequest', 'X-Language': 'en-us', ProjectName: region, region, 'x-maas-backend': 'maas-manager', Origin: 'https://console-intl.huaweicloud.com', Referer: `https://console-intl.huaweicloud.com/modelarts/?region=${region}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36', 'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin', 'cf2-cftk': '', Cookie: cookie };
    headers.AgencyId = cm.agencyID || cm._w3Fid || cm.user_tag || ''; headers.cftk = cm.cftk || '';
    log('STEP 2', `Project: ${project.slice(0, 6)}…${project.slice(-4)}, region: ${region}, timezone: ${timezone}.`);
    log('STEP 3', `Credentials parsed. Cookie fields: ${Object.keys(cm).length}; AgencyId present: ${Boolean(headers.AgencyId)}; cftk present: ${Boolean(headers.cftk)}. Values are redacted.`);
    log('STEP 4', `Request body: ${JSON.stringify(body)}`);
    const root = `${cfg.get('consoleUrl', 'https://console-intl.huaweicloud.com')}/modelarts/rest/maas/v1/${project}/maas/monitoring`;
    const serviceBody = { ...body, limit: 100, offset: 0, service_names: [] };
    const budgetDay = rangeWindow('today', timezone, end);
    const dailyBody = { ...serviceBody, start_time: budgetDay.start, end_time: budgetDay.end };
    const [a, b, daily] = await Promise.all([
        post('summary', `${root}/show-statistics`, body, headers),
        post('services', `${root}/list-service-statistics`, serviceBody, headers),
        range === 'today' ? Promise.resolve(undefined) : post('daily-budget', `${root}/list-service-statistics`, dailyBody, headers)
    ]);
    const currentServices = services(b);
    const result = { summary: unwrap(a), services: currentServices, budgetServices: daily ? services(daily) : currentServices, updated: new Date().toLocaleString() };    log('STEP 5', `Parsed summary keys: ${objectKeys(result.summary)}; service rows: ${result.services.length}.`);
    return result;
}
async function post(label, url, body, headers) {
    log('HTTP', `POST ${label}: ${url.replace(/\/v1\/[a-f0-9]{32}\//i, '/v1/<project-id>/')}`);
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual' }), text = await r.text();
    log('HTTP', `${label}: status ${r.status}, redirected: ${r.redirected}, response URL: ${r.url.replace(/\/v1\/[a-f0-9]{32}\//i, '/v1/<project-id>/')}, content-type ${r.headers.get('content-type') || 'missing'}, content-length ${r.headers.get('content-length') || 'missing'}, ${text.length} response characters.`);
    log('HEADERS', `${label}: ${JSON.stringify(Object.fromEntries([...r.headers].filter(([key]) => key.toLowerCase() !== 'set-cookie')))}`);
    if (r.headers.get('hw-ajax-redirect')) { const e = new Error(`Huawei rejected the console session (HW-AJAX-REDIRECT). Reload the MaaS Monitoring page, copy the Cookie from a newly successful show-statistics request, and configure it immediately.`); e.status = 401; throw e; }
    if ([301, 302, 303, 307, 308].includes(r.status)) { const e = new Error(`${label} was redirected by Huawei (${r.status}) to ${r.headers.get('location') || 'an unknown URL'}. The console session is not accepted.`); e.status = 401; throw e; }
    if (!text.trim()) throw new Error(`${label} returned an empty HTTP ${r.status} response. Huawei's console gateway rejected the browser-session context; refresh the Cookie from a currently successful monitoring request.`);
    if (/^\s*</.test(text)) { const e = new Error(`${label} returned HTML instead of JSON. The console session is expired or Huawei redirected to sign-in.`); e.status = 401; throw e; }
    let j; try { j = text ? JSON.parse(text) : {}; } catch { throw new Error(`${label} returned invalid JSON: ${text.slice(0, 160)}`); }
    log('RESPONSE', `${label}: ${safeJson(j)}`);
    const businessError = j.error_code || j.errorCode || (j.error_msg && !j.data) || (j.code && !['0', '200', 0, 200].includes(j.code) && !j.data);
    if (!r.ok || businessError) { const e = new Error(j.error_msg || j.errorMessage || j.message || `HTTP ${r.status}`); e.status = r.status; throw e; }
    return j;
}
function log(step, message) { if (output) output.appendLine(`[${new Date().toISOString()}] ${step} | ${message}`); }
function safeJson(value) { const text = JSON.stringify(value); return text.length > 12000 ? `${text.slice(0, 12000)}… [truncated]` : text; }
function objectKeys(value) { return value && typeof value === 'object' ? Object.keys(value).join(', ') || '(none)' : `(type: ${typeof value})`; }
function parseCookie(s) {
    return Object.fromEntries(s.split(';').map(p => {
        const i = p.indexOf('=');
        return [p.slice(0, i < 0 ? undefined : i).trim(), i < 0 ? '' : p.slice(i + 1).trim().replace(/^"|"$/g, '')];
    }).filter(x => x[0]));
}
function unwrap(x) {
    for (const k of ['data', 'result', 'statistics']) if (x && x[k] && typeof x[k] === 'object') x = x[k];
    return x || {};
}
function services(value) {
    const seen = new Set();
    function find(x) {
        if (!x || typeof x !== 'object' || seen.has(x)) return undefined;
        seen.add(x);
        if (Array.isArray(x)) {
            if (x.some(item => item && typeof item === 'object' && ['service_name', 'serviceName', 'model_name', 'modelName', 'name'].some(k => item[k]))) return x;
            for (const item of x) { const found = find(item); if (found) return found; }
            return undefined;
        }
        const preferred = ['items', 'records', 'services', 'service_statistics', 'serviceStatistics', 'list', 'rows'];
        for (const k of preferred) if (Array.isArray(x[k])) { const found = find(x[k]); if (found || x[k].length === 0) return found || x[k]; }
        for (const child of Object.values(x)) { const found = find(child); if (found) return found; }
        return undefined;
    }
    return find(value) || [];
}
function normalizedKey(key) { return String(key).replace(/[^a-z0-9]/gi, '').toLowerCase(); }
function numeric(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
    return undefined;
}
function metric(root, keys) {
    const wanted = new Set(keys.map(normalizedKey));
    const seen = new Set();
    function read(node) {
        if (!node || typeof node !== 'object' || seen.has(node)) return undefined;
        seen.add(node);
        if (!Array.isArray(node)) {
            for (const [key, value] of Object.entries(node)) {
                const number = numeric(value);
                if (wanted.has(normalizedKey(key)) && number !== undefined) return number;
            }
            const label = node.name ?? node.metric ?? node.key ?? node.type ?? node.metric_name;
            if (wanted.has(normalizedKey(label))) {
                for (const key of ['value', 'count', 'total', 'metric_value']) { const number = numeric(node[key]); if (number !== undefined) return number; }
            }
        }
        if (Array.isArray(node)) {
            const values = node.map(read).filter(value => value !== undefined);
            return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
        }
        for (const child of Object.values(node)) {
            if (child && typeof child === 'object') { const found = read(child); if (found !== undefined) return found; }
        }
        return undefined;
    }
    return read(root) ?? 0;
}
function totalTokens(summary) {
    const explicit = metric(summary, METRICS.totalTokens);
    return explicit || metric(summary, METRICS.inputTokens) + metric(summary, METRICS.outputTokens);
}
function sumServiceMetric(rows, keys) { return rows.reduce((sum, row) => sum + metric(row, keys), 0); }
function resolvedMetrics(summary, rows = []) {
    const fromSummary = {
        requests: metric(summary, METRICS.requests),
        totalTokens: totalTokens(summary),
        inputTokens: metric(summary, METRICS.inputTokens),
        outputTokens: metric(summary, METRICS.outputTokens),
        success: metric(summary, METRICS.success),
        failures: metric(summary, METRICS.failures)
    };
    const fromServices = {
        requests: sumServiceMetric(rows, METRICS.requests),
        totalTokens: rows.reduce((sum, row) => sum + totalTokens(row), 0),
        inputTokens: sumServiceMetric(rows, METRICS.inputTokens),
        outputTokens: sumServiceMetric(rows, METRICS.outputTokens),
        success: sumServiceMetric(rows, METRICS.success),
        failures: sumServiceMetric(rows, METRICS.failures)
    };
    const result = {};
    for (const key of Object.keys(fromSummary)) result[key] = fromSummary[key] || fromServices[key];
    if (!result.totalTokens) result.totalTokens = result.inputTokens + result.outputTokens;
    if (!result.success && result.requests >= result.failures) result.success = result.requests - result.failures;
    return { ...result, services: rows.length };
}
function rowMetrics(row) {
    const requests = metric(row, METRICS.requests), failures = metric(row, METRICS.failures);
    const explicitSuccess = metric(row, METRICS.success), success = explicitSuccess || Math.max(0, requests - failures);
    return {
        requests,
        inputTokens: metric(row, METRICS.inputTokens),
        outputTokens: metric(row, METRICS.outputTokens),
        totalTokens: totalTokens(row),
        success,
        failures,
        successRate: requests ? success / requests * 100 : 0,
        errorRate: numeric(row.error_rate) ?? (requests ? failures / requests * 100 : 0),
        avgLatency: metric(row, ['avg_latency', 'average_latency', 'latency_avg']),
        generationType: row.generation_type || row.generationType || '',
        serviceId: row.service_id || row.serviceId || ''
    };
}
function latencyText(milliseconds) {
    if (!milliseconds) return '—';
    return milliseconds >= 1000 ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(milliseconds / 1000)}s` : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(milliseconds)}ms`;
}
function percentText(value) { return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value || 0)}%`; }function serviceName(x) { return x.service_name || x.serviceName || x.model_name || x.modelName || x.name || 'Unknown service'; }
function tokenCount(raw) { return Math.round((raw || 0) * 1000); }
function tokenTitle(raw) { return `Raw API value: ${raw || 0} (thousand tokens)`; }
function compactParts(value) {
    const number = Number(value) || 0, absolute = Math.abs(number);
    const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    const unit = units.find(([divisor]) => absolute >= divisor);
    if (!unit) return { number: new Intl.NumberFormat().format(number), suffix: '' };
    const scaled = number / unit[0], digits = Math.abs(scaled) >= 100 ? 0 : 1;
    return { number: new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(scaled), suffix: unit[1] };
}
function num(value) { const parts = compactParts(value); return `${parts.number}${parts.suffix}`; }
function compactHtml(value) { const parts = compactParts(value); return `${parts.number}${parts.suffix ? `<small class="unit">${parts.suffix}</small>` : ''}`; }
function esc(x) { return String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function statusMarkdown(data, totals) {
    const dailyUsed = (data?.budgetServices || []).reduce((sum, row) => sum + tokenCount(totalTokens(row)), 0);
    const remaining = Math.max(0, dailyTokenLimit - dailyUsed), successRate = totals.requests ? totals.success / totals.requests * 100 : 0;
    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.appendMarkdown(`### Huawei MaaS Cockpit\n\n`);
    markdown.appendMarkdown(`**Range:** ${rangeLabel(selectedRange)}  \n`);
    markdown.appendMarkdown(`**Requests:** ${totals.requests.toLocaleString()}  \n`);
    markdown.appendMarkdown(`**Tokens:** ${tokenCount(totals.totalTokens).toLocaleString()} total · ${tokenCount(totals.inputTokens).toLocaleString()} input · ${tokenCount(totals.outputTokens).toLocaleString()} output  \n`);
    markdown.appendMarkdown(`**Request health:** ${percentText(successRate)} success · ${totals.failures.toLocaleString()} failed  \n`);
    markdown.appendMarkdown(`**Daily budget:** ${dailyUsed.toLocaleString()} used · ${remaining.toLocaleString()} remaining  \n`);
    markdown.appendMarkdown(`**Updated:** ${data?.updated || 'Not yet'}\n\n`);
    markdown.appendMarkdown(`_Click to open the full cockpit_`);
    return markdown;
}
function updateStatusBar(data, totals) {
    const tokens = tokenCount(totals.totalTokens);
    bar.text = `$(pulse) MaaS: ${num(totals.requests)} req · ${num(tokens)} tok`;
    bar.tooltip = statusMarkdown(data, totals);
    bar.accessibilityInformation = { label: `Huawei MaaS Cockpit, ${totals.requests} requests and ${tokens} tokens for ${rangeLabel(selectedRange)}` };
}function graphPercent(value, total) { return total > 0 ? Math.min(100, Math.max(0, value / total * 100)) : 0; }
function graphsHtml(totals, budgetServices) {
    const dailyUsed = budgetServices.reduce((sum, row) => sum + tokenCount(totalTokens(row)), 0);
    const remaining = Math.max(0, dailyTokenLimit - dailyUsed), budgetPercent = graphPercent(dailyUsed, dailyTokenLimit);
    const requestTotal = totals.success + totals.failures, successPercent = graphPercent(totals.success, requestTotal);
    const input = tokenCount(totals.inputTokens), output = tokenCount(totals.outputTokens), tokenTotal = input + output, inputPercent = graphPercent(input, tokenTotal);
    return `<section class="graphs">
        <article class="chart"><h3>Daily token budget</h3><div class="donut budget" style="--percent:${budgetPercent}" title="${dailyUsed.toLocaleString()} of ${dailyTokenLimit.toLocaleString()} tokens used"><div><strong>${compactHtml(dailyUsed)}</strong><small>used</small></div></div><div class="chart-legend"><span>${percentText(budgetPercent)} used</span><span>${compactHtml(remaining)} left</span></div></article>
        <article class="chart"><h3>Request health</h3><div class="donut health" style="--percent:${successPercent}" title="${totals.success} successful, ${totals.failures} failed"><div><strong>${percentText(successPercent)}</strong><small>successful</small></div></div><div class="chart-legend"><span class="good">● ${compactHtml(totals.success)} success</span><span class="bad">● ${compactHtml(totals.failures)} failed</span></div></article>
        <article class="chart"><h3>Token mix</h3><div class="token-total" title="${tokenTotal.toLocaleString()} total tokens"><strong>${compactHtml(tokenTotal)}</strong><small>total tokens</small></div><div class="stack" title="Input ${input.toLocaleString()}, output ${output.toLocaleString()}"><span class="input" style="width:${inputPercent}%"></span><span class="output" style="width:${100 - inputPercent}%"></span></div><div class="chart-legend"><span class="input-text">● ${compactHtml(input)} input</span><span class="output-text">● ${compactHtml(output)} output</span></div></article>
    </section>`;
}function view(state = {}) { const ready = last || state.loading || state.error, totals = resolvedMetrics(last?.summary || {}, last?.services || []), cards = [['Requests', totals.requests, false], ['Total Tokens Used', totals.totalTokens, true], ['Input Tokens', totals.inputTokens, true], ['Output Tokens', totals.outputTokens, true], ['Success', totals.success, false], ['Failures', totals.failures, false]], rows = (last?.services || []).map(x => { const values = rowMetrics(x); return `<tr><td title="${esc(values.serviceId ? `Service ID: ${values.serviceId}` : '')}"><strong>${esc(serviceName(x))}</strong>${values.generationType ? `<small class="service-type">${esc(values.generationType)}</small>` : ''}</td><td>${compactHtml(values.requests)}</td><td title="${esc(tokenTitle(values.inputTokens))}">${compactHtml(tokenCount(values.inputTokens))}</td><td title="${esc(tokenTitle(values.outputTokens))}">${compactHtml(tokenCount(values.outputTokens))}</td><td title="${esc(tokenTitle(values.totalTokens))}">${compactHtml(tokenCount(values.totalTokens))}</td><td title="${values.success} successful, ${values.failures} failed">${percentText(values.successRate)}</td><td>${compactHtml(values.failures)}</td><td title="Raw API value: ${values.avgLatency} ms">${latencyText(values.avgLatency)}</td></tr>`; }).join(''); let body = !ready ? `<main><h2>Connect Huawei Cloud</h2><p>Configure your project ID and authenticated console cookie to begin.</p><button onclick="send('configure')">Configure credentials</button></main>` : state.error ? `<main><h2>Couldn’t load statistics</h2><p>${esc(state.error)}</p><button onclick="send('configure')">Update credentials</button></main>` : `<section class="cards">${cards.map(([n, value, isToken]) => `<article title="${isToken ? esc(tokenTitle(value)) : ''}"><span>${n}</span><b>${state.loading ? '—' : compactHtml(isToken ? tokenCount(value) : value)}</b></article>`).join('')}</section>${graphsHtml(totals, last?.budgetServices || [])}<section class="panel"><h2>Services</h2>${rows ? `<table><tr><th>Service</th><th>Requests</th><th>Input</th><th>Output</th><th>Total</th><th>Success</th><th>Errors</th><th>Avg latency</th></tr>${rows}</table>` : `<p>No per-service activity in this period.</p>`}</section>`; return `<!doctype html><html><head><meta charset="UTF-8"><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);max-width:1150px;margin:auto;padding:28px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}.brand{display:flex;gap:14px;align-items:center}.logo{display:block;width:48px;height:48px;border-radius:11px}h1{font-size:22px;margin:0}.tagline{margin:4px 0 3px;font-size:12px;color:var(--vscode-descriptionForeground)}a{color:var(--vscode-textLink-foreground);text-decoration:none}a:hover{text-decoration:underline}small,p{color:var(--vscode-descriptionForeground)}button,select{padding:8px 12px;border:0;border-radius:6px;margin-left:6px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button,select{background:rgb(73,130,255);color:#fff;cursor:pointer;outline-color:rgb(73,130,255)}button:hover,button:focus,select:hover,select:focus{background:rgb(58,112,235)}select option{background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.cards article,.panel{background:var(--vscode-sideBar-background);border:1px solid var(--vscode-widget-border);border-radius:10px;padding:18px}.cards span{display:block;color:var(--vscode-descriptionForeground);font-size:12px;margin-bottom:9px}.cards b{font-size:25px}.unit{font-size:.58em;vertical-align:.35em;margin-left:2px;font-weight:600;color:var(--vscode-descriptionForeground)}.graphs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:16px}.chart{background:var(--vscode-sideBar-background);border:1px solid var(--vscode-widget-border);border-radius:10px;padding:18px;min-height:245px}.chart h3{font-size:13px;margin:0 0 16px}.donut{--percent:0;width:132px;aspect-ratio:1;border-radius:50%;margin:4px auto 17px;display:grid;place-items:center;background:conic-gradient(var(--accent) calc(var(--percent)*1%),var(--vscode-widget-border) 0);position:relative}.donut:before{content:"";position:absolute;inset:13px;border-radius:50%;background:var(--vscode-sideBar-background)}.donut>div{position:relative;text-align:center}.donut strong,.token-total strong{display:block;font-size:22px}.donut small,.token-total small{display:block;margin-top:3px;font-size:10px}.budget{--accent:#3b82f6}.health{--accent:#2ea043}.chart-legend{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--vscode-descriptionForeground)}.good{color:#3fb950}.bad{color:#f85149}.token-total{text-align:center;margin:32px 0 27px}.stack{display:flex;height:14px;border-radius:8px;overflow:hidden;background:var(--vscode-widget-border);margin-bottom:20px}.stack span{display:block;min-width:0}.stack .input{background:#3b82f6}.stack .output{background:#a855f7}.input-text{color:#60a5fa}.output-text{color:#c084fc}.panel{margin-top:16px;overflow-x:auto}.service-type{display:block;margin-top:4px;font-size:11px;font-weight:400;color:var(--vscode-descriptionForeground);white-space:nowrap}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid var(--vscode-widget-border);text-align:right}th:first-child,td:first-child{text-align:left}main{text-align:center;padding:80px 20px}main button{margin-top:10px}.footer{text-align:center;margin:28px 0 4px;padding-top:18px;border-top:1px solid var(--vscode-widget-border);font-size:11px;color:var(--vscode-descriptionForeground)}@media(max-width:800px){.graphs{grid-template-columns:1fr}}@media(max-width:600px){header{display:block}.actions{margin-top:14px}}</style></head><body><header><div class="brand"><img class="logo" src="${esc(logoUri || '')}" alt="Huawei MaaS"><div><h1>Huawei MaaS Cockpit</h1><p class="tagline">A one-stop cockpit for your Huawei Cloud <a href="https://www.huaweicloud.com/intl/en-us/product/maas.html" title="Open Huawei Cloud MaaS">MaaS</a> usage and statistics.</p><small>${last ? 'Updated ' + esc(last.updated) : 'ModelArts usage at a glance'}</small></div></div><div class="actions"><select id="days" onchange="send('refresh',this.value)" aria-label="Statistics date range"><option value="today"${selectedRange === 'today' ? ' selected' : ''}>Today</option><option value="yesterday"${selectedRange === 'yesterday' ? ' selected' : ''}>Yesterday</option><option value="1"${selectedRange === '1' ? ' selected' : ''}>24 hours</option><option value="7"${selectedRange === '7' ? ' selected' : ''}>7 days</option><option value="30"${selectedRange === '30' ? ' selected' : ''}>30 days</option><option value="month"${selectedRange === 'month' ? ' selected' : ''}>This month</option></select><button onclick="send('configure')">Settings</button><button onclick="send('refresh',days.value)">↻ Refresh</button></div></header>${body}<footer class="footer">Developed with &lt;3 by Fawad Iqbal <a href="mailto:fawad.iqbal@huawei.com" title="Email Fawad Iqbal">f00928374</a></footer><script>const vscode=acquireVsCodeApi();function send(command,days){vscode.postMessage({command,days})}</script></body></html>` }
function deactivate() { } module.exports = { activate, deactivate, parseCookie, unwrap, services, metric, totalTokens, serviceName, view, METRICS, resolvedMetrics, rowMetrics, rangeWindow, rangeLabel, tokenCount, tokenTitle, compactParts, compactHtml, latencyText, percentText, parseTokenLimit, graphPercent, graphsHtml, statusMarkdown };

























