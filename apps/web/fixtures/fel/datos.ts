import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { aplicarNotaCredito, type TablasNotaCredito } from '../facturacion/aplicarNotaCredito'

/**
 * FEL de los fixtures (A3, fase 3). Las formas salen de respuestas reales de la API con el
 * certificador falso (`pnpm demo:datos`, `PUT /fel/configuracion` obligatoria + falso, pagos y
 * `node ace fiscal:worker --una-vez`): configuración, credenciales sin secretos, DTE certificados,
 * NCRE, contingencia y anulación pendiente. La autorización es determinista por `identificador`,
 * como el proveedor falso.
 */

type Dte = Schema<'Dte'>
type ConfiguracionFel = Schema<'ConfiguracionFel'>
type Factura = Schema<'Factura'>
type Cliente = Schema<'Cliente'>

/** Una sustitución (`billing.sustituciones`). */
export interface SustitucionFixture {
    original_id: number
    nueva_id: number
    tipo: 'anulacion' | 'nota_credito'
    motivo: string
}

/** Credenciales guardadas: la vista sin secretos y si el certificador falso las rechaza (`llave = invalida`). */
export interface CredencialFixture {
    vista: Schema<'CredencialesFel'>
    rechaza: boolean
}

export interface FelFixtures {
    /** Configuración por empresa; sin entrada = `desactivada` con `version` 0 (como la API). */
    configuraciones: Record<number, Omit<ConfiguracionFel, 'credenciales'>>
    credenciales: CredencialFixture[]
    dte: Dte[]
    /** XML certificado por DTE. */
    xml: Record<number, string>
    sustituciones: SustitucionFixture[]
    /** Bitácora ante el certificador (`fiscal.dte_intentos`), solo inserción. */
    intentos: Schema<'DteIntento'>[]
    /** Ruptura simulada de la cadena de hash por empresa (`romperCadenaFixture`). */
    rupturas: Record<number, NonNullable<Schema<'IntegridadLibro'>['ruptura']>>
}

/** Errores que devuelve el certificador falso al rechazar (`controlFelFalso.errores`). */
export const ERROR_SAT_FALSO = 'Error de validación de la SAT (simulado)'

/** Hex determinista (no criptográfico) para autorizaciones y hashes de los fixtures. */
export function hexDe(texto: string, largo = 64): string {
    let salida = ''
    let semilla = 2166136261
    for (let vuelta = 0; salida.length < largo; vuelta++) {
        for (const caracter of `${texto}:${vuelta}`) {
            semilla ^= caracter.charCodeAt(0)
            semilla = Math.imul(semilla, 16777619) >>> 0
        }
        salida += semilla.toString(16).padStart(8, '0')
    }
    return salida.slice(0, largo)
}

