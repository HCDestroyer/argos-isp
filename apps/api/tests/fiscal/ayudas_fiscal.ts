import db from '@adonisjs/lucid/services/db'
import type { ContextoAccion } from '#shared/contexto'
import { construirOpenApi } from '#shared/openapi/documento'
import ActualizarLocalizacion from '#fiscal/actions/actualizar_localizacion'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { contextoPrueba } from '#tests/ayudas'

/** Empresa nueva (core) con la localización GT instalada por la acción. */
export async function empresaInstalada(
    datos: Record<string, unknown> = {},
    ctx: ContextoAccion = contextoPrueba(),
) {
    const empresaId = await crearEmpresaFila(datos)
    const resultado = await new ActualizarLocalizacion().execute({ empresa_id: empresaId }, ctx)
    return { empresaId, resultado }
}

/** Filas de las tablas de la localización y del catálogo de cuentas. */
export async function conteos() {
    const tablas = [
        'ledger.cuentas',
        'fiscal.localizaciones',
        'fiscal.instalaciones',
        'fiscal.parametros',
        'fiscal.parametros_valores',
        'fiscal.impuestos',
        'fiscal.impuestos_versiones',
        'fiscal.establecimientos',
        'fiscal.frases',
    ]
    const salida: Record<string, number> = {}
    for (const tabla of tablas) {
        salida[tabla] = Number(((await db.from(tabla).count('* as n').first()) as { n: string }).n)
    }
    return salida
}

/** Eventos del outbox con ese nombre cuyo payload tiene `clave = valor`. */
export async function eventos(evento: string, clave: string, valor: unknown) {
    const filas = (await db
        .from('audit.outbox')
        .where('evento', evento)
        .whereRaw(`payload ->> ? = ?`, [clave, String(valor)])
        .orderBy('id', 'asc')
        .select('payload')) as Array<{ payload: Record<string, unknown> }>
    return filas.map((f) => f.payload)
}

type Esquema = { required?: string[]; properties?: Record<string, unknown> }

/** Esquemas del OpenAPI generado. */
export async function esquemas(): Promise<Record<string, Esquema>> {
    return JSON.parse(await construirOpenApi()).components.schemas
}

/** La respuesta trae todo lo obligatorio del esquema y nada fuera de él. */
export function exigirCampos(assert: any, esquema: Esquema, valor: Record<string, unknown>, nombre: string) {
    for (const campo of esquema.required ?? []) {
        assert.property(valor, campo, `${nombre}.${campo} es obligatorio en el OpenAPI y la API no lo envía`)
    }
    for (const campo of Object.keys(valor)) {
        assert.property(esquema.properties ?? {}, campo, `${nombre}.${campo} no está en el esquema`)
    }
}
