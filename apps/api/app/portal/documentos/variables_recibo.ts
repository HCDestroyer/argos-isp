import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Alcance } from '#core/acl'
import { dec } from '#ledger/dinero'
import { verCobro } from '#billing/cobros_vista'
import type { MetodoPago } from '#shared/eventos'
import { ZONA, fechaCalendario, fechaHora, mesAnio, quetzales } from '#notify/formato'
import { COLUMNAS_DTE, dteDeFila, joinDteFactura, numeroDocumento, type ColumnasDte } from '#portal/fel'
import { EMPRESA_PRINCIPAL } from '#core/empresas'
import { empresaDocumento, type EmpresaDocumento } from '#portal/documentos/variables'

/**
 * Variables del recibo de un cobro de caja (`tipo = recibo_cobro`). Los datos salen de
 * `verCobro` (A3, `GET /cobros/:id`): un pago por empresa, cada uno con su marca. Montos ya en
 * quetzales (`decimal.js`), fechas en `America/Guatemala`.
 *
 * `{{empresa.*}}` es la empresa de la primera sección (la del encabezado y el logo); dentro de
 * `{{#secciones}}` cada `{{empresa.*}}` es la de su sección.
 */

export interface SeccionRecibo {
    empresa: Pick<EmpresaDocumento, 'nombre' | 'razon_social' | 'nit' | 'direccion' | 'telefono'>
    pago: { numero: string; metodo: string; monto: string; referencia: string | null; anulado: boolean }
    aplicaciones: Array<{ documento: string; numero: string; periodo: string; monto: string }>
    tiene_anticipo: boolean
    anticipo: string | null
}

export interface VistaReciboCobro {
    empresa: EmpresaDocumento
    /** id de la empresa del encabezado (no es variable de la plantilla) */
    empresa_id?: number
    cliente: { nombre: string; nit: string }
    cobro: {
        id: number
        numero: string
        fecha: string
        metodo: string
        total: string
        cajero: string | null
        empresas: number
        varias_empresas: boolean
    }
    secciones: SeccionRecibo[]
    generado: string
}

export const VARIABLES_RECIBO_COBRO: ReadonlyArray<{ nombre: string; descripcion: string }> = [
    { nombre: 'empresa.nombre', descripcion: 'Nombre comercial de la empresa del encabezado (la primera)' },
    { nombre: 'empresa.razon_social', descripcion: 'Razón social de la empresa' },
    { nombre: 'empresa.nit', descripcion: 'NIT de la empresa' },
    { nombre: 'empresa.direccion', descripcion: 'Dirección fiscal de la empresa' },
    { nombre: 'empresa.telefono', descripcion: 'Teléfono de atención' },
    {
        nombre: 'empresa.logo',
        descripcion: 'Sección: la empresa tiene logo. Se dibuja con <img src="empresa:logo" height="48">',
    },
    { nombre: 'cliente.nombre', descripcion: 'Nombre fiscal (o nombre) del cliente que pagó' },
    { nombre: 'cliente.nit', descripcion: 'NIT o CUI del cliente; "CF" si no tiene' },
    { nombre: 'cobro.numero', descripcion: 'Número del cobro: "000123"' },
    { nombre: 'cobro.fecha', descripcion: 'Fecha y hora del cobro (Guatemala)' },
    { nombre: 'cobro.metodo', descripcion: 'Forma de pago: "Efectivo en caja", "Depósito bancario"…' },
    { nombre: 'cobro.total', descripcion: 'Total cobrado: "Q 350.00"' },
    { nombre: 'cobro.cajero', descripcion: 'Nombre de quien registró el cobro (vacío si fue el sistema)' },
    { nombre: 'cobro.empresas', descripcion: 'Cuántas empresas cubrió el cobro' },
    { nombre: 'cobro.varias_empresas', descripcion: 'Sección: el cobro pagó facturas de más de una empresa' },
    {
        nombre: 'secciones',
        descripcion:
            'Lista para {{#secciones}}: una por empresa, con empresa.*, pago.numero, pago.metodo, pago.monto, ' +
            'pago.referencia, pago.anulado, aplicaciones, tiene_anticipo y anticipo',
    },
    {
        nombre: 'aplicaciones',
        descripcion:
            'Dentro de una sección, lista para {{#aplicaciones}}: documento ("Aviso de cobro", "Factura"), ' +
            'numero, periodo y monto',
    },
    { nombre: 'generado', descripcion: 'Fecha y hora de generación (Guatemala)' },
]

const METODOS: Record<MetodoPago, string> = {
    caja: 'Efectivo en caja',
    deposito: 'Depósito bancario',
    transferencia: 'Transferencia',
    ach: 'ACH',
    remesa: 'Remesa',
    agente: 'Agente bancario',
    debito: 'Débito / tarjeta',
    pasarela: 'Pago en línea',
}

const TIPOS_DTE: Record<string, string> = {
    FACT: 'Factura',
    FCAM: 'Factura cambiaria',
    FPEQ: 'Factura',
    FESP: 'Factura especial',
    NDEB: 'Nota de débito',
}

function metodo(valor: string): string {
    return METODOS[valor as MetodoPago] ?? valor
}

function numeroCobro(id: number): string {
    return String(id).padStart(6, '0')
}

/**
 * Recibo de un cobro real, con las secciones de las empresas que el usuario puede ver
 * (`permitidas`, `alcance`: mismas reglas y errores que `GET /cobros/:id`).
 */
