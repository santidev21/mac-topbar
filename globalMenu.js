// Menú global: si la ventana enfocada publicó su menú (vía el Registrar),
// pinta sus menús de primer nivel (File, Edit, View…) en el panel, justo
// después del nombre de la app. Si no lo publicó, no muestra nada.

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {DBusMenuClient, cleanLabel} from './dbusmenu.js';
import {Registrar} from './registrar.js';
import {isTransientPopup} from './windows.js';

const ROLE_PREFIX = 'mac-topbar-menu-';
const REFRESH_DELAY = 150;

const TopMenuButton = GObject.registerClass(
class TopMenuButton extends PanelMenu.Button {
    _init(client, node) {
        super._init(0.0, cleanLabel(node[1].label));
        this.add_style_class_name('mac-topbar-menu');
        this._client = client;
        this._id = node[0];

        this.add_child(new St.Label({
            text: cleanLabel(node[1].label),
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.update(node[2]);

        // Al abrir: pedir a la app que actualice y releer este menú
        // (VS Code, Qt y otras apps llenan los menús de forma perezosa).
        this.menu.connect('open-state-changed', (_m, open) => {
            client.event(this._id, open ? 'opened' : 'closed');
            if (open)
                client.reload(this.menu, this._id);
        });
    }

    /** Reemplaza el contenido del menú con los hijos recibidos. */
    update(children) {
        this.menu.removeAll();
        this._client.fillMenu(this.menu, children);
    }
});

export class GlobalMenu {
    /** @param {PanelMenu.Button} anchor los menús se insertan justo después de este botón */
    constructor(anchor) {
        this._anchor = anchor;
        this._buttons = [];
        this._client = null;
        this._signature = '';
        this._refreshId = 0;
        this._gen = 0;

        this._registrar = new Registrar(() => this._queueRefresh());
        global.display.connectObject('notify::focus-window', () => this._queueRefresh(), this);
        Main.overview.connectObject(
            'showing', () => this._queueRefresh(),
            'hidden', () => this._queueRefresh(), this);
        this._queueRefresh();
    }

    destroy() {
        if (this._refreshId)
            GLib.source_remove(this._refreshId);
        this._refreshId = 0;
        global.display.disconnectObject(this);
        Main.overview.disconnectObject(this);
        this._clear();
        this._registrar.destroy();
        this._registrar = null;
    }

    _queueRefresh() {
        if (this._refreshId)
            return;
        this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REFRESH_DELAY, () => {
            this._refreshId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** XID de la ventana enfocada (solo ventanas X11/XWayland tienen uno). */
    _focusedXid() {
        const win = global.display.focus_window;
        if (!win || Main.overview.visible)
            return null;
        if (win.get_client_type() !== Meta.WindowClientType.X11)
            return null;
        const xid = parseInt(win.get_description(), 16);
        return Number.isNaN(xid) ? null : xid;
    }

    async _refresh() {
        const gen = ++this._gen; // descarta respuestas de refrescos anteriores
        // Un desplegable de la app enfocada no cambia los menús mostrados.
        const focus = global.display.focus_window;
        if (focus && !Main.overview.visible && isTransientPopup(focus))
            return;
        const xid = this._focusedXid();
        const entry = xid !== null ? this._registrar.lookup(xid) : undefined;
        if (!entry) {
            this._clear();
            return;
        }

        if (!this._client || this._client.service !== entry.service || this._client.path !== entry.path) {
            this._clear();
            this._client = new DBusMenuClient(entry.service, entry.path, () => this._queueRefresh());
        }

        // No reconstruir mientras el usuario tiene un menú abierto.
        if (this._buttons.some(b => b.menu.isOpen))
            return;

        let layout;
        try {
            layout = await this._client.getLayout(0, -1);
        } catch (e) {
            if (gen !== this._gen)
                return;
            logError(e, 'mac-topbar: GetLayout');
            this._clear();
            return;
        }
        if (gen !== this._gen || this._buttons.some(b => b.menu.isOpen))
            return;
        const tops = layout[2].filter(([, props]) => props.visible !== false && props.label);

        // Si el primer nivel no cambió, se dejan los botones (evita parpadeo).
        const signature = `${entry.service}${entry.path}|${tops.map(([id, p]) => `${id}:${p.label}`).join(',')}`;
        if (signature === this._signature) {
            // Mismos menús arriba, pero su contenido pudo cambiar (la app
            // llena los menús después de registrarse): actualizar el contenido.
            this._buttons.forEach((b, i) => b.update(tops[i][2]));
            return;
        }
        this._removeButtons();
        this._signature = signature;

        const box = Main.panel._leftBox;
        let position = box.get_children().indexOf(this._anchor.container) + 1;
        tops.forEach((node, i) => {
            const button = new TopMenuButton(this._client, node);
            Main.panel.addToStatusArea(`${ROLE_PREFIX}${i}`, button, position++, 'left');
            this._buttons.push(button);
        });
    }

    _removeButtons() {
        for (const b of this._buttons)
            b.destroy();
        this._buttons = [];
        this._signature = '';
    }

    _clear() {
        this._removeButtons();
        this._client?.destroy();
        this._client = null;
    }
}
