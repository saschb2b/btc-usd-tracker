import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Client} from './client.js';
import {BUS_NAME, RANGES, priceLabel, stale, chartCoordinates} from './data.js';

function box(vertical = false, style = '') {
    return new St.BoxLayout({
        orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
        x_expand: true, style_class: style,
    });
}

function label(text, style = '', expand = false) {
    return new St.Label({text, style_class: style, x_expand: expand, y_align: Clutter.ActorAlign.CENTER});
}

function button(text, action, style = 'btc-control') {
    const widget = new St.Button({label: text, style_class: style, can_focus: true, x_expand: true});
    widget.connect('clicked', action);
    return widget;
}

function metric(parent, title) {
    const column = box(true, 'btc-metric');
    const heading = label(title, 'btc-muted');
    const value = label('—', 'btc-metric-value');
    column.add_child(heading);
    column.add_child(value);
    parent.add_child(column);
    return {heading, value};
}

function timeText(timestamp) {
    return new Date(timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

export default class BtcTrackerExtension extends Extension {
    enable() {
        try {
            this._enable();
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _enable() {
        this._generation = Symbol();
        this._alive = true;
        this._range = '24h';
        this._tab = 'market';
        this._slots = {};
        this._pending = new Set();
        this._client = new Client();
        this._build();
        Main.panel.addToStatusArea(this.uuid, this._button, 0, 'right');
        this._button.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._update();
                this._refreshVisible();
            }
        });
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._refreshQuote();
            this._update();
            if (this._button.menu.isOpen)
                this._refreshVisible(true);
            return GLib.SOURCE_CONTINUE;
        });
        // Acquire only after the complete UI and refresh loop exist. The standalone
        // indicator stays visible if construction or enable() fails before this point.
        this._name = Gio.bus_own_name(Gio.BusType.SESSION, BUS_NAME,
            Gio.BusNameOwnerFlags.NONE, null, null, null);
        this._refreshQuote();
    }

    _build() {
        this._button = new PanelMenu.Button(0.0, 'Bitcoin price and network', false);
        const panel = box(false, 'btc-panel');
        const icon = new St.Icon({
            gicon: new Gio.FileIcon({file: this.dir.get_child('bitcoin-symbolic.svg')}),
            style_class: 'system-status-icon',
        });
        this._panelLabel = label('BTC …');
        panel.add_child(icon);
        panel.add_child(this._panelLabel);
        this._button.add_child(panel);

        const section = new PopupMenu.PopupMenuSection();
        this._content = box(true, 'btc-content');
        section.actor.add_child(this._content);
        this._button.menu.addMenuItem(section);
        const heading = box(false, 'btc-heading');
        heading.add_child(label('Bitcoin', 'btc-title', true));
        this._quoteSource = label('BTC / USD', 'btc-muted');
        heading.add_child(this._quoteSource);
        this._content.add_child(heading);

        const tabs = box(false, 'btc-tabs');
        this._marketTab = button('Market', () => this._selectTab('market'));
        this._networkTab = button('Network', () => this._selectTab('network'));
        tabs.add_child(this._marketTab);
        tabs.add_child(this._networkTab);
        this._content.add_child(tabs);
        this._market = box(true, 'btc-page');
        this._network = box(true, 'btc-page');
        this._content.add_child(this._market);
        this._content.add_child(this._network);
        this._buildMarket();
        this._buildNetwork();
        this._footer = label('Connecting…', 'btc-muted btc-footer');
        this._content.add_child(this._footer);
        this._marketTab.add_style_pseudo_class('checked');
        this._network.hide();

        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._button.menu.addAction('Refresh now', () => {
            this._refreshQuote();
            this._refreshVisible(true);
        });
        this._fallbackAction = this._button.menu.addAction('Simple indicator not running', () => {
            // If the fallback is installed, it observes the name disappearing and
            // becomes visible immediately. This is the same as disabling via Extensions.
            Main.extensionManager.disableExtension(this.uuid);
        });
        this._fallbackAction.setSensitive(false);
        this._fallbackWatch = Gio.bus_watch_name(Gio.BusType.SESSION,
            'io.github.saschb2b.BtcUsdTracker.Fallback', Gio.BusNameWatcherFlags.NONE,
            () => {
                this._fallbackAction.label.text = 'Use simple indicator';
                this._fallbackAction.setSensitive(true);
            }, () => {
                this._fallbackAction.label.text = 'Simple indicator not running';
                this._fallbackAction.setSensitive(false);
            });
    }

    _buildMarket() {
        this._price = label('Loading price…', 'btc-price');
        this._change = label('Select a range to view price history', 'btc-muted');
        this._market.add_child(this._price);
        this._market.add_child(this._change);

        const chartRow = box(false, 'btc-chart-row');
        this._chart = new St.DrawingArea({
            style_class: 'btc-chart', x_expand: true, reactive: true,
            accessible_name: 'Bitcoin price history',
        });
        this._chart.connect('repaint', () => this._paintChart());
        this._chart.connect('motion-event', (_actor, event) => {
            const [stageX, stageY] = event.get_coords();
            const [ok, x] = this._chart.transform_stage_point(stageX, stageY);
            const points = this._slots[this._range]?.data?.points;
            if (ok && points?.length) {
                const fraction = Math.max(0, Math.min(1, (x - 8) / Math.max(1, this._chart.width - 16)));
                const time = points[0].time + fraction * (points.at(-1).time - points[0].time);
                const point = points.reduce((nearest, candidate) =>
                    Math.abs(candidate.time - time) < Math.abs(nearest.time - time) ? candidate : nearest);
                this._inspect.text = `${new Date(point.time * 1000).toLocaleString()} · ${priceLabel(point.value, 2)}`;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        chartRow.add_child(this._chart);
        const axis = box(true, 'btc-axis');
        axis.x_expand = false;
        this._chartHigh = label('—', 'btc-muted');
        this._chartLow = label('—', 'btc-muted');
        axis.add_child(this._chartHigh);
        axis.add_child(new St.Widget({y_expand: true}));
        axis.add_child(this._chartLow);
        chartRow.add_child(axis);
        this._market.add_child(chartRow);
        const timeline = box(false);
        this._from = label(RANGES[this._range].label, 'btc-muted', true);
        timeline.add_child(this._from);
        timeline.add_child(label('Latest candle', 'btc-muted'));
        this._market.add_child(timeline);
        this._inspect = label('Loading history…', 'btc-muted btc-inspect');
        this._market.add_child(this._inspect);
        const intervals = box(false, 'btc-ranges');
        this._rangeButtons = {};
        for (const range of Object.keys(RANGES)) {
            const control = button(range.toUpperCase(), () => {
                this._range = range;
                this._update();
                this._load(range, () => this._client.history(range));
            });
            this._rangeButtons[range] = control;
            intervals.add_child(control);
        }
        this._market.add_child(intervals);
        const bounds = box(false, 'btc-stats');
        this._low = metric(bounds, '24h low');
        this._high = metric(bounds, '24h high');
        this._market.add_child(bounds);
        const details = box(false, 'btc-stats');
        this._volume = metric(details, '24h volume · Kraken');
        this._sats = metric(details, 'Satoshis per dollar');
        this._market.add_child(details);
    }

    _buildNetwork() {
        this._network.add_child(label('Transaction fees', 'btc-title'));
        this._network.add_child(label('Estimated rates · confirmation times vary', 'btc-muted'));
        const fees = box(false, 'btc-fees');
        this._fees = ['Next block', '~30 minutes', '~60 minutes'].map(title => {
            const value = metric(fees, title);
            value.value.text = '— sat/vB';
            return value;
        });
        this._network.add_child(fees);
        this._network.add_child(label('Pending block queue', 'btc-title'));
        this._network.add_child(label('Projected median fee rate · sat/vB', 'btc-muted'));
        this._queue = box(false, 'btc-queue');
        this._network.add_child(this._queue);
        const stats = box(false, 'btc-stats');
        this._lastBlock = metric(stats, 'Last block');
        this._waiting = metric(stats, 'Waiting transactions');
        this._network.add_child(stats);
        this._networkDetail = label('Loading network data…', 'btc-muted');
        this._network.add_child(this._networkDetail);
    }

    _selectTab(tab) {
        this._tab = tab;
        this._market.visible = tab === 'market';
        this._network.visible = tab === 'network';
        for (const [name, control] of [['market', this._marketTab], ['network', this._networkTab]]) {
            if (name === tab)
                control.add_style_pseudo_class('checked');
            else
                control.remove_style_pseudo_class('checked');
        }
        this._update();
        this._refreshVisible();
    }

    _refreshVisible(force = false) {
        if (this._tab === 'market') {
            const range = this._range;
            this._load(range, () => this._client.history(range), force);
        } else {
            this._load('network', () => this._client.network(), force);
        }
    }

    _refreshQuote() {
        this._load('quote', () => this._client.quote(), true);
    }

    async _load(key, fetcher, force = false) {
        if (!this._alive || this._pending.has(key))
            return;
        const previous = this._slots[key];
        if (!force && previous && !previous.error && Date.now() / 1000 - previous.updated < 60)
            return;
        const generation = this._generation;
        const pending = this._pending;
        pending.add(key);
        try {
            const data = await fetcher();
            if (this._alive && this._generation === generation)
                this._slots[key] = {data, updated: Date.now() / 1000, error: null};
        } catch (error) {
            if (this._alive && this._generation === generation) {
                this._slots[key] = {...previous, error: error.message};
                console.warn(`BTC/USD ${key}: ${error.message}`);
            }
        } finally {
            pending.delete(key);
            if (this._alive && this._generation === generation)
                this._update();
        }
    }

    _update() {
        if (!this._alive)
            return;
        const quote = this._slots.quote;
        if (quote?.data) {
            const suffix = stale(quote) ? ' *' : '';
            this._panelLabel.text = priceLabel(quote.data.price) + suffix;
            this._price.text = priceLabel(quote.data.price, 2) + suffix;
            this._quoteSource.text = `BTC/USD · ${quote.data.source}${stale(quote) ? ' (stale)' : ''}`;
            this._sats.value.text = Math.round(1e8 / quote.data.price).toLocaleString('en-US') + ' sats' + suffix;
            this._volume.value.text = quote.data.volume === undefined ? 'Unavailable' :
                quote.data.volume.toLocaleString('en-US', {maximumFractionDigits: 0}) + ' BTC' + suffix;
        } else if (quote?.error) {
            this._panelLabel.text = 'BTC offline';
            this._price.text = 'Price unavailable';
        }
        this._updateMarket();
        this._updateNetwork();
        const slot = this._tab === 'market' ? this._slots[this._range] : this._slots.network;
        const source = this._tab === 'market' ? 'Chart: Kraken' : 'mempool.space';
        this._footer.text = slot?.updated ?
            `${source} · ${timeText(slot.updated)}${stale(slot) ? ' · Stale — retrying' : ''}` :
            `${source} · ${slot?.error ? 'Unavailable — retrying' : 'Loading…'}`;
    }

    _updateMarket() {
        const slot = this._slots[this._range];
        this._from.text = RANGES[this._range].label;
        for (const [range, control] of Object.entries(this._rangeButtons)) {
            if (range === this._range)
                control.add_style_pseudo_class('checked');
            else
                control.remove_style_pseudo_class('checked');
        }
        this._low.heading.text = `${this._range} low · Kraken`;
        this._high.heading.text = `${this._range} high · Kraken`;
        this._change.remove_style_class_name('btc-positive');
        this._change.remove_style_class_name('btc-negative');
        if (slot?.data) {
            const suffix = stale(slot) ? ' *' : '';
            const value = slot.data;
            this._change.text = `${value.change >= 0 ? '+' : ''}${value.change.toFixed(2)}% · ${this._range} chart${suffix}`;
            this._change.add_style_class_name(value.change >= 0 ? 'btc-positive' : 'btc-negative');
            this._low.value.text = priceLabel(value.low) + suffix;
            this._high.value.text = priceLabel(value.high) + suffix;
            this._chartHigh.text = priceLabel(Math.max(...value.points.map(point => point.value)));
            this._chartLow.text = priceLabel(Math.min(...value.points.map(point => point.value)));
            this._inspect.text = stale(slot) ? 'History is stale · retrying when open' : 'Move across the chart for time and price';
        } else {
            this._change.text = slot?.error ? 'History unavailable' : 'Loading price history…';
            this._low.value.text = this._high.value.text = '—';
            this._chartHigh.text = this._chartLow.text = '—';
            this._inspect.text = slot?.error ? 'Check your connection or try Refresh now' : 'Fetching Kraken candles…';
        }
        this._chart.queue_repaint();
    }

    _updateNetwork() {
        const slot = this._slots.network;
        if (!slot?.data) {
            this._networkDetail.text = slot?.error ? 'Network data unavailable · retrying' : 'Loading network data…';
            return;
        }
        const data = slot.data, suffix = stale(slot) ? ' *' : '';
        data.fees.forEach((fee, i) => {
            this._fees[i].value.text = fee.toLocaleString('en-US', {maximumFractionDigits: 2}) + ' sat/vB' + suffix;
        });
        this._lastBlock.value.text = `${Math.max(0, Math.floor((Date.now() / 1000 - data.blockTime) / 60))} min ago${suffix}`;
        this._waiting.value.text = data.count.toLocaleString('en-US') + suffix;
        this._networkDetail.text = `Block ${data.height.toLocaleString('en-US')} · ${(data.vsize / 1e6).toFixed(1)} MvB waiting${suffix}`;
        if (this._renderedNetwork === data)
            return;
        this._renderedNetwork = data;
        this._queue.destroy_all_children();
        if (!data.queue.length) {
            this._queue.add_child(label('No pending blocks', 'btc-muted'));
            return;
        }
        const max = Math.max(...data.queue.map(block => block.fee), 1);
        data.queue.forEach((block, i) => {
            const column = box(true, 'btc-block');
            column.add_child(new St.Widget({y_expand: true}));
            column.add_child(label(block.fee.toFixed(1), 'btc-block-value'));
            column.add_child(new St.Widget({height: Math.max(1, block.fee / max * 75), style_class: 'btc-bar'}));
            column.add_child(label(i ? `+${i + 1}` : 'Next', 'btc-muted'));
            this._queue.add_child(column);
        });
    }

    _paintChart() {
        const context = this._chart.get_context();
        try {
            const [width, height] = this._chart.get_surface_size();
            const points = this._slots[this._range]?.data?.points ?? [];
            const coords = chartCoordinates(points, width, height);
            if (!coords.length)
                return;
            const color = this._chart.get_theme_node().get_foreground_color();
            context.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255, 0.18);
            context.setLineWidth(1);
            for (const y of [8, height - 8]) {
                context.moveTo(8, y);
                context.lineTo(width - 8, y);
            }
            context.stroke();
            context.moveTo(coords[0].x, height - 8);
            coords.forEach(point => context.lineTo(point.x, point.y));
            context.lineTo(coords.at(-1).x, height - 8);
            context.closePath();
            context.setSourceRGBA(0.969, 0.576, 0.102, 0.10);
            context.fill();
            context.moveTo(coords[0].x, coords[0].y);
            coords.slice(1).forEach(point => context.lineTo(point.x, point.y));
            context.setSourceRGBA(0.969, 0.576, 0.102, 1);
            context.setLineWidth(2);
            context.stroke();
        } finally {
            context.$dispose();
        }
    }

    disable() {
        this._alive = false;
        if (this._name)
            Gio.bus_unown_name(this._name);
        this._name = 0;
        if (this._timer)
            GLib.Source.remove(this._timer);
        this._timer = 0;
        if (this._fallbackWatch)
            Gio.bus_unwatch_name(this._fallbackWatch);
        this._fallbackWatch = 0;
        this._client?.destroy();
        this._client = null;
        this._button?.destroy();
        this._button = null;
        this._renderedNetwork = null;
    }
}
