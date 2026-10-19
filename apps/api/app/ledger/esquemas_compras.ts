import {
    Dinero,
    auditable,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { esquemaReporte } from '#billing/reportes/definicion'
import { COLUMNAS_LIBRO_COMPRAS } from '#fiscal/libros'
import { TIPOS_DOCUMENTO_COMPRA, TIPOS_LINEA_COMPRA } from '#ledger/compras'
import { REGIMENES_PROVEEDOR, TIPOS_DOCUMENTO_PROVEEDOR, TIPOS_PROVEEDOR } from '#ledger/proveedores'
import { COLUMNAS_CXP } from '#ledger/pagos_proveedores'

/**
 * Schemas de respuesta de proveedores y compras (contrato de localización fiscal §3.4, fase 5).
 */

export const Proveedor = definirEsquema(
    'Proveedor',
    objeto({
        id,
        empresa_id: id,
        tipo_documento: enumerado(TIPOS_DOCUMENTO_PROVEEDOR),
        nit: { ...texto, description: 'Documento normalizado (sin guion, mayúsculas)' },
        nombre: texto,
        tipo: enumerado(TIPOS_PROVEEDOR),
        regimen_isr: nulable(enumerado(REGIMENES_PROVEEDOR)),
        agente_retencion_iva: booleano,
        pais: texto,
        direccion: nulable(texto),
        correo: nulable(texto),
        telefono: nulable(texto),
        dias_credito: entero,
        activo: booleano,
        saldo: { ...Dinero, description: 'Saldo de su auxiliar en 2.1.03 (lo que la empresa le debe)' },
        ...auditable,
    }),
)

const LineaCompra = definirEsquema(
    'LineaCompra',
    objeto({
        id,
        descripcion: texto,
        tipo: enumerado(TIPOS_LINEA_COMPRA),
        cuenta_id: id,
        cuenta_codigo: texto,
        exento: booleano,
        base: Dinero,
        iva: Dinero,
        clase_activo: nulable(texto),
        diferir_meses: nulable(entero),
    }),
)

const RetencionCompra = definirEsquema(
    'RetencionCompra',
    objeto({
        impuesto_codigo: texto,
        impuesto: enumerado(['iva', 'isr']),
        base: Dinero,
        tasa: { ...texto, description: 'Por ciento (texto exacto de fiscal.impuestos)' },
        monto: Dinero,
    }),
)

export const Compra = definirEsquema(
    'Compra',
    objeto({
        id,
        empresa_id: id,
        proveedor_id: id,
        proveedor_nombre: texto,
        proveedor_nit: texto,
        tipo_documento: enumerado(TIPOS_DOCUMENTO_COMPRA),
        serie: texto,
        numero: texto,
        autorizacion: nulable(texto),
        fecha_documento: fecha,
        periodo_iva: { ...fecha, description: 'Primer día del mes del libro de compras (crédito fiscal)' },
        fecha: { ...fecha, description: 'Fecha contable del asiento: max(fecha_documento, periodo_iva)' },
        condicion: enumerado(['contado', 'credito']),
        vence_en: nulable(fecha),
        base_bienes: Dinero,
        base_servicios: Dinero,
        base_importaciones: Dinero,
        exento: Dinero,
        iva: Dinero,
        total: Dinero,
        credito_fiscal: booleano,
        retencion_iva: Dinero,
        retencion_isr: Dinero,
        neto: { ...Dinero, description: 'total − retenciones: lo que se paga al proveedor' },
        saldo: {
            ...Dinero,
            description: 'Pendiente de pago (crédito vigente); 0 en contado, NCRE y anuladas',
        },
        compra_referencia_id: nulable(id),
        egreso_id: { ...nulable(id), description: 'Egreso existente desde el que se registró' },
        egreso_pago_id: { ...nulable(id), description: 'Egreso que la pagó al contado' },
        descripcion: nulable(texto),
        asiento_id: nulable(id),
        estado: enumerado(['vigente', 'anulada']),
        anulado_en: nulable(instante),
        anulado_por: nulable(id),
        motivo_anulacion: nulable(texto),
        asiento_reverso_id: nulable(id),
        registrado_por: nulable(id),
        created_at: instante,
        lineas: lista(LineaCompra),
        retenciones: lista(RetencionCompra),
    }),
)

export const ReporteLibroCompras = esquemaReporte('ReporteLibroCompras', COLUMNAS_LIBRO_COMPRAS)

export const CuadreCompras = definirEsquema(
    'CuadreCompras',
    objeto({
        empresa_id: id,
        periodo: { ...texto, description: 'YYYY-MM' },
        libro: { ...Dinero, description: 'Crédito fiscal del libro de compras del mes' },
        cuenta: { ...Dinero, description: 'Movimiento de 1.1.04 de los asientos de compras del mes' },
        diferencia: Dinero,
        cuadra: booleano,
    }),
)

export const Constancia = definirEsquema(
    'ConstanciaRetencion',
    objeto({
        id,
        empresa_id: id,
        direccion: {
            ...enumerado(['recibida', 'emitida']),
            description: 'recibida de un cliente (con su pago) o emitida a un proveedor (con su compra)',
        },
        impuesto: enumerado(['iva', 'isr']),
        impuesto_codigo: texto,
        numero: texto,
        fecha,
        monto: Dinero,
        pago_id: nulable(id),
        cliente_id: nulable(id),
        cliente_nombre: nulable(texto),
        compra_id: nulable(id),
        proveedor_id: nulable(id),
        proveedor_nombre: nulable(texto),
        vigente: { ...booleano, description: 'El pago o la compra sigue vigente' },
        registrado_por: nulable(id),
        created_at: instante,
    }),
)

export const PagoProveedor = definirEsquema(
    'PagoProveedor',
    objeto({
        id,
        empresa_id: id,
        proveedor_id: id,
        proveedor_nombre: texto,
        fecha,
        metodo: enumerado(['caja', 'banco', 'cuenta_bancaria']),
        caja_id: nulable(id),
        turno_id: {
            ...nulable(id),
            description: 'Turno de caja del que salió el efectivo (baja su esperado)',
        },
        banco_id: nulable(id),
        cuenta_bancaria_id: nulable(id),
        cuenta_id: id,
        cuenta_codigo: texto,
        monto: Dinero,
        referencia: nulable(texto),
        descripcion: nulable(texto),
        asiento_id: nulable(id),
        estado: enumerado(['registrado', 'anulado']),
        anulado_en: nulable(instante),
        motivo_anulacion: nulable(texto),
        asiento_reverso_id: nulable(id),
        registrado_por: nulable(id),
        created_at: instante,
        aplicaciones: lista(objeto({ compra_id: id, documento: texto, monto: Dinero })),
    }),
)

export const EstadoCuentaProveedor = definirEsquema(
    'EstadoCuentaProveedor',
    objeto({
        proveedor: Proveedor,
        desde: nulable(fecha),
        hasta: fecha,
        saldo_inicial: Dinero,
        movimientos: lista(
            objeto({
                asiento_id: id,
                fecha,
                tipo: enumerado(['compra', 'nota_credito', 'pago', 'anulacion', 'ajuste']),
                documento: texto,
                descripcion: texto,
                debe: Dinero,
                haber: Dinero,
                saldo: { ...Dinero, description: 'Lo que la empresa le debe después del movimiento' },
            }),
        ),
        saldo_final: { ...Dinero, description: 'Saldo del auxiliar en 2.1.03 al corte' },
        pendientes: lista(
            objeto({ compra_id: id, documento: texto, vence_en: fecha, saldo: Dinero, dias_vencida: entero }),
        ),
    }),
)

export const ReporteCuentasPorPagar = esquemaReporte('ReporteCuentasPorPagar', COLUMNAS_CXP)
