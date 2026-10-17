import type { paths } from '@argosisp/contracts'

export type CambiosConectorHorus = paths['/api/v1/integraciones/horus']['put']['requestBody']['content']['application/json']
export type DatosTokenHorus = NonNullable<paths['/api/v1/integraciones/horus/tokens']['post']['requestBody']>['content']['application/json']
export type DestinoHorus = paths['/api/v1/integraciones/horus/abrir']['post']['requestBody']['content']['application/json']['destino']

/**
 * Lo último que el panel sabe del conector: `activo`/`apagado` por `GET /integraciones/horus`
 * (con `horus.ver`) o por un 422 `horus_apagado` de "Ver en Horus"; `null` = no se sabe (sin
 * `horus.ver`, o todavía no se leyó). Lo comparten la configuración y los botones "Ver en Horus".
 */
export function useEstadoConectorHorus() {
    return useState<'activo' | 'apagado' | null>('horus:conector', () => null)
}

/**
 * Hasta cuándo está Horus en pausa por la espera exponencial (`reintentar_en`, UTC), según la
 * última respuesta que lo dijo; `null` = sin pausa conocida.
 */
export function usePausaHorus() {
    return useState<string | null>('horus:pausa', () => null)
}

/**
 * Integración con Horus Flow (A1 + A6, `contratos/horus.md` 1.2.0): conector, enlace de conexión
 * (§1.4), token `atk_` para Horus (§1.2), "Ver en Horus" (§1.5) y los datos de Horus por servicio
 * (§3.1, §3.5). El navegador nunca pide tickets ni ve secretos: solo la URL que devuelve la API y
 * los valores que la API muestra una sola vez.
 */
export function useHorus() {
    const api = useApi()
    const estado = useEstadoConectorHorus()
    const pausa = usePausaHorus()

    function recordar<T extends { activo: boolean }>(resultado: Resultado<T>): Resultado<T> {
        if (resultado.ok) {
            estado.value = resultado.data.activo ? 'activo' : 'apagado'
        }
        return resultado
    }

    /** `GET /integraciones/horus` (`horus.ver`): secretos como `***`, `version: 0` si nunca se guardó. */
    async function conector(): Promise<Resultado<ConectorHorus>> {
        return recordar(await resolver(api.GET('/api/v1/integraciones/horus')))
    }

    /**
     * `GET /integraciones/horus/estado` (`horus.abrir`, sin `horus.ver`): si "Ver en Horus" puede
     * funcionar (encendido, con URL y código) y la pausa de Horus. Sin secretos.
     */
    async function estadoParaAbrir(): Promise<Resultado<EstadoConectorHorus>> {
        const resultado = await resolver(api.GET('/api/v1/integraciones/horus/estado'))
        if (resultado.ok) {
            estado.value = resultado.data.activo ? 'activo' : 'apagado'
            pausa.value = resultado.data.reintentar_en
        }
        return resultado
    }

    /** Lee el estado una vez por sesión del panel, antes del primer clic en "Ver en Horus". */
    async function conocerEstado(): Promise<void> {
        if (estado.value === null && usePermisos().puede('horus.abrir')) {
            await estadoParaAbrir()
        }
    }

    /**
     * `PUT /integraciones/horus` (`horus.configurar`) con la `version` leída (409 si cambió). El
     * primer guardado o `regenerar_secreto_entrada` trae `webhook_entrada_secreto_nuevo` en claro,
     * una sola vez.
     */
    async function guardar(cambios: CambiosConectorHorus): Promise<Resultado<ConectorHorusGuardado>> {
        return recordar(await resolver(api.PUT('/api/v1/integraciones/horus', { body: cambios })))
    }

    /** `POST /integraciones/horus/probar` (`horus.probar`): 200 aunque falle, con el error real. */
    function probar(): Promise<Resultado<ResultadoPruebaHorus>> {
        return resolver(api.POST('/api/v1/integraciones/horus/probar'))
    }

    /** `POST /integraciones/horus/enlace` (`horus.configurar`): 15 min, un uso, se muestra una vez. */
    function generarEnlace(): Promise<Resultado<EnlaceConexionHorus>> {
        return resolver(api.POST('/api/v1/integraciones/horus/enlace'))
    }

    /** `POST /integraciones/horus/conexion/conectar` con el enlace de Horus; 422 `enlace_vencido`, 502 `horus_error`. */
    async function conectarConEnlace(enlace: string): Promise<Resultado<ConectorHorus>> {
        return recordar(await resolver(api.POST('/api/v1/integraciones/horus/conexion/conectar', { body: { enlace } })))
    }

    /** `GET /integraciones/horus/tokens` (`horus.ver`): sin su valor, los más nuevos primero. */
    function tokens(): Promise<Resultado<TokenApi[]>> {
        return resolver(api.GET('/api/v1/integraciones/horus/tokens'))
    }

    /** `POST /integraciones/horus/tokens` (`horus.generar_token`): el `atk_` se muestra una sola vez. */
    function generarToken(datos: DatosTokenHorus): Promise<Resultado<TokenHorusCreado>> {
        return resolver(api.POST('/api/v1/integraciones/horus/tokens', { body: datos }))
    }

    /** `POST /integraciones/horus/tokens/:id/revocar` (`horus.revocar_token`). */
    function revocarToken(id: number): Promise<Resultado<TokenApi>> {
        return resolver(api.POST('/api/v1/integraciones/horus/tokens/{id}/revocar', { params: { path: { id } } }))
    }

    /**
     * "Ver en Horus" (`horus.abrir`): el servidor de Argos pide el ticket a Horus y devuelve solo la
     * URL (60 s, un uso). Un 422 `horus_apagado` deja el conector como apagado.
     */
    async function abrir(destino: DestinoHorus): Promise<Resultado<TicketHorus>> {
        const resultado = await resolver(api.POST('/api/v1/integraciones/horus/abrir', { body: { destino } }))
        if (!resultado.ok && esHorusApagado(resultado.problema)) {
            estado.value = 'apagado'
        }
        if (!resultado.ok) {
            pausa.value = reintentarEnDe(resultado.problema)
        }
        return resultado
    }

    /** `GET /servicios/:id/horus` (`horus.ver`): nunca bloquea; con Horus caído, el último dato con `stale`. */
    async function servicio360(id: number): Promise<Resultado<Horus360Servicio>> {
        const resultado = await resolver(api.GET('/api/v1/servicios/{id}/horus', { params: { path: { id } } }))
        if (resultado.ok) {
            estado.value = resultado.data.conector
            pausa.value = resultado.data.reintentar_en
        }
        return resultado
    }

    /** `POST /integraciones/horus/seguridad` (`horus.ver`, máx. 500): la columna "Seguridad" de una lista. */
    function seguridad(servicioIds: number[]): Promise<Resultado<SeguridadHorus>> {
        return resolver(api.POST('/api/v1/integraciones/horus/seguridad', { body: { servicio_ids: servicioIds.slice(0, 500) } }))
    }

    return { estado, pausa, conector, estadoParaAbrir, conocerEstado, guardar, probar, generarEnlace, conectarConEnlace, tokens, generarToken, revocarToken, abrir, servicio360, seguridad }
}
