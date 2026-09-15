import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

// Opt-in live-network test; run through gnome-shell-test-tool in a private D-Bus session.
const UUID = 'btc-usd-tracker@saschb2b.github.io';
const FALLBACK = 'io.github.saschb2b.BtcUsdTracker.Fallback';
function call(destination, path, iface, method, parameters) {
    return Gio.DBus.session.call_sync(destination, path, iface, method, parameters,
        null, Gio.DBusCallFlags.NONE, 2000, null).recursiveUnpack();
}
function owner() {
    const nameExists = call('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', 'NameHasOwner', new GLib.Variant('(s)', [FALLBACK]))[0];
    if (!nameExists)
        return null;
    return call('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', 'GetNameOwner', new GLib.Variant('(s)', [FALLBACK]))[0];
}
function fallbackStatus() {
    const name = owner();
    if (!name)
        return null;
    return call(name, '/org/ayatana/NotificationItem/btc_usd_tracker',
        'org.freedesktop.DBus.Properties', 'GetAll',
        new GLib.Variant('(s)', ['org.kde.StatusNotifierItem']))[0].Status;
}
async function until(test, description) {
    for (let i = 0; i < 100; i++) {
        if (test())
            return;
        await Scripting.sleep(200);
    }
    throw new Error(`Timed out: ${description}`);
}
async function screenshot(name) {
    const directory = GLib.getenv('BTC_TEST_OUTPUT');
    if (!directory)
        return;
    const path = `${directory}/${name}.png`;
    const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
    const actor = Main.extensionManager.lookup(UUID).stateObj._button.menu.actor;
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    await new Shell.Screenshot().screenshot_area(Math.floor(x), Math.floor(y), Math.ceil(width), Math.ceil(height), stream);
    stream.close(null);
    print(`Screenshot: ${path}`);
}
export async function run() {
    if (!GLib.getenv('BTC_TEST_SOURCE'))
        throw new Error('Set BTC_TEST_SOURCE to the absolute repository path');
    await Scripting.sleep(1000);
    const record = Main.extensionManager.lookup(UUID);
    print(`Extension state: ${record?.state}; errors: ${JSON.stringify(record?.errors)}`);
    const ext = record?.stateObj;
    if (!ext?._button)
        throw new Error('Extension failed to create panel button');
    Main.overview.hide();
    ext._button.menu.open();
    await until(() => ext._slots.quote?.data && ext._slots['24h']?.data, 'live market data');
    await Scripting.sleep(500);
    print(`Market: ${ext._price.text}; ${ext._change.text}`);
    await screenshot('market');
    ext._selectTab('network');
    await until(() => ext._slots.network?.data, 'live network data');
    await Scripting.sleep(500);
    print(`Network: ${ext._networkDetail.text}`);
    await screenshot('network');
    ext._selectTab('market');
    for (const range of ['1h', '7d']) {
        ext._rangeButtons[range].emit('clicked', 1);
        await until(() => ext._slots[range]?.data, `${range} history`);
        print(`History ${range}: ${ext._slots[range].data.points.length} points`);
    }
    const lastQuote = ext._slots.quote.data.price;
    await ext._load('quote', async () => { throw new Error('Simulated offline'); }, true);
    if (ext._slots.quote.data.price !== lastQuote || !ext._panelLabel.text.endsWith('*'))
        throw new Error('Failed refresh did not retain and mark the last price');
    const lastHistory = ext._slots['7d'].data;
    await ext._load('7d', async () => { throw new Error('Simulated offline'); }, true);
    if (ext._slots['7d'].data !== lastHistory || !ext._change.text.endsWith('*'))
        throw new Error('Failed history did not preserve the chart');
    const lastNetwork = ext._slots.network.data;
    await ext._load('network', async () => { throw new Error('Simulated offline'); }, true);
    if (ext._slots.network.data !== lastNetwork || !ext._waiting.value.text.endsWith('*'))
        throw new Error('Failed network refresh did not preserve and mark its data');
    print('Offline handling passed');

    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    launcher.setenv('WAYLAND_DISPLAY', 'gnome-shell-test-display', true);
    const process = launcher.spawnv(['/usr/bin/python3', `${GLib.getenv('BTC_TEST_SOURCE')}/tracker.py`]);
    try {
        await until(() => fallbackStatus() === 'Passive', 'fallback hidden while native popover is active');
        print('Fallback hidden with native popover active');
        // Resolve an old request after re-enable to verify lifecycle isolation.
        let resolveOld;
        const oldRequest = ext._load('lifecycle-probe', () => new Promise(resolve => { resolveOld = resolve; }), true);
        ext._fallbackAction.activate(null);
        await until(() => !ext._alive && fallbackStatus() === 'Active', 'automatic fallback after disable');
        print('Fallback automatically visible after native disable');
        Main.extensionManager.enableExtension(UUID);
        await until(() => ext._alive && fallbackStatus() === 'Passive', 'native re-enable hides fallback');
        resolveOld({old: true});
        await oldRequest;
        if (ext._slots['lifecycle-probe'])
            throw new Error('Old lifecycle request overwrote re-enabled extension state');
        print('Fallback hidden after native re-enable');
        ext._selectTab('market');
        ext._button.menu.open();
        await until(() => ext._slots.quote?.data && ext._slots['24h']?.data, 'data after re-enable');
        await Scripting.sleep(250);
        await screenshot('market');
        ext._selectTab('network');
        await until(() => ext._slots.network?.data, 'network after re-enable');
        await Scripting.sleep(250);
        await screenshot('network');
        Main.extensionManager.disableExtension(UUID);
        await until(() => !ext._alive, 'final cleanup');
    } finally {
        process.send_signal(15);
    }
    print('BTC_SMOKE_PASSED');
}
