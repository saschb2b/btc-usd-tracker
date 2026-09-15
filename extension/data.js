// Pure data validation and formatting: usable in GJS without GNOME Shell.
export const BUS_NAME = 'io.github.saschb2b.BtcUsdTracker.Popover';
export const RANGES = {
    '1h': {seconds: 3600, interval: 1, label: '1 hour ago'},
    '24h': {seconds: 86400, interval: 15, label: '24 hours ago'},
    '7d': {seconds: 604800, interval: 60, label: '7 days ago'},
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

export function chartCoordinates(points, width, height, padding = 8) {
    if (points.length < 2 || width <= 2 * padding || height <= 2 * padding)
        return [];
    const values = points.map(point => point.value);
    const low = Math.min(...values), high = Math.max(...values);
    const span = high - low || Math.max(high * 0.001, 1);
    const first = points[0].time, last = points.at(-1).time;
    if (last <= first)
        return [];
    return points.map(point => ({
        x: padding + (point.time - first) / (last - first) * (width - 2 * padding),
        y: padding + (high - point.value + span * 0.1) / (span * 1.2) * (height - 2 * padding),
    }));
}
