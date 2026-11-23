import type { Schema } from '@argosisp/contracts'

export type IntentosRecuperacionDeUnidad = Schema<'IntentosRecuperacionDeUnidad'>
export type IntentoRecuperacionVerificado = Schema<'IntentoRecuperacionVerificado'>
export type DecisionIntentoRecuperacion = Schema<'DecisionIntentoRecuperacion'>

/**
 * Intentos de recuperación de un equipo con su verificación con Iris (A3, contrato Iris 0.14.0
 * §3.10 y §4.5): la pantalla de declaración verifica al abrir y una persona decide los intentos
 * anteriores a la verificación.
 */
export function useIntentosRecuperacion() {
    const api = useApi()

    /** `GET /inventario/unidades/:id/intentos-recuperacion` (`inventario.ver`). */
    function listar(unidadId: number): Promise<Resultado<IntentosRecuperacionDeUnidad>> {
        return resolver(api.GET('/api/v1/inventario/unidades/{id}/intentos-recuperacion', { params: { path: { id: unidadId } } }))
    }

    /** `POST …/intentos-recuperacion/verificar` (`inventario.verificar_operacion_iris`): consulta a Iris los pendientes. */
    function verificar(unidadId: number): Promise<Resultado<IntentosRecuperacionDeUnidad>> {
        return resolver(api.POST('/api/v1/inventario/unidades/{id}/intentos-recuperacion/verificar', { params: { path: { id: unidadId } } }))
    }

    /** `POST /inventario/intentos-recuperacion/:id/decidir` (`inventario.decidir_intento_recuperacion`); 409 `intento_ya_decidido`. */
    function decidir(intentoId: number, aceptar: boolean, motivo: string, clave: string): Promise<Resultado<DecisionIntentoRecuperacion>> {
        return resolver(api.POST('/api/v1/inventario/intentos-recuperacion/{id}/decidir', {
            params: { path: { id: intentoId }, header: { 'Idempotency-Key': clave } },
            body: { aceptar, motivo },
        }))
    }

    return { listar, verificar, decidir }
}
