const assert = require('assert');
const { parseCookie, unwrap, services, metric, totalTokens, serviceName, view, METRICS, resolvedMetrics, rowMetrics, rangeWindow, rangeLabel, tokenCount, tokenTitle, compactParts, compactHtml, latencyText, percentText, parseTokenLimit, graphPercent, graphsHtml, statusMarkdown } = require('../extension');

suite('Huawei MaaS Cockpit', () => {
    test('parses cookies containing equals', () => assert.deepStrictEqual(parseCookie('agencyID=a; token=x=y'), { agencyID: 'a', token: 'x=y' }));
    test('unwraps API envelopes', () => assert.deepStrictEqual(unwrap({ data: { result: { total_calls: 2 } } }), { total_calls: 2 }));
    test('extracts deeply nested service records', () => assert.strictEqual(services({ data: { page: { records: [{ serviceName: 'demo' }] } } }).length, 1));
    test('reads flat aliases', () => assert.strictEqual(metric({ total_access_count: '42' }, METRICS.requests), 42));
    test('reads nested metrics', () => assert.strictEqual(metric({ data: { overview: { invoke_count: 7 } } }, METRICS.requests), 7));
    test('sums time-series metric arrays', () => assert.strictEqual(metric({ points: [{ request_count: 2 }, { request_count: 3 }] }, METRICS.requests), 5));
    test('reads name/value metric records', () => assert.strictEqual(metric({ values: [{ metric_name: 'failed_count', value: 4 }] }, METRICS.failures), 4));
    test('derives total tokens when absent', () => assert.strictEqual(totalTokens({ input_token_count: 10, output_token_count: 5 }), 15));
    test('supports camelCase service names', () => assert.strictEqual(serviceName({ serviceName: 'MaaS demo' }), 'MaaS demo'));
    test('aggregates summary cards from service rows', () => {
        const result = resolvedMetrics({}, [{ request_count: 2, input_token: 10, output_token: 5, failed_count: 0 }]);
        assert.deepStrictEqual(result, { requests: 2, totalTokens: 15, inputTokens: 10, outputTokens: 5, success: 2, failures: 0, services: 1 });
    });
    test('derives successful service requests', () => {
        const result = rowMetrics({ request_count: 3, error_count: 1 });
        assert.strictEqual(result.success, 2);
        assert.strictEqual(result.failures, 1);
        assert.strictEqual(result.successRate, 2 / 3 * 100);
    });
    test('maps Huawei service details into useful metrics', () => {
        const result = rowMetrics({ service_id: 'abc', service_name: 'GLM-5.1', generation_type: 'Text Generation', request_count: 2, error_count: 0, error_rate: 0, total_token: 0.112, prompt_token: 0.026, completion_token: 0.086, avg_latency: 3780.5 });
        assert.deepStrictEqual({ input: tokenCount(result.inputTokens), output: tokenCount(result.outputTokens), total: tokenCount(result.totalTokens), successRate: result.successRate, latency: latencyText(result.avgLatency), type: result.generationType }, { input: 26, output: 86, total: 112, successRate: 100, latency: '3.78s', type: 'Text Generation' });
        assert.strictEqual(percentText(result.successRate), '100%');
    });
    test('builds fixed rolling ranges', () => assert.strictEqual(rangeWindow('7', 'Asia/Dubai', 1000000000).start, 1000000000 - 7 * 86400000));
    test('starts This month at midnight in configured timezone', () => {
        const end = Date.parse('2026-07-15T12:00:00Z');
        assert.strictEqual(rangeWindow('month', 'Asia/Dubai', end).start, Date.parse('2026-06-30T20:00:00Z'));
        assert.strictEqual(rangeLabel('month'), 'This month');
    });
    test('builds Today and Yesterday in the configured timezone', () => {
        const now = Date.parse('2026-07-01T08:00:00Z');
        assert.deepStrictEqual(rangeWindow('today', 'Asia/Dubai', now), { start: Date.parse('2026-06-30T20:00:00Z'), end: now });
        assert.deepStrictEqual(rangeWindow('yesterday', 'Asia/Dubai', now), { start: Date.parse('2026-06-29T20:00:00Z'), end: Date.parse('2026-06-30T20:00:00Z') });
    });
    test('converts Huawei thousand-token values and keeps raw tooltip', () => {
        assert.strictEqual(tokenCount(0.321), 321);
        assert.strictEqual(tokenCount(0.078), 78);
        assert.ok(tokenTitle(0.321).includes('0.321'));
    });    test('formats thousands with a compact small suffix', () => {
        assert.deepStrictEqual(compactParts(113444), { number: '113', suffix: 'K' });
        assert.deepStrictEqual(compactParts(1000), { number: '1', suffix: 'K' });
        assert.ok(compactHtml(113444).includes('<small class="unit">K</small>'));
    });    test('renders cockpit without unsupported 90-day option', () => {
        const html = view();
        assert.ok(html.includes('This month'));
        assert.ok(!html.includes('90 days'));
    });
    test('parses friendly daily token budgets', () => {
        assert.strictEqual(parseTokenLimit('100M'), 100000000);
        assert.strictEqual(parseTokenLimit('1.5B'), 1500000000);
        assert.strictEqual(parseTokenLimit('bad'), 0);
    });
    test('renders budget, request health, and token mix graphs', () => {
        assert.strictEqual(graphPercent(25, 100), 25);
        const html = graphsHtml({ success: 9, failures: 1, inputTokens: 0.078, outputTokens: 0.243 }, [{ total_token: 0.321 }]);
        assert.ok(html.includes('Daily token budget'));
        assert.ok(html.includes('Request health'));
        assert.ok(html.includes('Token mix'));
        assert.ok(html.includes('321'));
    });
    test('builds a useful status-bar hover summary', () => {
        const tooltip = statusMarkdown({ updated: 'now', budgetServices: [{ total_token: 0.5 }] }, { requests: 4, totalTokens: 0.321, inputTokens: 0.078, outputTokens: 0.243, success: 3, failures: 1 });
        assert.ok(tooltip.value.includes('Huawei MaaS Cockpit'));
        assert.ok(tooltip.value.includes('321 total'));
        assert.ok(tooltip.value.includes('75% success'));
        assert.ok(tooltip.value.includes('Daily budget'));
    });
    test('defaults the cockpit to Today and renders attribution links', () => {
        const html = view();
        assert.ok(html.includes('value="today" selected'));
        assert.ok(html.includes('https://www.huaweicloud.com/intl/en-us/product/maas.html'));
        assert.ok(html.includes('mailto:fawad.iqbal@huawei.com'));
        assert.ok(html.includes('Developed with &lt;3 by Fawad Iqbal'));
    });
    test('uses MaaS blue and auto-refreshes when the range changes', () => {
        const html = view();
        assert.ok(html.includes('button,select{background:rgb(73,130,255)'));
        assert.ok(html.includes('onchange="send(\'refresh\',this.value)"'));
    });
    test('renders cockpit', () => assert.ok(view().includes('Huawei MaaS Cockpit')));
});











