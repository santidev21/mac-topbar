// Cliente de com.canonical.dbusmenu: lee el árbol de menús que publica una app
// y lo convierte en PopupMenu de GNOME Shell. Al hacer clic, avisa a la app.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const IFACE = 'com.canonical.dbusmenu';
const TIMEOUT_MS = 2000;

/** "_File" -> "File", "Save __As" -> "Save _As" (los "_" marcan la tecla de acceso). */
export function cleanLabel(label) {
    return (label ?? '').replace(/__|_/g, m => (m === '__' ? '_' : ''));
}

/** [['Control', 'Shift', 's']] -> "Ctrl+Shift+S" */
function formatShortcut(shortcut) {
    const combo = shortcut?.[0];
    if (!combo?.length)
        return '';
    const names = {Control: 'Ctrl', Super: 'Super', Alt: 'Alt', Shift: 'Shift'};
    return combo.map(k => names[k] ?? (k.length === 1 ? k.toUpperCase() : k)).join('+');
}

export class DBusMenuClient {
    constructor(service, path, onLayoutUpdated) {
        this.service = service;
        this.path = path;
        this._cancellable = new Gio.Cancellable();
        this._signalId = Gio.DBus.session.signal_subscribe(service, IFACE, 'LayoutUpdated',
            path, null, Gio.DBusSignalFlags.NONE, (...args) => {
                const [, , , , , params] = args;
                const [, parent] = params.deepUnpack();
                onLayoutUpdated(parent);
            });
    }

    destroy() {
        this._cancellable.cancel();
        Gio.DBus.session.signal_unsubscribe(this._signalId);
    }

    _call(method, params, replyType) {
        return new Promise((resolve, reject) => {
            Gio.DBus.session.call(this.service, this.path, IFACE, method, params,
                replyType ? new GLib.VariantType(replyType) : null,
                Gio.DBusCallFlags.NONE, TIMEOUT_MS, this._cancellable,
                (conn, res) => {
                    try {
                        resolve(conn.call_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }

    /** @returns {Promise<[number, object, Array]>} nodo [id, props, hijos] */
    async getLayout(parentId = 0, depth = -1) {
        const reply = await this._call('GetLayout',
            new GLib.Variant('(iias)', [parentId, depth, []]), '(u(ia{sv}av))');
        const [, layout] = reply.recursiveUnpack();
        return layout;
    }

    /** Algunas apps (Qt) llenan el submenú justo antes de mostrarlo. */
    async aboutToShow(id) {
        try {
            await this._call('AboutToShow', new GLib.Variant('(i)', [id]), '(b)');
        } catch {
            // No todas las apps lo implementan; no pasa nada.
        }
    }

    event(id, eventId) {
        this._call('Event', new GLib.Variant('(isvu)',
            [id, eventId, new GLib.Variant('i', 0), global.get_current_time()]), null)
            .catch(e => {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e, 'mac-topbar: dbusmenu Event');
            });
    }

    /**
     * Pide a la app que prepare el submenú `id`, lo vuelve a leer y reemplaza
     * el contenido de `menu` (solo si sigue abierto).
     */
    async reload(menu, id) {
        try {
            await this.aboutToShow(id);
            const [, , kids] = await this.getLayout(id, -1);
            if (!menu.isOpen || !kids.length)
                return;
            menu.removeAll();
            this.fillMenu(menu, kids);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, 'mac-topbar: reload');
        }
    }

    /**
     * Llena `menu` (PopupMenuSection o PopupMenu) con los hijos de un nodo.
     * Si no hay hijos deja un ítem de relleno: GNOME no abre menús vacíos.
     */
    fillMenu(menu, children) {
        if (!children.length) {
            const placeholder = new PopupMenu.PopupMenuItem('…');
            placeholder.setSensitive(false);
            menu.addMenuItem(placeholder);
            return;
        }
        for (const [id, props, kids] of children) {
            if (props.visible === false)
                continue;

            if (props.type === 'separator') {
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                continue;
            }

            const label = cleanLabel(props.label);
            if (props['children-display'] === 'submenu' || kids.length) {
                const sub = new PopupMenu.PopupSubMenuMenuItem(label);
                sub.setSensitive(props.enabled !== false);
                this.fillMenu(sub.menu, kids);
                // Submenús perezosos (p. ej. "Open Recent"): se llenan al abrirlos.
                sub.menu.connect('open-state-changed', (_m, open) => {
                    if (open)
                        this.reload(sub.menu, id);
                });
                menu.addMenuItem(sub);
                continue;
            }

            const item = new PopupMenu.PopupMenuItem(label);
            item.setSensitive(props.enabled !== false);

            const toggle = props['toggle-type'];
            if (toggle === 'checkmark' || toggle === 'radio') {
                const on = props['toggle-state'] === 1;
                item.setOrnament(on
                    ? (toggle === 'radio' ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.CHECK)
                    : PopupMenu.Ornament.NO_DOT);
            }

            const accel = formatShortcut(props.shortcut);
            if (accel) {
                item.add_child(new St.Label({
                    text: accel,
                    style_class: 'mac-topbar-shortcut',
                    x_expand: true,
                    x_align: Clutter.ActorAlign.END,
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }

            item.connect('activate', () => this.event(id, 'clicked'));
            menu.addMenuItem(item);
        }
    }
}
