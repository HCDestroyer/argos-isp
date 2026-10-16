import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { normalizarNitCui } from '#core/nit_cui'
import { verCliente, type ClienteVista } from '#core/consultas/clientes'
import { vincularExterno, type IdExterno } from '#core/ids_externos'

export interface DatosCliente {
    nombre?: string
    tipo?: 'persona' | 'empresa'
    nit_cui?: string | null
    nombre_fiscal?: string | null
    direccion_fiscal?: string | null
    email?: string | null
    telefono?: string | null
    movil?: string | null
    direccion?: string | null
    coordenadas?: string | null
    zona_id?: number | null
    campos_personalizados?: Record<string, unknown>
    canal_preferido?: 'correo' | 'telegram' | 'whatsapp'
}

export interface EntradaCrearCliente extends DatosCliente {
    nombre: string
    /** id en un sistema de origen (importador); 409 `externo_duplicado` si ya está vinculado */
    externo?: IdExterno
}

/** Columnas de `core.clientes` que se escriben a partir de la entrada (NIT/CUI normalizado). */
export async function columnasCliente(t: Transaccion, datos: DatosCliente): Promise<Record<string, unknown>> {
    const columnas: Record<string, unknown> = {}
    for (const [clave, valor] of Object.entries(datos)) {
        if (valor === undefined) continue
        if (clave === 'nit_cui') columnas.nit_cui = normalizarNitCui(valor as string | null)
        else if (clave === 'campos_personalizados') columnas.campos_personalizados = JSON.stringify(valor)
        else columnas[clave] = valor
    }
    if (datos.zona_id) {
        const zona = await t.trx.from('core.zonas').where('id', datos.zona_id).select('id').first()
        if (!zona) {
            throw new ValidacionFallida([{ field: 'zona_id', message: 'La zona no existe', rule: 'exists' }])
        }
    }
    return columnas
}

/**
 * Alta de cliente con datos fiscales (NIT o CUI validado, nombre y dirección fiscal) y campos
 * personalizados libres (jsonb). El saldo no se guarda: es la suma de su auxiliar en el libro.
 */
export default class CrearCliente extends DomainAction<EntradaCrearCliente, ClienteVista> {
    readonly nombre = 'clientes.crear'

    protected async handle(input: EntradaCrearCliente, t: Transaccion): Promise<ClienteVista> {
        const { externo, ...datos } = input
        const columnas = await columnasCliente(t, datos)
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.clientes')
            .insert(columnas)
            .returning('id')) as Array<{
            id: number
        }>
        const id = fila!.id
        t.fijarEntidad('cliente', id)
        await vincularExterno(t.trx, 'cliente', id, externo)
        const cliente = await verCliente(id, t.trx)
        await t.registrarCambios({ tipo: 'cliente', id }, null, cliente)
        return cliente
    }
}
