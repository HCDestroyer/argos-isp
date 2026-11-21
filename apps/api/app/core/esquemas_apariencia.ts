import {
    definirEsquema,
    entero,
    enumerado,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { IDS_TEMAS, MODOS } from '#core/apariencia'

/** Esquemas de apariencia (`contratos/apariencia.md`) y accesos rápidos (`contratos/accesos-rapidos.md`). */

const hex = { type: 'string', pattern: '^#[0-9A-F]{6}$' }

export const PaletaTema = definirEsquema(
    'PaletaTema',
    objeto({
        color: { ...texto, description: 'Color de Nuxt UI para `ui.colors.primary` (indigo, blue…)' },
        claro: { ...hex, description: 'Primario en modo claro (AA contra #FFFFFF)' },
        oscuro: { ...hex, description: 'Primario en modo oscuro (AA contra #0B0F1A)' },
    }),
)

const publica = {
    tema: enumerado(IDS_TEMAS),
    paleta: PaletaTema,
    modo_predeterminado: enumerado(MODOS),
    nombre_marca: texto,
    eslogan: nulable(texto),
    logo_login_url: {
        ...nulable(texto),
        description: 'Ruta relativa a la API (`/api/v1/apariencia/archivos/…`); cambia con el contenido',
    },
    fondo_login_url: nulable(texto),
    version: { type: 'integer', minimum: 1 },
}

export const AparienciaPublica = definirEsquema('AparienciaPublica', objeto(publica))

export const ArchivoApariencia = definirEsquema(
    'ArchivoApariencia',
    objeto({
        url: texto,
        tipo: enumerado(['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']),
        tamano: entero,
        etag: { ...texto, description: 'sha256 del contenido' },
    }),
)

export const TemaApariencia = definirEsquema(
    'TemaApariencia',
    objeto({ id: enumerado(IDS_TEMAS), nombre: texto, color: texto, claro: hex, oscuro: hex }),
)

export const Apariencia = definirEsquema(
    'Apariencia',
    objeto({
        ...publica,
        logo_login: nulable(ArchivoApariencia),
        fondo_login: nulable(ArchivoApariencia),
        temas: lista(TemaApariencia),
        updated_at: instante,
    }),
)

export const AccesosRapidos = definirEsquema(
    'AccesosRapidos',
    objeto({
        secciones: { ...lista(texto), description: 'Ids de sección del panel, en orden' },
        predeterminados: {
            type: 'boolean',
            description: 'true: el usuario no guardó su lista y esta es la sugerida por sus roles',
        },
        maximo: { type: 'integer', description: 'Máximo de accesos (12)' },
        version: { type: ['integer', 'null'], description: 'null con predeterminados' },
    }),
)