export async function variablesReciboCobro(
    cobroId: number,
    opciones: {
        permitidas?: number[] | null
        alcance?: Alcance
        cliente?: QueryClientContract
        ahora?: Date
    } = {},
): Promise<VistaReciboCobro> {
    const cliente = opciones.cliente ?? db.connection()
    const cobro = await verCobro(cobroId, opciones.permitidas ?? null, opciones.alcance, cliente)

    const pagador = (await cliente
        .from('core.clientes')
        .where('id', cobro.cliente_id)
        .select('nombre', 'nombre_fiscal', 'nit_cui')
        .first()) as { nombre: string; nombre_fiscal: string | null; nit_cui: string | null }
    const cajero = cobro.registrado_por
        ? ((await cliente
              .from('core.usuarios')
              .where('id', cobro.registrado_por)
              .select('nombre')
              .first()) as {
              nombre: string
          } | null)
        : null

    const facturaIds = cobro.secciones.flatMap((s) => s.pago.aplicaciones.map((a) => a.factura_id))
    const facturas = facturaIds.length
        ? ((await cliente
              .from('billing.facturas as f')
              .joinRaw(joinDteFactura('f'))
              .whereIn('f.id', facturaIds)
              .select(
                  'f.id',
                  'f.tipo',
                  cliente.raw(`to_char(f.periodo, 'YYYY-MM-DD') as periodo`),
                  ...COLUMNAS_DTE,
              )) as Array<Record<string, any>>)
        : []
    const porId = new Map(facturas.map((f) => [Number(f.id), f]))

    const secciones: SeccionRecibo[] = []
    for (const { empresa, pago } of cobro.secciones) {
        const datos = await empresaDocumento(empresa.id, cliente)
        const aplicado = pago.aplicaciones.reduce((suma, a) => suma.plus(a.monto), dec('0'))
        const anticipo = dec(pago.monto).minus(aplicado)
        secciones.push({
            empresa: {
                nombre: datos.nombre,
                razon_social: datos.razon_social,
                nit: datos.nit,
                direccion: datos.direccion,
                telefono: datos.telefono,
            },
            pago: {
                numero: numeroCobro(pago.id),
                metodo: metodo(pago.metodo),
                monto: quetzales(dec(pago.monto).toString()),
                referencia: pago.referencia,
                anulado: pago.estado === 'anulado',
            },
            aplicaciones: pago.aplicaciones.map((a) => {
                const fila = porId.get(Number(a.factura_id))
                const dte = fila ? dteDeFila(fila as ColumnasDte) : null
                return {
                    documento: dte ? (TIPOS_DTE[dte.tipo_dte] ?? 'Factura') : 'Aviso de cobro',
                    numero: numeroDocumento(Number(a.factura_id), dte),
                    periodo: !fila
                        ? ''
                        : fila.tipo === 'mora'
                          ? 'Recargo por mora'
                          : fila.periodo
                            ? mesAnio(fechaCalendario(fila.periodo))
                            : '',
                    monto: quetzales(dec(a.monto).toString()),
                }
            }),
            tiene_anticipo: anticipo.greaterThan(0),
            anticipo: anticipo.greaterThan(0) ? quetzales(anticipo.toString()) : null,
        })
    }

    const principal = cobro.secciones[0]!.empresa.id
    return {
        empresa: await empresaDocumento(principal, cliente),
        empresa_id: principal,
        cliente: { nombre: pagador.nombre_fiscal || pagador.nombre, nit: pagador.nit_cui || 'CF' },
        cobro: {
            id: cobro.id,
            numero: numeroCobro(cobro.id),
            fecha: fechaHora(cobro.created_at),
            metodo: metodo(cobro.metodo),
            // el total de lo que el usuario ve (sin las secciones de empresas fuera de su alcance)
            total: quetzales(
                cobro.secciones.reduce((suma, s) => suma.plus(s.pago.monto), dec('0')).toString(),
            ),
            cajero: cajero?.nombre ?? null,
            empresas: secciones.length,
            varias_empresas: secciones.length > 1,
        },
        secciones,
        generado: fechaHora(opciones.ahora ?? new Date()),
    }
}

/** Recibo de ejemplo (vista previa y validación al guardar): dos empresas si la instalación las tiene. */
export async function vistaReciboDeEjemplo(
    cliente?: QueryClientContract,
    empresaId: number = EMPRESA_PRINCIPAL,
): Promise<VistaReciboCobro> {
    const ahora = DateTime.now().setZone(ZONA)
    const empresa = await empresaDocumento(empresaId, cliente)
    const seccion: SeccionRecibo = {
        empresa: {
            nombre: empresa.nombre,
            razon_social: empresa.razon_social,
            nit: empresa.nit,
            direccion: empresa.direccion,
            telefono: empresa.telefono,
        },
        pago: {
            numero: '000845',
            metodo: METODOS.caja,
            monto: quetzales('350.00'),
            referencia: null,
            anulado: false,
        },
        aplicaciones: [
            {
                documento: 'Aviso de cobro',
                numero: '1203',
                periodo: mesAnio(ahora),
                monto: quetzales('175.00'),
            },
            {
                documento: 'Aviso de cobro',
                numero: '1190',
                periodo: mesAnio(ahora.minus({ months: 1 })),
                monto: quetzales('150.00'),
            },
        ],
        tiene_anticipo: true,
        anticipo: quetzales('25.00'),
    }
    return {
        empresa,
        empresa_id: empresaId,
        cliente: { nombre: 'María José García López', nit: '1234567-8' },
        cobro: {
            id: 512,
            numero: '000512',
            fecha: fechaHora(ahora.toJSDate()),
            metodo: METODOS.caja,
            total: quetzales('350.00'),
            cajero: 'Ana Pérez',
            empresas: 1,
            varias_empresas: false,
        },
        secciones: [seccion],
        generado: fechaHora(ahora.toJSDate()),
    }
}
