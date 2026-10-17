import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { validarDocumentoFiscal, type TipoDocumentoFiscal } from '#core/nit_cui'
import { verCliente, type ClienteVista } from '#core/consultas/clientes'
import { vincularExterno, type IdExterno } from '#core/ids_externos'

export interface DatosCliente {
    nombre?: string
    tipo?: 'persona' | 'empresa'
    tipo_documento_fiscal?: TipoDocumentoFiscal
    nit_cui?: string | null
    nombre_fiscal?: string | null
    direccion_fiscal?: string | null
    pais_fiscal?: string
    agente_retencion_iva?: boolean
    sector_publico?: boolean
    email?: string | null
    telefono?: string | null
    movil?: string | null
    direccion?: string | null
    coordenadas?: string | null
    zona_id?: number | null
    campos_personalizados?: Record<string, unknown>
    canal_preferido?: 'correo' | 'telegram' | 'whatsapp'
    /** código del sistema anterior (importador); el estable `codigo` lo pone la base */
    codigo_externo?: string | null
}

export interface EntradaCrearCliente extends DatosCliente {
    nombre: string
    /** id en un sistema de origen (importador); 409 `externo_duplicado` si ya está vinculado */
    externo?: IdExterno
}

const CAMPOS_DOCUMENTO = ['tipo_documento_fiscal', 'nit_cui', 'pais_fiscal'] as const

/** Documento fiscal guardado del cliente que se edita. */
export interface DocumentoAnterior {
    tipo_documento_fiscal: TipoDocumentoFiscal
    nit_cui: string | null
    pais_fiscal: string
}

/**
 * Documento fiscal validado (`validarDocumentoFiscal`). En el alta siempre; al editar, solo si
 * llega alguno de `tipo_documento_fiscal`, `nit_cui` o `pais_fiscal`, combinado con lo guardado:
 * así un cliente migrado con `nit_cui_invalido` se puede editar en lo demás sin corregirlo, y al
 * corregirlo la marca se apaga. Sin tipo explícito se deduce del número, salvo en un pasaporte
 * (su número no tiene forma propia).
 */
function columnasDocumento(datos: DatosCliente, antes?: DocumentoAnterior): Record<string, unknown> {
    if (antes && CAMPOS_DOCUMENTO.every((campo) => datos[campo] === undefined)) return {}
    let tipo = datos.tipo_documento_fiscal
    if (!tipo && antes && (datos.nit_cui === undefined || antes.tipo_documento_fiscal === 'pasaporte')) {
        tipo = antes.tipo_documento_fiscal
    }
    const documento = validarDocumentoFiscal({
        tipo,
        valor: datos.nit_cui !== undefined ? datos.nit_cui : antes?.nit_cui,
        pais: datos.pais_fiscal ?? antes?.pais_fiscal,
    })
    return { ...documento, nit_cui_invalido: false }
}

/** Columnas de `core.clientes` que se escriben a partir de la entrada (documento fiscal validado). */
export async function columnasCliente(
    t: Transaccion,
    datos: DatosCliente,
    antes?: DocumentoAnterior,
): Promise<Record<string, unknown>> {
    const columnas: Record<string, unknown> = columnasDocumento(datos, antes)
    for (const [clave, valor] of Object.entries(datos)) {
        if (valor === undefined || (CAMPOS_DOCUMENTO as readonly string[]).includes(clave)) continue
        if (clave === 'campos_personalizados') columnas.campos_personalizados = JSON.stringify(valor)
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
 * Alta de cliente con datos fiscales (tipo de documento con NIT, CUI, pasaporte o CF validado,
 * nombre, dirección y país fiscal, agente de retención y sector público) y campos personalizados
 * libres (jsonb). El saldo no se guarda: es la suma de su auxiliar en el libro.
 *
 * `codigo` (`C-000455`) lo deriva la base del id al insertar y es inmutable; el código que traiga
 * el importador del sistema anterior va en `codigo_externo`.
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
