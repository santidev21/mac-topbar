// Nombre de la app enfocada, en negrita, al lado del logo (como "Finder" en macOS).
// Su menú ofrece Ocultar y Salir.

import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_} from './i18n.js';
import {isTransientPopup} from './windows.js';

export const AppTitle = GObject.registerClass(
class AppTitle extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'App Title');
        this.add_style_class_name('mac-topbar-apptitle');

        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._label);

        this._hideItem = new PopupMenu.PopupMenuItem('');
        this._hideItem.connect('activate', () => this._hide());
        this.menu.addMenuItem(this._hideItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._quitItem = new PopupMenu.PopupMenuItem('');
        this._quitItem.connect('activate', () => this._app?.request_quit());
        this.menu.addMenuItem(this._quitItem);

        this._tracker = Shell.WindowTracker.get_default();
        this._tracker.connectObject('notify::focus-app', () => this._sync(), this);
        global.display.connectObject('notify::focus-window', () => this._sync(), this);
        Main.overview.connectObject(
            'showing', () => this._sync(),
            'hidden', () => this._sync(), this);
        this._sync();
    }

    get app() {
        return this._app;
    }

    _sync() {
        let app = null;
        if (!Main.overview.visible) {
            // Un desplegable de la app (p. ej. los de Steam) no cambia de app.
            const win = global.display.focus_window;
            if (win && isTransientPopup(win))
                return;
            app = this._tracker.focus_app;
            // Ventanas sin app reconocible (sin nombre): mantener la anterior.
            if (app && !app.get_name())
                return;
        }
        this._app = app;
        this.visible = app !== null;
        if (!app)
            return;
        const name = app.get_name();
        this._label.text = name;
        this._hideItem.label.text = _('Hide %s').replace('%s', name);
        this._quitItem.label.text = _('Quit %s').replace('%s', name);
    }

    _hide() {
        for (const win of this._app?.get_windows() ?? []) {
            if (win.can_minimize())
                win.minimize();
        }
    }
});
