import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Client} from './client.js';
import {
    BUS_NAME, RANGES, priceLabel, feeLabel, changeLabel, timeLabel, stale,
    chartCoordinates, chartBounds, nearestPoint, rangePosition,
} from './data.js';

// Secondary text is dimmed through actor opacity so it follows light and dark shell themes.
const MUTED = 150;
const ORANGE = [0.969, 0.576, 0.102];
const CHART_PADDING = 8;
const CHART_INSET = 6;

function box(vertical = false, style = '') {
    return new St.BoxLayout({
        orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
        x_expand: true, style_class: style,
    });
}

// Equal-width columns, which St.BoxLayout cannot guarantee.
function columns(spacing, style = '', expand = true) {
    return new St.Widget({
        layout_manager: new Clutter.GridLayout({column_homogeneous: true, column_spacing: spacing}),
        x_expand: expand, style_class: style,
    });
}

function label(text, style = '', expand = false) {
    return new St.Label({text, style_class: style, x_expand: expand, y_align: Clutter.ActorAlign.CENTER});
}

function muted(text, style = '', expand = false) {
    const widget = label(text, `btc-small ${style}`, expand);
    widget.opacity = MUTED;
    return widget;
}

function centered(widget) {
    widget.x_expand = true;
    widget.x_align = Clutter.ActorAlign.CENTER;
    return widget;
}

function segmented(entries, action, compact = false) {
    const widget = columns(2, compact ? 'btc-segmented btc-compact' : 'btc-segmented', !compact);
    const buttons = {};
    for (const [key, text] of entries) {
        const control = new St.Button({label: text, style_class: 'btc-segment', can_focus: true, x_expand: true});
        control.connect('clicked', () => action(key));
        buttons[key] = control;
        widget.add_child(control);
    }
    return {widget, buttons};
}

function select(buttons, selected) {
    for (const [key, control] of Object.entries(buttons)) {
        if (key === selected)
            control.add_style_pseudo_class('checked');
        else
            control.remove_style_pseudo_class('checked');
    }
}

function metric(parent, title) {
    const column = box(true, 'btc-metric');
    const heading = muted(title);
    const value = label('—', 'btc-value');
    column.add_child(heading);
    column.add_child(value);
    parent.add_child(column);
    return {heading, value};
}

function sectionHead(title, detail) {
    const row = box(false, 'btc-head');
    row.add_child(label(title, 'btc-title', true));
    row.add_child(muted(detail));
    return row;
}

