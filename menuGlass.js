// Vidrio esmerilado para los menús de la barra superior (mismo truco que glass-dock).
//
// Al abrir un menú de la barra (.panel-menu) se pone DETRÁS de su caja un
// "vidrio": un clon desenfocado del grupo de ventanas, recortado con una
// máscara de esquinas redondeadas. Encima, el CSS pinta el tinte gris oscuro
// translúcido (.mac-topbar-glass). Al cerrar el menú el vidrio se destruye,
// así que no cuesta nada mientras no hay menús abiertos.
//
//   uiGroup
//     ├ MenuGlass  (clip + máscara redondeada; sigue opacidad/traslación del menú)
//     │   └ _strip (tamaño del menú, BLUR)
//     │       └ _live (clon de global.window_group desplazado)
//     └ menu.actor (BoxPointer) → menu.box (.popup-menu-content.mac-topbar-glass)
//
// En el Overview no hay ventanas que desenfocar: el menú queda opaco (tema normal).

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

const BLUR_RADIUS = 40;
const BLUR_BRIGHTNESS = 0.9;
const GLASS_CLASS = 'mac-topbar-glass';

// Distancia con signo a un rectángulo redondeado (SDF) → alfa con antialias de 1px.
const MASK_DECLARATIONS = `
uniform vec2 u_size;
uniform float u_radius;
`;
const MASK_CODE = `
vec2 p = cogl_tex_coord0_in.xy * u_size;
vec2 q = abs(p - u_size * 0.5) - (u_size * 0.5 - vec2(u_radius));
float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius;
cogl_color_out *= clamp(0.5 - d, 0.0, 1.0);
`;

const RoundedMaskEffect = GObject.registerClass(
class MacTopbarRoundedMask extends Clutter.ShaderEffect {
    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
            MASK_DECLARATIONS, MASK_CODE);
    }

    setGeometry(width, height, radius) {
        this.set_uniform_float('u_size', 2, [width, height]);
        this.set_uniform_float('u_radius', 1, [Math.min(radius, height / 2, width / 2)]);
    }
});

const MenuGlass = GObject.registerClass(
class MacTopbarMenuGlass extends St.Widget {
    _init(menu) {
        super._init({clip_to_allocation: true, reactive: false});
        this._menu = menu;

        this._strip = new Clutter.Actor({clip_to_allocation: true});
        this._live = new Clutter.Clone({source: global.window_group});
        this._strip.add_child(this._live);
        this._strip.add_effect(new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            radius: BLUR_RADIUS,
            brightness: BLUR_BRIGHTNESS,
        }));
        this.add_child(this._strip);

        this._mask = new RoundedMaskEffect();
        this.add_effect(this._mask);

        // Acompaña la animación de apertura/cierre del BoxPointer.
        for (const prop of ['opacity', 'translation-x', 'translation-y', 'visible'])
            menu.actor.bind_property(prop, this, prop, GObject.BindingFlags.SYNC_CREATE);

        Main.uiGroup.insert_child_below(this, menu.actor);

        const queue = () => this._queueSync();
        menu.actor.connectObject('notify::allocation', queue, this);
        menu.box.connectObject('notify::allocation', queue, this);
        this._queueSync();
    }

    _queueSync() {
        if (this._laterId)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        const {actor, box} = this._menu;
        // Posición de la caja dentro del BoxPointer (sin su traslación de animación).
        // Ojo: el BoxPointer se coloca en su asignación (allocationBox.set_origin),
        // no con las propiedades x/y, que se quedan en 0.
        const rel = box.apply_relative_transform_to_point(actor, new Graphene.Point3D());
        const alloc = actor.get_allocation_box();
        const x = Math.round(alloc.x1 + rel.x);
        const y = Math.round(alloc.y1 + rel.y);
        const [w, h] = [Math.round(box.width), Math.round(box.height)];
        const radius = box.get_theme_node().get_border_radius(St.Corner.TOPLEFT);

        this.set_position(x, y);
        this.set_size(w, h);
        this._strip.set_size(w, h);
        this._live.set_position(-x, -y);
        this._mask.setGeometry(w, h, radius);
    }

    destroy() {
        if (this._laterId) {
            global.compositor.get_laters().remove(this._laterId);
            this._laterId = 0;
        }
        this._menu.actor.disconnectObject(this);
        this._menu.box.disconnectObject(this);
        super.destroy();
    }
});

function isPanelMenu(menu) {
    return menu?.actor?.has_style_class_name?.('panel-menu') && menu.box;
}

function attach(menu) {
    if (menu._macTopbarGlass || Main.overview.visible)
        return;
    menu._macTopbarGlass = new MenuGlass(menu);
    menu.box.add_style_class_name(GLASS_CLASS);
}

function detach(menu) {
    menu._macTopbarGlass?.destroy();
    menu._macTopbarGlass = null;
    menu.box?.remove_style_class_name(GLASS_CLASS);
}

export class MenuGlassManager {
    constructor() {
        this._menus = new Set();
        this._injections = new InjectionManager();
        const menus = this._menus;

        // Todos los menús de la barra heredan de PopupMenu: se intercepta en el
        // prototipo para cubrir también los que se crean después (menús globales).
        this._injections.overrideMethod(PopupMenu.PopupMenu.prototype, 'open', orig =>
            function (...args) {
                if (isPanelMenu(this)) {
                    attach(this);
                    menus.add(this);
                }
                return orig.apply(this, args);
            });
        // El vidrio se va cuando el BoxPointer termina de ocultarse.
        this._injections.overrideMethod(PopupMenu.PopupMenu.prototype, 'close', orig =>
            function (...args) {
                const ret = orig.apply(this, args);
                if (this._macTopbarGlass) {
                    const bp = this.actor;
                    if (bp.visible) {
                        bp.connectObject('notify::visible', () => {
                            if (bp.visible)
                                return;
                            bp.disconnectObject(menus);
                            if (!this.isOpen) {
                                detach(this);
                                menus.delete(this);
                            }
                        }, menus);
                    } else {
                        detach(this);
                        menus.delete(this);
                    }
                }
                return ret;
            });
    }

    destroy() {
        this._injections.clear();
        for (const menu of this._menus) {
            menu.actor?.disconnectObject(this._menus);
            detach(menu);
        }
        this._menus.clear();
    }
}
