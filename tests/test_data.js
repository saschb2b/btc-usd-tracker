import {
    number, parseTicker, parseCoinbase, parseHistory, parseNetwork,
    chartCoordinates, stale, priceLabel,
} from '../extension/data.js';

let passed = 0;
function check(condition, description) {
    if (!condition)
        throw new Error(description);
    passed++;
}
function rejects(fn, description) {
    let threw = false;
    try { fn(); } catch { threw = true; }
    check(threw, description);
}

for (const value of [null, undefined, true, false, '', ' ', 'NaN', Infinity, -1])
    rejects(() => number(value), `reject invalid number ${value}`);
check(number(0) === 0, 'zero fees are valid');
const ticker = {error: [], result: {XXBTZUSD: {c: ['76000'], v: ['100', '250'], l: ['74000', '73000'], h: ['77000', '78000']}}};
const quote = parseTicker(ticker);
check(quote.price === 76000 && quote.volume === 250 && quote.low === 73000 && quote.high === 78000, 'use rolling 24h ticker fields');
rejects(() => parseTicker({error: ['limit exceeded']}), 'reject exchange error');
rejects(() => parseTicker({error: [], result: {ETHUSD: ticker.result.XXBTZUSD}}), 'reject unexpected asset');
rejects(() => parseCoinbase({data: {base: 'BTC', currency: 'EUR', amount: '70000'}}), 'reject wrong quote currency');
check(parseCoinbase({data: {base: 'BTC', currency: 'USD', amount: '76000'}}).price === 76000, 'Coinbase price fallback');

const row = (time, open, close) => [time, String(open), String(Math.max(open, close) + 1), String(Math.min(open, close) - 1), String(close), '1', '2', 3];
const historyPayload = {error: [], result: {XXBTZUSD: [row(1000, 100, 101), row(1060, 101, 105), row(1120, 105, 110)]}};
const history = parseHistory(historyPayload, 1000, 1121, 60);
check(Math.abs(history.change - 10) < 1e-8, 'change uses first open and final close');
check(history.low === 99 && history.high === 111, 'high and low use candle extremes');
check(history.points.length === 3, 'current partial candle is included');
rejects(() => parseHistory(historyPayload, 1120, 1121, 1), 'reject insufficient history');
const unordered = {error: [], result: {XXBTZUSD: [historyPayload.result.XXBTZUSD[2], historyPayload.result.XXBTZUSD[0], historyPayload.result.XXBTZUSD[0], historyPayload.result.XXBTZUSD[1]]}};
check(parseHistory(unordered, 1000, 1121, 60).points.length === 3, 'sort and deduplicate candles');
const invalid = {error: [], result: {XXBTZUSD: [row(1000, 100, 101), [1060, '101', '90', '80', '105', '1', '2', 3]]}};
rejects(() => parseHistory(invalid, 1000, 1121, 60), 'reject impossible candle bounds');

const network = parseNetwork({fastestFee: 0, halfHourFee: 1, hourFee: 2}, [], {count: 0, vsize: 0}, [{height: 900000, timestamp: 1000}]);
check(network.fees[0] === 0 && network.queue.length === 0 && network.count === 0, 'empty mempool is legitimate data');
rejects(() => parseNetwork({}, [], {count: 1}, []), 'reject missing network data');
rejects(() => parseNetwork({fastestFee: 1, halfHourFee: -1, hourFee: 2}, [], {count: 0, vsize: 0}, [{height: 1, timestamp: 1}]), 'reject negative fees');
const coordinates = chartCoordinates(history.points, 300, 135);
check(coordinates.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 8 && point.x <= 292 && point.y >= 8 && point.y <= 127), 'chart stays within bounds');
check(chartCoordinates([{time: 1, value: 100}, {time: 2, value: 100}], 300, 135).every(point => Number.isFinite(point.y)), 'flat market has finite coordinates');
check(chartCoordinates(history.points, 0, 0).length === 0, 'unallocated chart is empty');
check(stale({updated: 1000}, 1151), 'old data is stale after suspend');
check(stale({updated: 1000, error: 'offline'}, 1010), 'failed refresh marks previous data stale');
check(!stale({updated: 1000}, 1010), 'fresh data is not stale');
check(priceLabel(76920.07) === '$76,920', 'panel price formatting');
print(`${passed} data checks passed`);
