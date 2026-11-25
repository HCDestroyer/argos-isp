import type { Problem } from '@argosisp/contracts'

/**
 * Lista de integraciones de Configuración (tablero OperConfigIntegraciones): Iris, Horus, pasarela
 * de pago, factura electrónica, SmartOLT, GenieACS y asistentes de IA (MCP). Cada estado sale de su
 * propia lectura (conector de Iris y de Horus, configuración FEL, proveedores de cobro); si una
 * falla, esa fila queda sin estado y su panel muestra el error. SmartOLT (sus instancias, «2 de 4
 * operativas») y el ACS van por separado y son de la empresa activa; con «Todas las empresas» quedan
 * sin estado.
 */
export function useIntegracionesConfiguracion() {
    const { puede } = usePermisos()
    const { empresaId } = useEmpresaActiva()

    const horus = shallowRef<ConectorHorus | null>(null)
    const problemaHorus = ref<Problem | null>(null)
    const cargandoHorus = ref(false)
    const iris = shallowRef<ConectorIris | null>(null)
    const problemaIris = ref<Problem | null>(null)
    const cargandoIris = ref(false)
    const fel = shallowRef<ConfiguracionFel | null>(null)
    const problemaFel = ref<Problem | null>(null)
    const smartolt = shallowRef<InstanciaSmartOlt[] | null>(null)
    const errorSmartolt = ref(false)
    const acs = shallowRef<ConfigAcs | null>(null)
    const errorAcs = ref(false)
    const proveedores = shallowRef<ProveedorCobro[] | null>(null)
    const problemaProveedores = ref<Problem | null>(null)

    async function cargarHorus() {
        cargandoHorus.value = true
        problemaHorus.value = null
        const resultado = await useHorus().conector()
        cargandoHorus.value = false
        horus.value = resultado.ok ? resultado.data : null
        problemaHorus.value = resultado.ok ? null : resultado.problema
    }

    async function cargarIris() {
        cargandoIris.value = true
        problemaIris.value = null
        const resultado = await useIris().conector()
        cargandoIris.value = false
        iris.value = resultado.ok ? resultado.data : null
        problemaIris.value = resultado.ok ? null : resultado.problema
    }

    async function cargarFel() {
        if (empresaId.value === null) {
            return
        }
        const resultado = await useFel().configuracion(empresaId.value)
        fel.value = resultado.ok ? resultado.data : null
        problemaFel.value = resultado.ok ? null : resultado.problema
    }

    async function cargarProveedores() {
        const resultado = await useProveedoresCobro().listar()
        proveedores.value = resultado.ok ? resultado.data : null
        problemaProveedores.value = resultado.ok ? null : resultado.problema
    }

    async function cargarEquipos() {
        if (empresaId.value === null) {
            smartolt.value = null
            acs.value = null
            return
        }
        if (puede('smartolt.ver')) {
            const r = await useSmartOlt().listar()
            smartolt.value = r.ok ? r.data : null
            errorSmartolt.value = !r.ok
        }
        if (puede('acs.ver')) {
            const r = await useAcs().ver()
            acs.value = r.ok ? r.data : null
            errorAcs.value = !r.ok
        }
    }

    function cargar() {
        if (puede(['smartolt.ver', 'acs.ver'])) {
            void cargarEquipos()
        }
        if (puede('iris.ver')) {
            void cargarIris()
        }
        if (puede('horus.ver')) {
            void cargarHorus()
        }
        if (puede('fel.ver')) {
            void cargarFel()
        }
        if (puede('bancos.ver')) {
            void cargarProveedores()
        }
    }

    const pasarelas = computed(() => proveedores.value?.filter(p => p.metodo === 'pasarela') ?? null)

    const items = computed<IntegracionItem[]>(() => {
        const lista: IntegracionItem[] = []
        if (puede('iris.ver')) {
            const presentacion = iris.value ? presentacionConectorIris(iris.value) : null
            lista.push({
                id: 'iris', nombre: 'Iris', frase: 'Soporte, órdenes, chat y avisos', icono: 'i-lucide-message-square', tono: 'tono-exito', to: '/configuracion/integraciones/iris',
                estado: presentacion ? { etiqueta: presentacion.etiqueta, color: presentacion.color, icono: presentacion.icono, prueba: 'estado-lista-iris' } : null,
            })
        }
        if (puede('horus.ver')) {
            const conector = horus.value
            lista.push({
                id: 'horus', nombre: 'Horus', frase: 'Tráfico y seguridad de la red', icono: 'i-lucide-activity', tono: 'tono-exito', to: '/configuracion/integraciones/horus',
                estado: conector
                    ? { etiqueta: conector.activo ? 'Activa' : (conector.version === 0 ? 'Sin conectar' : 'Apagada'), color: conector.activo ? 'success' : 'neutral', icono: conector.activo ? 'i-lucide-plug-zap' : 'i-lucide-power-off', prueba: 'estado-lista-horus' }
                    : null,
            })
        }
        if (puede('bancos.ver')) {
            const activas = pasarelas.value?.filter(p => p.activo) ?? null
            lista.push({
                id: 'pasarela', nombre: 'Pasarela de pago', frase: 'Cobro con tarjeta en el portal', icono: 'i-lucide-credit-card', tono: 'tono-aviso', to: '/configuracion/integraciones?ver=pasarela',
                estado: activas === null ? null : activas.length ? { etiqueta: 'Activa', color: 'success' } : { etiqueta: 'Sin pasarela', color: 'neutral' },
            })
        }
        if (puede('fel.ver')) {
            const config = fel.value
            lista.push({
                id: 'fel', nombre: 'Factura electrónica', frase: 'Certificador FEL', icono: 'i-lucide-shield-check', tono: 'tono-exito', to: '/configuracion/integraciones?ver=fel',
                estado: config ? { etiqueta: MODOS_FEL[config.modo].etiqueta, color: MODOS_FEL[config.modo].color, icono: MODOS_FEL[config.modo].icono } : null,
            })
        }
        if (puede('smartolt.ver')) {
            const resumen = smartolt.value ? resumenSmartOlt(smartolt.value) : null
            lista.push({
                id: 'smartolt', nombre: 'SmartOLT', frase: 'Autoriza y mira las ONU (varias cuentas)', icono: 'i-lucide-server', tono: 'tono-marca', to: '/configuracion/integraciones?ver=smartolt',
                estado: errorSmartolt.value
                    ? { etiqueta: 'No se pudo leer', color: 'error', icono: 'i-lucide-triangle-alert', prueba: 'estado-lista-smartolt' }
                    : resumen ? { ...resumen, prueba: 'estado-lista-smartolt' } : null,
            })
        }
        if (puede('acs.ver')) {
            const e = acs.value ? estadoAcs(acs.value) : null
            lista.push({
                id: 'acs', nombre: 'ACS (GenieACS)', frase: 'Wi-Fi y PPPoE de la ONU', icono: 'i-lucide-cpu', tono: 'tono-marca', to: '/configuracion/integraciones?ver=acs',
                estado: errorAcs.value
                    ? { etiqueta: 'No se pudo leer', color: 'error', icono: 'i-lucide-triangle-alert', prueba: 'estado-lista-acs' }
                    : e ? { etiqueta: e.etiqueta === 'Probado' ? 'Conectado' : e.etiqueta, color: e.color, icono: e.icono, prueba: 'estado-lista-acs' } : null,
            })
        }
        if (puede('tokens.ver')) {
            lista.push({ id: 'mcp', nombre: 'Asistentes de IA (MCP)', frase: 'Tokens con alcance acotado', icono: 'i-lucide-bot', tono: 'tono-marca', to: '/configuracion/integraciones?ver=mcp', estado: null })
        }
        return lista
    })

    return {
        items, cargar,
        horus, problemaHorus, cargandoHorus, cargarHorus,
        iris, problemaIris, cargandoIris, cargarIris,
        fel, problemaFel, cargarFel,
        pasarelas, problemaProveedores, cargarProveedores,
        smartolt, acs, cargarEquipos,
    }
}
