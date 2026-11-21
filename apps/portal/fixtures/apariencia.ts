/**
 * `GET /api/v1/apariencia/publica` para el modo fixtures (forma del contrato de A6,
 * `contratos/apariencia.md`). `?tema=<preset>` en la URL (fixtures) prueba otro preset.
 */
import type { AparienciaPublica, PresetTema } from '~/utils/apariencia'

export const APARIENCIA_FIXTURE: AparienciaPublica = {
    tema: 'indigo',
    modo_predeterminado: 'sistema',
    nombre_marca: null,
    eslogan: null,
    logo_login_url: null,
    fondo_login_url: null,
}

/** Con otro preset y eslogan propio (capturas y pruebas del tema). */
export function aparienciaFixture(preset: PresetTema | null): AparienciaPublica {
    return preset && preset !== 'indigo'
        ? { ...APARIENCIA_FIXTURE, tema: preset, eslogan: 'Internet que te acompaña en cada pago.' }
        : APARIENCIA_FIXTURE
}