/** Autorización, serie y número como `autorizacionDe` del proveedor falso. */
export function autorizacionFalsa(identificador: string): Pick<Dte, 'autorizacion' | 'serie' | 'numero'> {
    const h = hexDe(`falso:${identificador}`, 32).toUpperCase()
    return {
        autorizacion: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`,
        serie: h.slice(0, 8),
        numero: String(Number.parseInt(h.slice(8, 16), 16)),
    }
}

/** UUID v4 con forma real, determinista por semilla. */
export function identificadorDe(semilla: string): string {
    const h = hexDe(`id:${semilla}`, 32)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export function receptorDe(cliente: Cliente | undefined): Dte['receptor'] {
    const tipo = cliente?.tipo_documento_fiscal ?? (cliente?.nit_cui ? 'nit' : 'cf')
    return {
        tipo,
        id: tipo === 'cf' ? 'CF' : (cliente?.nit_cui ?? 'CF').replace('-', ''),
        nombre: cliente?.nombre_fiscal ?? cliente?.nombre ?? 'Consumidor final',
        direccion: cliente?.direccion_fiscal ?? cliente?.direccion ?? null,
        correo: cliente?.email ?? null,
    }
}

/** Un DTE recién creado (`pendiente`), como lo devuelve `POST /facturas/:id/certificar`. */
export function nuevoDte(datos: {
    id: number
    empresa_id: number
    documento_tipo: Dte['documento_tipo']
    documento_id: number
    tipo_dte: string
    receptor: Dte['receptor']
    referencia: Dte['referencia']
    total: string
    iva: string
    momento: string
    solicitud: Dte['solicitud']
    contingencia?: boolean
}): Dte {
    return {
        id: datos.id,
        empresa_id: datos.empresa_id,
        establecimiento_id: null,
        documento_tipo: datos.documento_tipo,
        documento_id: datos.documento_id,
        tipo_dte: datos.tipo_dte,
        estado: datos.contingencia ? 'contingencia' : 'pendiente',
        proveedor: 'falso',
        ambiente: 'pruebas',
        identificador: identificadorDe(`${datos.documento_tipo}:${datos.documento_id}:${datos.id}`),
        autorizacion: null,
        serie: null,
        numero: null,
        fecha_emision: datos.momento,
        certificado_en: null,
        receptor: datos.receptor,
        referencia: datos.referencia,
        total: datos.total,
        iva: datos.iva,
        contingencia: datos.contingencia ?? false,
        intentos: 0,
        proximo_intento: datos.contingencia ? null : datos.momento,
        ultimo_error: null,
        definitivo: false,
        solicitud: datos.solicitud,
        anulado_en: null,
        motivo_anulacion: null,
        version: 1,
        created_at: datos.momento,
        updated_at: datos.momento,
    }
}

/** XML certificado con la forma de `xml_gt.ts` (capturado del certificador falso). */
export function xmlDe(dte: Dte): string {
    const item = `<dte:Item BienOServicio="S" NumeroLinea="1"><dte:Cantidad>1</dte:Cantidad><dte:UnidadMedida>UNI</dte:UnidadMedida><dte:Descripcion>Servicio de internet</dte:Descripcion><dte:Total>${dte.total}</dte:Total></dte:Item>`
    return `<?xml version="1.0" encoding="UTF-8"?><dte:GTDocumento xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:dte="http://www.sat.gob.gt/dte/fel/0.2.0" Version="0.1"><dte:SAT ClaseDocumento="dte"><dte:DTE ID="DatosCertificados"><dte:DatosEmision ID="DatosEmision"><dte:DatosGenerales CodigoMoneda="GTQ" FechaHoraEmision="${dte.fecha_emision}" Tipo="${dte.tipo_dte}"/><dte:Receptor IDReceptor="${dte.receptor.id}" NombreReceptor="${dte.receptor.nombre}"/><dte:Items>${item}</dte:Items><dte:Totales><dte:TotalImpuestos><dte:TotalImpuesto NombreCorto="IVA" TotalMontoImpuesto="${dte.iva}"/></dte:TotalImpuestos><dte:GranTotal>${dte.total}</dte:GranTotal></dte:Totales></dte:DatosEmision></dte:DTE><dte:Certificacion><dte:NumeroAutorizacion Numero="${dte.numero ?? ''}" Serie="${dte.serie ?? ''}">${dte.autorizacion ?? ''}</dte:NumeroAutorizacion></dte:Certificacion></dte:SAT><ds:Signature>falsa</ds:Signature></dte:GTDocumento>`
}

/** `GET /fel/proveedores`, capturado de la API (`fel/configuracion.ts` de A3). */
export const proveedoresFel: Schema<'ProveedorFelCatalogo'>[] = [
    {
        codigo: 'infile',
        nombre: 'INFILE',
        campos_obligatorios: ['usuario_firma', 'llave_firma', 'usuario_api', 'llave_api'],
        campos_opcionales: ['correo_copia'],
        campos_visibles: ['usuario_firma', 'usuario_api', 'correo_copia'],
        ambientes: ['pruebas', 'produccion'],
        solo_pruebas: false,
        capacidades: { contingencia: false, consulta_nit: true, pdf: false },
    },
    {
        codigo: 'falso',
        nombre: 'Certificador de laboratorio (falso)',
        campos_obligatorios: ['usuario', 'llave'],
        campos_opcionales: [],
        campos_visibles: ['usuario'],
        ambientes: ['pruebas'],
        solo_pruebas: true,
        capacidades: { contingencia: true, consulta_nit: true, pdf: false },
    },
]

/** Una fila de `fiscal.dte_intentos`, como la registra el worker antes y después de enviar. */
export function registrarIntento(fel: FelFixtures, dte: Dte, operacion: Schema<'DteIntento'>['operacion'], resultado: string, momento: string, respuesta: Record<string, unknown> = {}): void {
    fel.intentos.push({
        id: fel.intentos.reduce((m, i) => Math.max(m, i.id), 0) + 1,
        dte_id: dte.id,
        operacion,
        enviado_en: momento,
        resultado,
        duracion_ms: resultado === 'enviando' ? 0 : 49,
        respuesta,
    })
}

/** Pasa un DTE a `certificado` como el worker con el proveedor falso. */
export function certificarDte(fel: FelFixtures, dte: Dte, momento: string): void {
    registrarIntento(fel, dte, 'certificar', 'enviando', momento)
    Object.assign(dte, {
        ...autorizacionFalsa(dte.identificador),
        estado: 'certificado',
        certificado_en: momento,
        intentos: dte.intentos + 1,
        proximo_intento: null,
        ultimo_error: null,
        version: dte.version + 1,
        updated_at: momento,
    })
    fel.xml[dte.id] = xmlDe(dte)
    registrarIntento(fel, dte, 'certificar', 'certificado', momento, { uuid: dte.autorizacion, repetido: false, resultado: true })
}

/** Copia los datos del DTE vigente en la factura (`fel_*`, `dte_id`), como la vista de la API. */
export function reflejarEnFactura(factura: Factura, dte: Dte | null): void {
    Object.assign(factura, {
        dte_id: dte?.id ?? null,
        fel_uuid: dte?.autorizacion ?? null,
        fel_serie: dte?.serie ?? null,
        fel_numero: dte?.numero ?? null,
        fel_estado: dte?.estado ?? null,
        fel_error: dte?.ultimo_error ?? null,
        tipo_dte: dte?.tipo_dte ?? factura.tipo_dte ?? null,
    })
}

/** Configuración de ArgosNet capturada de `GET /fel/configuracion` (obligatoria, certificador falso). */
function configuracionesIniciales(): FelFixtures['configuraciones'] {
    return {
        1: {
            empresa_id: 1,
            proveedor: 'falso',
            ambiente: 'pruebas',
            modo: 'obligatoria',
            contingencia_activa: false,
            contingencia_motivo: null,
            contingencia_desde: null,
            version: 2,
            updated_at: '2026-10-01T15:36:23.662Z',
        },
    }
}

function credencialesIniciales(): CredencialFixture[] {
    return [{
        vista: {
            id: 1,
            empresa_id: 1,
            proveedor: 'falso',
            ambiente: 'pruebas',
            campos_visibles: { usuario: 'argosnet' },
            probada_en: '2026-10-01T15:36:27.394Z',
            resultado_prueba: { ok: true, detalle: 'Credenciales válidas (proveedor falso)' },
            version: 1,
            updated_at: '2026-10-01T15:36:27.394Z',
        },
        rechaza: false,
    }]
}

/** Las tablas que siembra la FEL (las de `bd` al iniciar). */
export interface TablasFel extends TablasNotaCredito {
    fel: FelFixtures
}

/**
 * Siembra la FEL de ArgosNet (empresa 1, obligatoria con el falso):
 * - avisos pagados → DTE certificado (`certificar_al = pagar`), uno de ellos transmitido tras una contingencia;
 * - un aviso vencido → DTE `rechazado` definitivo (el cliente sin NIT pasa del límite de CF);
 * - otro vencido → `error_temporal` con reintento programado;
 * - un aviso del periodo en curso → `por_certificar` (plantilla «al emitir») con su DTE pendiente;
 * - una factura certificada con una NCRE que la SAT rechazó en definitivo (se anula la nota).
 * Los clientes de id más bajo (pruebas de cobro, promesas y libro) quedan intactos.
 */
export function sembrarFel(tablas: TablasFel): void {
    const fel = tablas.fel
    const deArgosNet = tablas.facturas
        .filter(f => (f.empresa_id ?? 1) === 1 && f.tipo !== 'mora')
        .sort((a, b) => b.cliente_id - a.cliente_id || a.id - b.id)
    let siguiente = 1
    const crear = (factura: Factura, solicitud: Dte['solicitud'], momento: string): Dte => {
        const dte = nuevoDte({
            id: siguiente++,
            empresa_id: factura.empresa_id ?? 1,
            documento_tipo: 'factura',
            documento_id: factura.id,
            tipo_dte: 'FACT',
            receptor: receptorDe(tablas.clientes.find(c => c.id === factura.cliente_id)),
            referencia: null,
            total: factura.total,
            iva: factura.iva,
            momento,
            solicitud,
        })
        fel.dte.push(dte)
        return dte
    }
    for (const factura of tablas.facturas) {
        Object.assign(factura, { sustituida_por: null, sustituye_a: null })
        Object.assign(factura, { aviso_cobro: (factura.empresa_id ?? 1) === 1, certificar_al: (factura.empresa_id ?? 1) === 1 ? 'pagar' : 'nunca', tipo_dte: null, dte_id: null, fel_error: null })
    }
    for (const factura of tablas.facturas.filter(f => (f.empresa_id ?? 1) === 2)) {
        Object.assign(factura, { aviso_cobro: false, certificar_al: null })
    }

    // Pagados: certificados al cubrirse (el primero, transmitido después de una contingencia).
    const pagadas = deArgosNet.filter(f => f.estado === 'pagada').slice(0, 6)
    pagadas.forEach((factura, indice) => {
        const momento = `${factura.periodo.slice(0, 8)}06T16:25:00.000Z`
        const dte = crear(factura, 'automatico', momento)
        if (indice === 0) {
            dte.contingencia = true
        }
        certificarDte(fel, dte, `${factura.periodo.slice(0, 8)}06T16:26:00.000Z`)
        reflejarEnFactura(factura, dte)
    })

    const vencidas = deArgosNet.filter(f => f.estado === 'vencida' && new Decimal(f.pagado).isZero())
    const rechazada = vencidas[0]
    if (rechazada) {
        const dte = crear(rechazada, 'manual', '2026-10-05T15:00:00.000Z')
        const limite = 'Q2500.00'
        Object.assign(dte, {
            estado: 'rechazado',
            definitivo: true,
            intentos: 1,
            proximo_intento: null,
            ultimo_error: `${ERROR_SAT_FALSO}: el receptor no coincide con el registro de la SAT (NIT). Límite de consumidor final ${limite}`,
            updated_at: '2026-10-05T15:00:30.000Z',
        })
        registrarIntento(fel, dte, 'certificar', 'enviando', '2026-10-05T15:00:29.000Z')
        registrarIntento(fel, dte, 'certificar', 'rechazado', '2026-10-05T15:00:30.000Z', { resultado: false, descripcion_errores: [ERROR_SAT_FALSO] })
        reflejarEnFactura(rechazada, dte)
    }
    const temporal = vencidas[1]
    if (temporal) {
        const dte = crear(temporal, 'manual', '2026-10-14T13:00:00.000Z')
        Object.assign(dte, {
            estado: 'error_temporal',
            intentos: 3,
            proximo_intento: '2026-10-15T14:00:00.000Z',
            ultimo_error: 'El certificador no respondió (tiempo agotado)',
            updated_at: '2026-10-14T13:15:00.000Z',
        })
        for (const minuto of ['00', '01', '06']) {
            registrarIntento(fel, dte, 'certificar', 'error_temporal', `2026-10-14T13:${minuto}:30.000Z`, { error: 'tiempo agotado' })
        }
        reflejarEnFactura(temporal, dte)
    }

    // Por certificar: obligatoria + «al emitir» → nace sin asiento ni evento, su DTE en cola.
    const porCertificar = deArgosNet.find(f => f.estado === 'emitida' && new Decimal(f.pagado).isZero() && f.periodo === '2026-10-01')
    if (porCertificar) {
        Object.assign(porCertificar, { estado: 'por_certificar', aviso_cobro: false, certificar_al: 'emitir' })
        // Sin asiento hasta certificarse (`facturas.confirmar_emision`).
        const asiento = tablas.asientos.findIndex(a => a.origen_tipo === 'factura' && a.origen_id === porCertificar.id)
        if (asiento >= 0) {
            tablas.asientos.splice(asiento, 1)
        }
        const dte = crear(porCertificar, 'automatico', porCertificar.emitida_en)
        reflejarEnFactura(porCertificar, dte)
    }

    // NCRE rechazada: factura certificada (manual) con una nota de crédito por línea cuya NCRE rechazó la SAT.
    const conNcre = vencidas[2]
    if (conNcre) {
        const dteFactura = crear(conNcre, 'manual', '2026-10-03T14:00:00.000Z')
        certificarDte(fel, dteFactura, '2026-10-03T14:01:00.000Z')
        reflejarEnFactura(conNcre, dteFactura)
        const nota = aplicarNotaCredito(tablas, conNcre, new Decimal('20.00'), 'Dos días sin servicio por falla de fibra', { id: 1, nombre: 'Ana Administradora' }, '2026-10-08T16:00:00.000Z')
        const ncre = nuevoDte({
            id: siguiente++,
            empresa_id: conNcre.empresa_id ?? 1,
            documento_tipo: 'nota_credito',
            documento_id: nota.id,
            tipo_dte: 'NCRE',
            receptor: dteFactura.receptor,
            referencia: { autorizacion: dteFactura.autorizacion ?? '', serie: dteFactura.serie, numero: dteFactura.numero, fecha: nota.fecha, motivo: nota.motivo },
            total: nota.monto,
            iva: nota.iva,
            momento: nota.created_at,
            solicitud: 'automatico',
        })
        Object.assign(ncre, { estado: 'rechazado', definitivo: true, intentos: 1, proximo_intento: null, ultimo_error: `${ERROR_SAT_FALSO}: la referencia no coincide con el documento original`, updated_at: '2026-10-08T16:01:00.000Z' })
        fel.dte.push(ncre)
        registrarIntento(fel, ncre, 'certificar', 'rechazado', '2026-10-08T16:01:00.000Z', { resultado: false, descripcion_errores: [ERROR_SAT_FALSO] })
    }
}

export function felInicial(): FelFixtures {
    return {
        configuraciones: configuracionesIniciales(),
        credenciales: credencialesIniciales(),
        dte: [],
        xml: {},
        sustituciones: [],
        intentos: [],
        rupturas: {},
    }
}
