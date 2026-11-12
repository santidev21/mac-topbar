// Mac Topbar: barra superior estilo macOS para GNOME Shell.
//   [logo Fedora ▾] [App activa] [File] [Edit] [View] …          (reloj)   (estado)
// El botón de Actividades se mueve a la derecha, antes de los íconos de estado.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AppTitle} from './appTitle.js';
import {GlobalMenu} from './globalMenu.js';
import {LogoMenu} from './logoMenu.js';

export default class MacTopbarExtension extends Extension {
    enable() {
        // El botón de Actividades se mueve a la zona derecha, antes de los íconos de estado.
        this._activities = Main.panel.statusArea.activities;
        const activities = this._activities?.container;
        if (activities) {
            this._activitiesParent = activities.get_parent();
            this._activitiesIndex = this._activitiesParent?.get_children().indexOf(activities) ?? 0;
            this._activitiesParent?.remove_child(activities);
            Main.panel._rightBox.insert_child_at_index(activities, 0);
        }

        this._logo = new LogoMenu(this.path);
        Main.panel.addToStatusArea('mac-topbar-logo', this._logo, 0, 'left');

        this._title = new AppTitle();
        Main.panel.addToStatusArea('mac-topbar-apptitle', this._title, 1, 'left');

        this._globalMenu = new GlobalMenu(this._title);
    }

    disable() {
        this._globalMenu?.destroy();
        this._globalMenu = null;
        this._title?.destroy();
        this._title = null;
        this._logo?.destroy();
        this._logo = null;
        const activities = this._activities?.container;
        if (activities && this._activitiesParent) {
            activities.get_parent()?.remove_child(activities);
            this._activitiesParent.insert_child_at_index(activities, this._activitiesIndex);
        }
        this._activities = null;
        this._activitiesParent = null;
    }
}