function timeText(timestamp) {
    return new Date(timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function foreground(actor, context, alpha) {
    const color = actor.get_theme_node().get_foreground_color();
    context.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255, alpha);
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
        this._hover = null;
        this._pending = new Set();
        this._client = new Client();
        this._build();
        Main.panel.addToStatusArea(this.uuid, this._button, 0, 'right');
        this._button.menu.connect('open-state-changed', (_menu, open) => {
            this._hover = null;
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
        const gicon = new Gio.FileIcon({file: this.dir.get_child('bitcoin-symbolic.svg')});
        const panel = box(false, 'btc-panel');
        panel.add_child(new St.Icon({gicon, style_class: 'system-status-icon'}));
        this._panelLabel = label('BTC …');
        panel.add_child(this._panelLabel);
        this._button.add_child(panel);

        const section = new PopupMenu.PopupMenuSection();
        this._content = box(true, 'btc-content');
        section.actor.add_child(this._content);
        this._button.menu.addMenuItem(section);

        const heading = box(false, 'btc-heading');
        heading.add_child(new St.Icon({gicon, style_class: 'btc-logo'}));
        heading.add_child(label('Bitcoin', 'btc-title'));
        this._quoteSource = muted('BTC/USD', '', true);
        heading.add_child(this._quoteSource);
        this._refresh = new St.Button({
            style_class: 'btc-icon-button', can_focus: true, accessible_name: 'Refresh now',
            child: new St.Icon({icon_name: 'view-refresh-symbolic', style_class: 'btc-icon'}),
        });
        this._refresh.connect('clicked', () => {
            this._refreshQuote();
            this._refreshVisible(true);
        });
        heading.add_child(this._refresh);
        this._content.add_child(heading);

        const tabs = segmented([['market', 'Market'], ['network', 'Network']], tab => this._selectTab(tab));
        this._tabs = tabs.buttons;
        this._content.add_child(tabs.widget);
        this._market = box(true, 'btc-page');
        this._network = box(true, 'btc-page');
        this._content.add_child(this._market);
        this._content.add_child(this._network);
        this._buildMarket();
        this._buildNetwork();
        this._footer = muted('Connecting…', 'btc-footer');
        this._content.add_child(this._footer);
        select(this._tabs, 'market');
        this._network.hide();

        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
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
        const priceRow = box(false, 'btc-price-row');
        this._price = label('$ —', 'btc-price');
        this._change = label('—', 'btc-pill');
        this._change.hide();
        priceRow.add_child(this._price);
        priceRow.add_child(this._change);
        this._market.add_child(priceRow);

        const chartBlock = box(true, 'btc-chart-block');
        const chartHead = box(false, 'btc-head');
        this._inspect = muted('Loading history…', '', true);
        chartHead.add_child(this._inspect);
        const ranges = segmented(Object.keys(RANGES).map(range => [range, range.toUpperCase()]), range => {
            this._range = range;
            this._hover = null;
            this._update();
            this._load(range, () => this._client.history(range));
        }, true);
        this._rangeButtons = ranges.buttons;
        chartHead.add_child(ranges.widget);
        chartBlock.add_child(chartHead);

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
                const span = Math.max(1, this._chart.width - 2 * CHART_INSET);
                this._hover = nearestPoint(points, Math.max(0, Math.min(1, (x - CHART_INSET) / span)));
                this._updateInspect();
                this._chart.queue_repaint();
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._chart.connect('leave-event', () => {
            this._hover = null;
            this._updateInspect();
            this._chart.queue_repaint();
            return Clutter.EVENT_PROPAGATE;
        });
        chartRow.add_child(this._chart);
        const axis = box(true, 'btc-axis');
        axis.x_expand = false;
        this._chartHigh = muted('—');
        this._chartLow = muted('—');
        for (const tick of [this._chartHigh, this._chartLow])
            tick.x_align = Clutter.ActorAlign.END;
        axis.add_child(this._chartHigh);
        axis.add_child(new St.Widget({y_expand: true}));
        axis.add_child(this._chartLow);
        chartRow.add_child(axis);
        chartBlock.add_child(chartRow);
        const timeline = box(false);
        this._from = muted('', '', true);
        this._to = muted('');
        timeline.add_child(this._from);
        timeline.add_child(this._to);
        chartBlock.add_child(timeline);
        this._market.add_child(chartBlock);

        const bounds = box(true, 'btc-section');
        const boundsHead = box(false, 'btc-head');
        this._lowTitle = muted('Low', '', true);
        this._highTitle = muted('High');
        boundsHead.add_child(this._lowTitle);
        boundsHead.add_child(this._highTitle);
        bounds.add_child(boundsHead);
        const boundsRow = box(false, 'btc-range-row');
        this._low = label('—', 'btc-value');
        this._high = label('—', 'btc-value');
        this._track = new St.DrawingArea({
            style_class: 'btc-track', x_expand: true, y_align: Clutter.ActorAlign.CENTER,
            accessible_name: 'Current price between the period low and high',
        });
        this._track.connect('repaint', () => this._paintTrack());
        boundsRow.add_child(this._low);
        boundsRow.add_child(this._track);
        boundsRow.add_child(this._high);
        bounds.add_child(boundsRow);
        this._market.add_child(bounds);

        const details = columns(16, 'btc-section');
        this._volume = metric(details, '24h volume');
        this._sats = metric(details, 'Sats per dollar');
        this._market.add_child(details);
    }

    _buildNetwork() {
        const fees = box(true, 'btc-group');
        fees.add_child(sectionHead('Transaction fees', 'Estimates · sat/vB'));
        const cards = columns(8);
        this._fees = ['Next block', '~30 min', '~1 hour'].map(title => {
            const card = box(true, 'btc-card');
            card.add_child(muted(title));
            const value = label('—', 'btc-card-value');
            card.add_child(value);
            cards.add_child(card);
            return value;
        });
        fees.add_child(cards);
        this._network.add_child(fees);

        const queue = box(true, 'btc-group');
        queue.add_child(sectionHead('Projected blocks', 'Median · sat/vB'));
        this._queue = columns(8);
        queue.add_child(this._queue);
        this._network.add_child(queue);

        const chain = columns(16, 'btc-section');
        this._lastBlock = metric(chain, 'Last block');
        this._height = metric(chain, 'Block height');
        this._network.add_child(chain);
        const mempool = columns(16, 'btc-section');
        this._waiting = metric(mempool, 'Unconfirmed transactions');
        this._backlog = metric(mempool, 'Mempool size');
        this._network.add_child(mempool);
    }

    _selectTab(tab) {
        this._tab = tab;
        this._market.visible = tab === 'market';
        this._network.visible = tab === 'network';
        select(this._tabs, tab);
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
            this._sats.value.text = Math.round(1e8 / quote.data.price).toLocaleString('en-US') + suffix;
            this._volume.value.text = quote.data.volume === undefined ? 'Unavailable' :
                quote.data.volume.toLocaleString('en-US', {maximumFractionDigits: 0}) + ' BTC' + suffix;
        } else if (quote?.error) {
            this._panelLabel.text = 'BTC offline';
            this._price.text = 'Unavailable';
        }
        this._updateMarket();
        this._updateNetwork();
        const slot = this._tab === 'market' ? this._slots[this._range] : this._slots.network;
        const source = this._tab === 'market' ? 'Chart: Kraken' : 'mempool.space';
        this._footer.text = slot?.updated ?
            `${source} · Updated ${timeText(slot.updated)}${stale(slot) ? ' · Stale, retrying' : ''}` :
            `${source} · ${slot?.error ? 'Unavailable, retrying' : 'Loading…'}`;
    }

    _updateMarket() {
        const slot = this._slots[this._range];
        select(this._rangeButtons, this._range);
        this._lowTitle.text = `${this._range} low`;
        this._highTitle.text = `${this._range} high`;
        this._change.remove_style_class_name('btc-positive');
        this._change.remove_style_class_name('btc-negative');
        if (slot?.data) {
            const value = slot.data, points = value.points;
            this._change.text = changeLabel(value.change) + (stale(slot) ? ' *' : '');
            const direction = Number(value.change.toFixed(2));
            if (direction)
                this._change.add_style_class_name(direction > 0 ? 'btc-positive' : 'btc-negative');
            this._change.show();
            this._low.text = priceLabel(value.low);
            this._high.text = priceLabel(value.high);
            this._chartHigh.text = priceLabel(Math.max(...points.map(point => point.value)));
            this._chartLow.text = priceLabel(Math.min(...points.map(point => point.value)));
            this._from.text = timeLabel(points[0].time, this._range);
            this._to.text = timeLabel(points.at(-1).time, this._range);
        } else {
            this._change.hide();
            this._low.text = this._high.text = '—';
            this._chartHigh.text = this._chartLow.text = '';
            this._from.text = this._to.text = '';
        }
        this._updateInspect();
        this._chart.queue_repaint();
        this._track.queue_repaint();
    }

    _updateInspect() {
        const slot = this._slots[this._range];
        const hover = slot?.data?.points.includes(this._hover) ? this._hover : null;
        this._inspect.opacity = hover ? 255 : MUTED;
        if (hover)
            this._inspect.text = `${timeLabel(hover.time, this._range, true)}  ·  ${priceLabel(hover.value, 2)}`;
        else if (slot?.data)
            this._inspect.text = RANGES[this._range].title + (stale(slot) ? ' · stale' : '');
        else
            this._inspect.text = slot?.error ? 'History unavailable' : 'Loading history…';
    }

    _updateNetwork() {
        const slot = this._slots.network;
        if (!slot?.data)
            return;
        const data = slot.data, suffix = stale(slot) ? ' *' : '';
        data.fees.forEach((fee, i) => {
            this._fees[i].text = feeLabel(fee) + suffix;
        });
        this._lastBlock.value.text = `${Math.max(0, Math.floor((Date.now() / 1000 - data.blockTime) / 60))} min ago${suffix}`;
        this._height.value.text = data.height.toLocaleString('en-US') + suffix;
        this._waiting.value.text = data.count.toLocaleString('en-US') + suffix;
        this._backlog.value.text = `${(data.vsize / 1e6).toFixed(1)} MvB${suffix}`;
        if (this._renderedNetwork === data)
            return;
        this._renderedNetwork = data;
        this._queue.destroy_all_children();
        if (!data.queue.length) {
            this._queue.add_child(muted('No pending blocks'));
            return;
        }
        data.queue.forEach((block, i) => {
            const column = box(true, 'btc-block-column');
            const tile = box(true, i ? 'btc-block' : 'btc-block btc-block-next');
            tile.add_child(centered(label(feeLabel(block.fee), 'btc-block-value')));
            const count = centered(muted(`${block.transactions.toLocaleString('en-US')} tx`, 'btc-tiny'));
            if (!i)
                count.opacity = 210; // dark text on the solid tile needs less dimming
            tile.add_child(count);
            column.add_child(tile);
            column.add_child(centered(muted(i ? `+${i + 1}` : 'Next')));
            this._queue.add_child(column);
        });
    }

    _paintChart() {
        const context = this._chart.get_context();
        try {
            const [width, height] = this._chart.get_surface_size();
            const points = this._slots[this._range]?.data?.points ?? [];
            const coords = chartCoordinates(points, width, height, CHART_PADDING, CHART_INSET);
            if (!coords.length)
                return;
            const {high, low} = chartBounds(height, CHART_PADDING);
            foreground(this._chart, context, 0.16);
            context.setLineWidth(1);
            context.setDash([2, 4], 0);
            for (const y of [high, (high + low) / 2, low]) {
                context.moveTo(0, Math.round(y) + 0.5);
                context.lineTo(width, Math.round(y) + 0.5);
            }
            context.stroke();
            context.setDash([], 0);

            const fill = new Cairo.LinearGradient(0, high, 0, height);
            fill.addColorStopRGBA(0, ...ORANGE, 0.30);
            fill.addColorStopRGBA(1, ...ORANGE, 0);
            context.moveTo(coords[0].x, height);
            coords.forEach(point => context.lineTo(point.x, point.y));
            context.lineTo(coords.at(-1).x, height);
            context.closePath();
            context.setSource(fill);
            context.fill();

            context.setLineJoin(Cairo.LineJoin.ROUND);
            context.setLineCap(Cairo.LineCap.ROUND);
            context.setLineWidth(2);
            context.setSourceRGBA(...ORANGE, 1);
            context.moveTo(coords[0].x, coords[0].y);
            coords.slice(1).forEach(point => context.lineTo(point.x, point.y));
            context.stroke();

            // The marker follows the pointer and otherwise rests on the latest candle.
            const hovered = points.indexOf(this._hover);
            const focus = coords[hovered] ?? coords.at(-1);
            if (hovered >= 0) {
                foreground(this._chart, context, 0.35);
                context.setLineWidth(1);
                context.moveTo(Math.round(focus.x) + 0.5, 0);
                context.lineTo(Math.round(focus.x) + 0.5, height);
                context.stroke();
            }
            context.setSourceRGBA(...ORANGE, 0.28);
            context.arc(focus.x, focus.y, 6, 0, 2 * Math.PI);
            context.fill();
            context.setSourceRGBA(...ORANGE, 1);
            context.arc(focus.x, focus.y, 3, 0, 2 * Math.PI);
            context.fill();
        } finally {
            context.$dispose();
        }
    }

    _paintTrack() {
        const context = this._track.get_context();
        try {
            const [width, height] = this._track.get_surface_size();
            const radius = 5, y = height / 2;
            if (width <= 2 * radius)
                return;
            context.setLineCap(Cairo.LineCap.ROUND);
            context.setLineWidth(4);
            foreground(this._track, context, 0.2);
            context.moveTo(radius, y);
            context.lineTo(width - radius, y);
            context.stroke();
            const price = this._slots.quote?.data?.price;
            const history = this._slots[this._range]?.data;
            if (price === undefined || !history)
                return;
            const x = radius + rangePosition(price, history.low, history.high) * (width - 2 * radius);
            context.setSourceRGBA(...ORANGE, 1);
            context.moveTo(radius, y);
            context.lineTo(x, y);
            context.stroke();
            context.arc(x, y, radius, 0, 2 * Math.PI);
            context.fill();
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
        this._hover = null;
    }
}
