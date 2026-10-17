import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { exigirAlcance, type Alcance } from '#core/acl'
import { listarEmpresas } from '#core/empresas'
import { EmpresaNoPermitida } from '#shared/empresa_activa'
import { NoEncontrado } from '#shared/errores'
import type { MetodoPago } from '#shared/eventos'
import { verPago, type PagoVista } from '#billing/pagos'

/**
 * Cobro repartido por empresa (`GET /cobros/:id`): el cobro de caja que cubrió facturas de varias
 * empresas se registró como un pago por empresa (`billing.pagos.cobro_id`). El recibo lleva una
 * sección por empresa con su marca (logo, razón social, NIT, dirección) y su pago.
 */

export interface EmpresaRecibo {
    id: number
    nombre_comercial: string
    razon_social: string | null
    nit: string | null
    direccion_fiscal: string | null
    telefono: string | null
    correo: string | null
    logo_url: string | null
}

export interface CobroVista {
    id: number
    cliente_id: number
    cliente_nombre: string
    metodo: MetodoPago
    monto: string
    registrado_por: number | null
    created_at: Date
    secciones: Array<{ empresa: EmpresaRecibo; pago: PagoVista }>
}

/**
 * `permitidas`: empresas del alcance del usuario (null = todas). Las secciones de otras empresas
 * no se muestran; si no queda ninguna, 403 `empresa_no_permitida`.
 */
export async function verCobro(
    id: number,
    permitidas: number[] | null = null,
    alcance?: Alcance,
    cliente: QueryClientContract = db.connection(),
): Promise<CobroVista> {
    const cobro = (await cliente
        .from('billing.cobros as k')
        .join('core.clientes as c', 'c.id', 'k.cliente_id')
        .where('k.id', id)
        .select(
            'k.id',
            'k.cliente_id',
            'c.nombre as cliente_nombre',
            'k.metodo',
            'k.monto',
            'k.registrado_por',
            'k.created_at',
        )
        .first()) as Omit<CobroVista, 'secciones'> | null
    if (!cobro) throw new NoEncontrado(`El cobro ${id} no existe`)

    const pagos = (await cliente
        .from('billing.pagos')
        .where('cobro_id', id)
        .orderBy('empresa_id', 'asc')
        .select('id', 'empresa_id', 'caja_id')) as Array<{
        id: number
        empresa_id: number
        caja_id: number | null
    }>
    const visibles = pagos.filter((p) => permitidas === null || permitidas.includes(Number(p.empresa_id)))
    if (visibles.length === 0) throw new EmpresaNoPermitida(Number(pagos[0]?.empresa_id ?? 0))
    for (const pago of visibles) exigirAlcance(alcance, { caja: [pago.caja_id] })

    const empresas = await listarEmpresas({ ids: visibles.map((p) => Number(p.empresa_id)) }, cliente)
    const secciones = []
    for (const pago of visibles) {
        const e = empresas.find((x) => x.id === Number(pago.empresa_id))!
        secciones.push({
            empresa: {
                id: e.id,
                nombre_comercial: e.nombre_comercial,
                razon_social: e.razon_social,
                nit: e.nit,
                direccion_fiscal: e.direccion_fiscal,
                telefono: e.telefono,
                correo: e.correo,
                logo_url: e.logo_url,
            },
            pago: await verPago(pago.id, cliente),
        })
    }
    return { ...cobro, secciones }
}
