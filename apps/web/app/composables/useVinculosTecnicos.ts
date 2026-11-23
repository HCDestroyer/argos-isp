import type { Schema } from '@argosisp/contracts'

export type VinculoTecnicoIris = Schema<'VinculoTecnicoIris'>
export type EstadoVinculoTecnico = VinculoTecnicoIris['estado']
export type ConciliacionVinculoTecnico = Schema<'ConciliacionVinculoTecnico'>

/**
 * Vínculos de los técnicos de Iris con su usuario de Argos (A3, contrato Iris 0.14.0 §6.6): llegan
 * por webhook y solo sirven para inventario (nunca autorizan cobros ni atención).
 */
export function useVinculosTecnicos() {
    const api = useApi()

    /** `GET /inventario/vinculos-tecnicos` (`inventario.ver`). */
    function listar(): Promise<Resultado<VinculoTecnicoIris[]>> {
        return resolver(api.GET('/api/v1/inventario/vinculos-tecnicos'))
    }

    /** `POST /inventario/vinculos-tecnicos/conciliar` (`inventario.sincronizar_vinculo_tecnico`): lee el técnico en Iris. */
    function conciliar(vinculo: Pick<VinculoTecnicoIris, 'empresa_id' | 'iris_usuario_id'>): Promise<Resultado<ConciliacionVinculoTecnico>> {
        return resolver(api.POST('/api/v1/inventario/vinculos-tecnicos/conciliar', { body: { empresa_id: vinculo.empresa_id, usuario_id: vinculo.iris_usuario_id } }))
    }

    return { listar, conciliar }
}
