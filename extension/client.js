import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {RANGES, parseTicker, parseCoinbase, parseHistory, parseNetwork} from './data.js';

export class Client {
    constructor() {
        this.session = new Soup.Session({timeout: 12, user_agent: 'BTC-USD-Tracker/1.1'});
        this.cancellable = new Gio.Cancellable();
    }

    json(url) {
        return new Promise((resolve, reject) => {
            if (this.cancellable.is_cancelled()) {
                reject(new Error('Tracker disabled'));
                return;
            }
            const message = Soup.Message.new('GET', url);
            this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this.cancellable,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        if (message.status_code !== 200)
                            throw new Error(`HTTP ${message.status_code}`);
                        if (bytes.get_size() > 2 * 1024 * 1024)
                            throw new Error('Response too large');
                        resolve(JSON.parse(new TextDecoder().decode(bytes.toArray())));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    }

    async quote() {
        try {
            return parseTicker(await this.json('https://api.kraken.com/0/public/Ticker?pair=XBTUSD'));
        } catch (error) {
            if (this.cancellable.is_cancelled())
                throw error;
            return parseCoinbase(await this.json('https://api.coinbase.com/v2/prices/BTC-USD/spot'));
        }
    }

    async history(range) {
        const settings = RANGES[range];
        const now = Math.floor(Date.now() / 1000);
        const since = now - settings.seconds;
        const data = await this.json(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${settings.interval}&since=${since}`);
        return parseHistory(data, since, now, settings.interval * 60);
    }

    async network() {
        const base = 'https://mempool.space/api';
        const data = await Promise.all([
            this.json(`${base}/v1/fees/recommended`),
            this.json(`${base}/v1/fees/mempool-blocks`),
            this.json(`${base}/mempool`),
            this.json(`${base}/blocks`),
        ]);
        return parseNetwork(...data);
    }

    destroy() {
        this.cancellable.cancel();
        this.session.abort();
    }
}
