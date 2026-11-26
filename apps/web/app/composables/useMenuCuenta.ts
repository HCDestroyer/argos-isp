/**
 * La cuenta del usuario (tablero PerfilDrawer; respuestas del PM del 26 nov 2026): quién es, la
 * empresa activa, el tema y las acciones de la cuenta, en una sola lista para los dos lugares donde
 * se abre: el menú desplegable del círculo en la computadora (`MenuUsuario`) y el panel que sube
 * desde abajo en el teléfono (`CuentaDrawer`), que también se abre desde la fila de la cuenta arriba
 * de «Más». Así no se desalinean.
 *
 * El estado vive en `useState`: el panel, «Qué cambió», los atajos y la ayuda de la pantalla se
 * abren desde cualquiera de los dos lugares. Nunca un panel sobre otro: antes de abrir una ventana
 * desde el panel, el panel se cierra (`despuesDeCerrar`).
 */
export type TemaCuenta = 'light' | 'dark' | 'system'

export const TEMAS_CUENTA: { valor: TemaCuenta, etiqueta: string, icono: string }[] = [
    { valor: 'light', etiqueta: 'Claro', icono: 'i-lucide-sun' },
    { valor: 'dark', etiqueta: 'Oscuro', icono: 'i-lucide-moon' },
    { valor: 'system', etiqueta: 'Sistema', icono: 'i-lucide-monitor' },
]

/** Lo que tarda en irse el panel antes de abrir otra ventana (la animación de `UDrawer`). */
const CIERRE_PANEL_MS = 250

export function useMenuCuenta() {
    const { usuario, logout } = useAuth()
    const colorMode = useColorMode()
    const toast = useToast()
    const { version } = useVersion()
    const { eleccion, empresas, alcanceGlobal, conSelector, elegir, nombre: nombreEmpresa } = useEmpresaActiva()

    /** El panel de la cuenta del teléfono. */
    const abierto = useState('cuenta-abierta', () => false)
    const queCambioAbierto = useState('cuenta-que-cambio', () => false)
    const atajosAbierto = useState('cuenta-atajos', () => false)
    const ayudaAbierta = useState('cuenta-ayuda', () => false)

    const iniciales = computed(() => (usuario.value?.nombre ?? '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(parte => parte.charAt(0).toUpperCase())
        .join(''))

    /** Rol principal, legible («Admin», «Cajero»…). */
    const rol = computed(() => {
        const primero = usuario.value?.roles[0]
        return primero ? primero.charAt(0).toUpperCase() + primero.slice(1).replace(/_/g, ' ') : 'Usuario'
    })

    const empresaActiva = computed(() => (eleccion.value === 'todas' ? 'Todas las empresas' : eleccion.value ? nombreEmpresa(eleccion.value) : null))

    /** Las empresas para elegir (solo con más de una); «Todas las empresas» solo con alcance global. */
    const opcionesEmpresa = computed(() => (conSelector.value
        ? [
                ...(alcanceGlobal.value ? [{ valor: 'todas' as const, etiqueta: 'Todas las empresas', nit: null as string | null }] : []),
                ...empresas.value.map(empresa => ({ valor: empresa.id, etiqueta: empresa.nombre_comercial, nit: empresa.nit ? `NIT ${empresa.nit}` : null })),
            ]
        : []))

    const tema = computed<TemaCuenta>({
        get: () => (['light', 'dark'].includes(colorMode.preference) ? colorMode.preference as TemaCuenta : 'system'),
        set: (valor) => {
            colorMode.preference = valor
        },
    })

    /** Elige la empresa activa; desde el panel, lo cierra y avisa cuál quedó. */
    function elegirEmpresa(valor: number | 'todas', avisar = false): void {
        elegir(valor)
        if (avisar) {
            abierto.value = false
            toast.add({ title: `Empresa activa: ${valor === 'todas' ? 'Todas las empresas' : nombreEmpresa(valor)}`, icon: 'i-lucide-building', color: 'neutral' })
        }
    }

    /** Cierra el panel y, ya cerrado, hace lo pedido (abrir otra ventana o ir a otra pantalla). */
    function despuesDeCerrar(accion: () => void): void {
        if (!abierto.value) {
            accion()
            return
        }
        abierto.value = false
        setTimeout(accion, CIERRE_PANEL_MS)
    }

    function abrirQueCambio(): void {
        despuesDeCerrar(() => {
            queCambioAbierto.value = true
        })
    }

    function abrirAtajos(): void {
        despuesDeCerrar(() => {
            atajosAbierto.value = true
        })
    }

    function abrirAyuda(): void {
        despuesDeCerrar(() => {
            ayudaAbierta.value = true
        })
    }

    function irAMiCuenta(): void {
        abierto.value = false
        void navigateTo('/perfil')
    }

    function cerrarSesion(): void {
        abierto.value = false
        void logout()
    }

    return {
        usuario,
        iniciales,
        rol,
        version,
        empresaActiva,
        conSelector,
        opcionesEmpresa,
        eleccion,
        tema,
        abierto,
        queCambioAbierto,
        atajosAbierto,
        ayudaAbierta,
        elegirEmpresa,
        abrirQueCambio,
        abrirAtajos,
        abrirAyuda,
        irAMiCuenta,
        cerrarSesion,
    }
}
