import type { RespuestaFixture } from '~/utils/fetchFixtures'
import { problemaTipado } from '../comun'

/** 422 `servicio_pendiente_instalacion` (`#core/instalacion` de A1). */
export function pendienteInstalacion(verbo?: string): RespuestaFixture {
    return problemaTipado(
        422,
        'servicio_pendiente_instalacion',
        'Regla de negocio',
        verbo
            ? `No se puede ${verbo} un servicio pendiente de instalación: actívalo con activar-instalacion o retíralo`
            : 'El servicio está pendiente de instalación: solo se activa con activar-instalacion o se retira',
    )
}
