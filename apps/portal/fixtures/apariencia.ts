/**
 * `GET /api/v1/apariencia/publica` para el modo fixtures, tipado contra el contrato
 * (`contratos/apariencia.md` §3). `?tema=<preset>` en la URL (fixtures) prueba otro preset, con la
 * paleta del catálogo (§2) y un eslogan propio.
 */
import type { Schema } from '@argosisp/contracts'

type Publica = Schema<'AparienciaPublica'>

const PALETAS: Record<Publica['tema'], Publica['paleta']> = {
    indigo: { color: 'indigo', claro: '#4F46E5', oscuro: '#818CF8' },
    azul: { color: 'blue', claro: '#2563EB', oscuro: '#60A5FA' },
    violeta: { color: 'violet', claro: '#7C3AED', oscuro: '#A78BFA' },
    esmeralda: { color: 'emerald', claro: '#047857', oscuro: '#34D399' },
    naranja: { color: 'orange', claro: '#C2410C', oscuro: '#FB923C' },
    rosa: { color: 'pink', claro: '#BE185D', oscuro: '#F472B6' },
    pizarra: { color: 'slate', claro: '#475569', oscuro: '#94A3B8' },
}

export const APARIENCIA_FIXTURE: Publica = {
    tema: 'indigo',
    paleta: PALETAS.indigo,
    modo_predeterminado: 'sistema',
    nombre_marca: 'ArgosIsp',
    eslogan: null,
    logo_login_url: null,
    fondo_login_url: null,
    version: 1,
}

/** Con otro preset y eslogan propio (capturas y pruebas del tema). */
export function aparienciaFixture(tema: Publica['tema'] | null): Publica {
    return tema && tema !== 'indigo'
        ? { ...APARIENCIA_FIXTURE, tema, paleta: PALETAS[tema], eslogan: 'Internet que te acompaña en cada pago.', version: 2 }
        : APARIENCIA_FIXTURE
}
