/**
 * Menú lateral del portal compacto (rail de iconos con etiqueta corta) o expandido (con nombres),
 * como el del panel (`apps/web/app/composables/useMenuCompacto.ts`). Por defecto, compacto. Se
 * recuerda en este navegador (`localStorage`, preferencia de quien mira, nunca un dato de la
 * cuenta); sin almacenamiento (ventana privada, datos bloqueados) arranca compacto y vale solo la
 * visita. Una sola instancia por app (`useState`), para que el layout y el menú vean lo mismo.
 */
const CLAVE = 'argos_portal_menu_compacto'

export function leerMenuCompacto(): boolean {
    try {
        return window.localStorage.getItem(CLAVE) !== '0'
    }
    catch {
        return true
    }
}

export function guardarMenuCompacto(compacto: boolean): void {
    try {
        window.localStorage.setItem(CLAVE, compacto ? '1' : '0')
    }
    catch {
        // Sin almacenamiento: la preferencia vale solo para esta visita.
    }
}

export function useMenuCompacto() {
    const compacto = useState('portal:menu-compacto', () => true)
    onMounted(() => {
        compacto.value = leerMenuCompacto()
    })
    function alternar() {
        compacto.value = !compacto.value
        guardarMenuCompacto(compacto.value)
    }
    return { compacto, alternar }
}
