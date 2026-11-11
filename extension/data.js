// Pure data validation and formatting: usable in GJS without GNOME Shell.
export const BUS_NAME = 'io.github.saschb2b.BtcUsdTracker.Popover';
export const RANGES = {
    '1h': {seconds: 3600, interval: 1, title: 'Past hour'},
    '24h': {seconds: 86400, interval: 15, title: 'Past 24 hours'},
    '7d': {seconds: 604800, interval: 60, title: 'Past 7 days'},
};

export function number(value, minimum = 0) {
    if (typeof value !== 'number' && typeof value !== 'string')
        throw new Error('Missing numeric value');
    if (typeof value === 'string' && value.trim() === '')
        throw new Error('Empty numeric value');
    const result = Number(value);
    if (!Number.isFinite(result) || result < minimum)
        throw new Error('Invalid numeric value');
    return result;
}

function kraken(payload) {
    if (!Array.isArray(payload?.error) || payload.error.length)
        throw new Error('Kraken returned an error');
    const result = payload.result?.XXBTZUSD;
    if (!result)
        throw new Error('BTC/USD data missing');
    return result;
}

export function parseTicker(payload) {
    const value = kraken(payload);
    return {
        price: number(value.c?.[0], Number.MIN_VALUE),
        volume: number(value.v?.[1]),
        low: number(value.l?.[1], Number.MIN_VALUE),
        high: number(value.h?.[1], Number.MIN_VALUE),
        source: 'Kraken',
    };
}

export function parseCoinbase(payload) {
    if (payload?.data?.base !== 'BTC' || payload.data.currency !== 'USD')
        throw new Error('Unexpected Coinbase currency pair');
    return {price: number(payload.data.amount, Number.MIN_VALUE), source: 'Coinbase'};
}

export function parseHistory(payload, since, now, intervalSeconds) {
    const rows = kraken(payload);
    if (!Array.isArray(rows))
        throw new Error('History is not an array');
    const candles = rows.map(row => {
        if (!Array.isArray(row) || row.length < 8)
            throw new Error('Incomplete candle');
        const candle = {
            time: number(row[0], 1), open: number(row[1], Number.MIN_VALUE),
            high: number(row[2], Number.MIN_VALUE), low: number(row[3], Number.MIN_VALUE),
            value: number(row[4], Number.MIN_VALUE),
        };
        if (candle.low > Math.min(candle.open, candle.value) ||
            candle.high < Math.max(candle.open, candle.value))
            throw new Error('Invalid candle bounds');
        return candle;
    }).filter(row => row.time >= since - intervalSeconds && row.time <= now);
    candles.sort((a, b) => a.time - b.time);
    const unique = [...new Map(candles.map(candle => [candle.time, candle])).values()];
    if (unique.length < 2)
        throw new Error('Not enough price history');
    return {
        points: unique,
        low: Math.min(...unique.map(row => row.low)),
        high: Math.max(...unique.map(row => row.high)),
        change: (unique.at(-1).value / unique[0].open - 1) * 100,
    };
}

export function parseNetwork(fees, queue, mempool, blocks) {
    if (!Array.isArray(queue) || !Array.isArray(blocks) || !blocks.length)
        throw new Error('Network data missing');
    return {
        fees: [fees.fastestFee, fees.halfHourFee, fees.hourFee].map(value => number(value)),
        queue: queue.slice(0, 5).map(block => ({
            fee: number(block.medianFee), transactions: number(block.nTx),
        })),
        count: number(mempool.count),
        vsize: number(mempool.vsize),
        height: number(blocks[0].height, 1),
        blockTime: number(blocks[0].timestamp, 1),
    };
}

export function priceLabel(value, decimals = 0) {
    return '$' + value.toLocaleString('en-US', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    });
}

export function stale(slot, now = Date.now() / 1000) {
    return !slot?.updated || Boolean(slot.error) || now - slot.updated > 150;
}

export function chartCoordinates(points, width, height, padding = 8, inset = padding) {
    if (points.length < 2 || width <= 2 * inset || height <= 2 * padding)
        return [];
    const values = points.map(point => point.value);
    const low = Math.min(...values), high = Math.max(...values);
    const span = high - low || Math.max(high * 0.001, 1);
    const first = points[0].time, last = points.at(-1).time;
    if (last <= first)
        return [];
    return points.map(point => ({
        x: inset + (point.time - first) / (last - first) * (width - 2 * inset),
        y: padding + (high - point.value + span * 0.1) / (span * 1.2) * (height - 2 * padding),
    }));
}

// Vertical positions of the plotted high and low, matching chartCoordinates().
export function chartBounds(height, padding = 8) {
    const inner = height - 2 * padding;
    return {high: padding + inner * 0.1 / 1.2, low: padding + inner * 1.1 / 1.2};
}

export function changeLabel(change) {
    const rounded = Number(change.toFixed(2));
    return `${rounded > 0 ? '▲' : rounded < 0 ? '▼' : '•'} ${Math.abs(rounded).toFixed(2)}%`;
}

// Where a price sits between a period's low and high, clamped to 0…1.
export function rangePosition(price, low, high) {
    if (!(high > low) || !Number.isFinite(price))
        return 0.5;
    return Math.max(0, Math.min(1, (price - low) / (high - low)));
}

const TIME = {hour: '2-digit', minute: '2-digit'};
const FORMATS = {
    '1h': [TIME, TIME],
    '24h': [{weekday: 'short', ...TIME}, {weekday: 'short', ...TIME}],
    '7d': [{month: 'short', day: 'numeric'}, {month: 'short', day: 'numeric', ...TIME}],
};

// Axis labels are short; `detailed` is for the value under the pointer.
export function timeLabel(timestamp, range, detailed = false, locale = []) {
    const format = FORMATS[range] ?? FORMATS['24h'];
    return new Date(timestamp * 1000).toLocaleString(locale, format[detailed ? 1 : 0]);
}

export function nearestPoint(points, fraction) {
    if (!points.length)
        return null;
    const time = points[0].time + fraction * (points.at(-1).time - points[0].time);
    return points.reduce((nearest, candidate) =>
        Math.abs(candidate.time - time) < Math.abs(nearest.time - time) ? candidate : nearest);
}

// Sub-10 fee rates keep two decimals so a quiet mempool does not read as zero.
export function feeLabel(value) {
    return value.toLocaleString('en-US', {maximumFractionDigits: value < 10 ? 2 : value < 100 ? 1 : 0});
}
