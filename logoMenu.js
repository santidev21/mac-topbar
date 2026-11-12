// El "menú Apple": logo de Fedora a la izquierda del panel con las acciones
// de sistema (Acerca de, Configuración, Software, Forzar salida, energía y sesión).

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import {ForceQuitDialog} from './forceQuit.js';
import {_} from './i18n.js';

export const LogoMenu = GObject.registerClass(
class LogoMenu extends PanelMenu.Button {
    _init(extensionPath) {
        super._init(0.0, 'Fedora Menu');
        this.add_style_class_name('mac-topbar-logo');

        this.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(`${extensionPath}/icons/fedora-symbolic.svg`),
            style_class: 'system-status-icon',
        }));

        const actions = SystemActions.getDefault();
        const run = fn => () => {
            try {
                fn();
            } catch (e) {
                // La acción no está disponible (p. ej. sin permisos para suspender).
                logError(e, 'mac-topbar');
            }
        };

        this._addItem(_('About This Computer'), () => Util.spawn(['gnome-control-center', 'system', 'about']));
        this._addSeparator();
        this._addItem(_('System Settings…'), () => this._launch('org.gnome.Settings.desktop', ['gnome-control-center']));
        this._addItem(_('Software…'), () => this._launch('org.gnome.Software.desktop', ['gnome-software']));
        this._addSeparator();
        this._addItem(_('Force Quit…'), () => new ForceQuitDialog().open());
        this._addSeparator();
        this._addItem(_('Sleep'), run(() => actions.activateSuspend()));
        this._addItem(_('Restart…'), run(() => actions.activateRestart()));
        this._addItem(_('Shut Down…'), run(() => actions.activatePowerOff()));
        this._addSeparator();
        this._addItem(_('Lock Screen'), run(() => actions.activateLockScreen()));
        this._addItem(_('Log Out…'), run(() => actions.activateLogout()));
    }

    _addItem(label, callback) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => {
            Main.overview.hide();
            callback();
        });
        this.menu.addMenuItem(item);
    }

    _addSeparator() {
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    _launch(desktopId, fallbackArgv) {
        const app = Shell.AppSystem.get_default().lookup_app(desktopId);
        if (app)
            app.activate();
        else
            Util.spawn(fallbackArgv);
    }
});
