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
    jsonLibre,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { METODOS_PAGO } from '#shared/eventos'

/**
 * Schemas de respuesta del módulo billing. Dinero siempre como string decimal (`Dinero`).
 */

const limitesCanal = objeto({
    permitido: booleano,
    requiere_aprobacion: { ...booleano, description: 'true → la promesa queda pendiente_aprobacion' },
    plazo_max_dias: nulable(entero),
    max_por_periodo: nulable(entero),
    deuda_maxima: nulable(Dinero),
})

export const ReglasPromesa = definirEsquema(
    'ReglasPromesa',
    objeto({
        habilitadas: booleano,
        max_por_periodo: { ...entero, description: 'Promesas por periodo de facturación' },
        max_por_periodo_buen_historial: {
            ...entero,
            description: 'Máximo si el cumplimiento reciente es >= buen_historial_pct',
        },
        buen_historial_pct: entero,
        historial_ventana: { ...entero, description: 'Últimas N promesas para medir el cumplimiento' },
        plazo_max_dias: entero,
        no_exceder_siguiente_facturacion: booleano,
        deuda_maxima: nulable(Dinero),
        abono_inicial_pct: { ...entero, description: 'Porcentaje de la deuda a pagar antes de la promesa' },
        antiguedad_minima_dias: entero,
        cumplimiento_minimo_pct: nulable(entero),
        bloqueo_tras_incumplida_dias: entero,
        canales: objeto({
            portal: limitesCanal,
            ia: limitesCanal,
            operador: limitesCanal,
            supervisor: limitesCanal,
        }),
    }),
)

export const PlantillaFacturacion = definirEsquema(
    'PlantillaFacturacion',
    objeto({
        id,
        nombre: texto,
        ciclo: enumerado(['dia_fijo', 'aniversario']),
        dia: nulable(entero),
        prorrateo: booleano,
        dias_gracia: entero,
        facturas_para_limitar: entero,
        facturas_para_cortar: entero,
        mora_tipo: enumerado(['ninguna', 'fija', 'porcentaje']),
        mora_valor: Dinero,
        mora_recurrente: booleano,
        hora_corte: {
            type: 'string',
            pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
            description: 'HH:MM hora de Guatemala',
        },
        certificar_al: enumerado(['emitir', 'pagar', 'nunca']),
        reglas_promesa: ReglasPromesa,
        ...auditable,
    }),
)

export const EstadoFactura = definirEsquema(
    'EstadoFactura',
    enumerado(['emitida', 'parcial', 'pagada', 'vencida', 'anulada']),
)

export const FacturaLinea = definirEsquema(
    'FacturaLinea',
    objeto({
        id,
        concepto: texto,
        tipo: enumerado(['servicio', 'producto', 'mora', 'otro']),
        cantidad: { type: 'string', description: 'Decimal con hasta 3 decimales' },
        precio_unitario: Dinero,
        gravable: booleano,
        iva: Dinero,
        total: Dinero,
    }),
)

export const Factura = definirEsquema(
    'Factura',
    objeto(
        {
            id,
            cliente_id: id,
            servicio_id: nulable(id),
            periodo: fecha,
            clave_unica: texto,
            emitida_en: instante,
            vence_en: fecha,
            estado: EstadoFactura,
            subtotal: Dinero,
            iva: Dinero,
            total: Dinero,
            pagado: Dinero,
            fel_uuid: nulable(texto),
            fel_serie: nulable(texto),
            fel_numero: nulable(texto),
            fel_estado: nulable(texto),
            tipo: {
                ...enumerado(['servicio', 'mora']),
                description: 'servicio = factura del periodo; mora = recargo por vencimiento de otra factura',
            },
            factura_origen_id: { ...nulable(id), description: 'Factura que originó la mora' },
            vencida_en: { ...nulable(instante), description: 'Cuándo se marcó vencida' },
            anulada_en: { ...nulable(instante), description: 'Cuándo se anuló' },
            motivo_anulacion: nulable(texto),
            ...auditable,
        },
        ['tipo', 'factura_origen_id', 'vencida_en', 'anulada_en', 'motivo_anulacion'],
    ),
)

export const FacturaDetalle = definirEsquema('FacturaDetalle', {
    allOf: [Factura, objeto({ lineas: lista(FacturaLinea), reglas_snapshot: jsonLibre })],
})

export const ResultadoGeneracion = definirEsquema(
    'ResultadoGeneracion',
    objeto(
        {
            generadas: entero,
            omitidas: { type: 'integer', description: 'Ya tenían factura del periodo' },
            facturas: lista(id),
            errores: { type: 'integer', description: 'Servicios que no se pudieron facturar (ver log)' },
        },
        ['errores'],
    ),
)

export const ResultadoVencimiento = definirEsquema(
    'ResultadoVencimiento',
    objeto({
        vencidas: { type: 'integer', description: 'Facturas que pasaron a vencida' },
        moras: { type: 'integer', description: 'Recargos de mora creados' },
        errores: { type: 'integer', description: 'Facturas que no se pudieron procesar (ver log)' },
    }),
)

export const ResultadoCorte = definirEsquema(
    'ResultadoCorte',
    objeto({
        horas: { ...lista(texto), description: 'Horas de corte procesadas (HH:MM; * = corte manual)' },
        evaluados: { type: 'integer', description: 'Servicios evaluados' },
        cambiados: { type: 'integer', description: 'Servicios que cambiaron de estado' },
        errores: { type: 'integer', description: 'Servicios que no se pudieron evaluar (ver log)' },
        vencimiento: nulable(ResultadoVencimiento),
    }),
)

export const AplicacionPago = definirEsquema(
    'AplicacionPago',
    objeto(
        {
            factura_id: id,
            monto: Dinero,
            cliente_id: {
                ...id,
                description: 'Dueño de la factura (pago de terceros: puede no ser el pagador)',
            },
            cliente_nombre: texto,
        },
        ['cliente_id', 'cliente_nombre'],
    ),
)

export const ServicioEvaluado = definirEsquema(
    'ServicioEvaluado',
    objeto({
        servicio_id: id,
        de: enumerado(['activo', 'limitado', 'suspendido', 'retirado']),
        estado: enumerado(['activo', 'limitado', 'suspendido', 'retirado']),
        cambiado: booleano,
        motivo: texto,
    }),
)

export const Pago = definirEsquema(
    'Pago',
    objeto(
        {
            id,
            cliente_id: id,
            metodo: enumerado([...METODOS_PAGO]),
            monto: Dinero,
            comision: Dinero,
            referencia: nulable(texto),
            caja_id: nulable(id),
            pasarela: nulable(texto),
            estado: enumerado(['registrado', 'pendiente_verificacion', 'anulado']),
            nota: nulable(texto),
            registrado_por: nulable(id),
            aplicaciones: lista(AplicacionPago),
            anulado_en: { ...nulable(instante), description: 'Cuándo se anuló' },
            motivo_anulacion: nulable(texto),
            servicios: {
                ...lista(ServicioEvaluado),
                description: 'Solo al registrar: cómo quedó cada servicio afectado (reactivación inmediata)',
            },
            banco_origen_id: { ...nulable(id), description: 'Banco de origen (transferencia, ach)' },
            banco_origen_nombre: nulable(texto),
            cuenta_bancaria_id: {
                ...nulable(id),
                description: 'Cuenta bancaria propia de destino (deposito, transferencia, ach, remesa)',
            },
            cuenta_bancaria_nombre: {
                ...nulable(texto),
                description: 'Banco y alias de la cuenta de destino',
            },
            ...auditable,
        },
        [
            'anulado_en',
            'motivo_anulacion',
            'servicios',
            'banco_origen_id',
            'banco_origen_nombre',
            'cuenta_bancaria_id',
            'cuenta_bancaria_nombre',
        ],
    ),
)

export const Promesa = definirEsquema(
    'Promesa',
    objeto(
        {
            id,
            servicio_id: id,
            cliente_id: id,
            vence_en: instante,
            monto: Dinero,
            estado: enumerado([
                'activa',
                'cumplida',
                'incumplida',
                'cancelada',
                'pendiente_aprobacion',
                'rechazada',
            ]),
            canal: enumerado(['portal', 'ia', 'operador', 'supervisor']),
            aprobada_por: nulable(id),
            resultado_evaluacion: {
                ...nulable(jsonLibre),
                description:
                    'resultado (aprobada/rechazada/pendiente_aprobacion), regla (la que falló o requiere_aprobacion), motivo, reglas[] revisadas, deuda, historial; aprobacion y cierre al aprobar/cerrar',
            },
            servicio: {
                ...ServicioEvaluado,
                description:
                    'Solo al crear o aprobar una promesa activa: cómo quedó el servicio (reactivación)',
            },
            ...auditable,
        },
        ['servicio'],
    ),
)

export const MovimientoEstadoCuenta = definirEsquema(
    'MovimientoEstadoCuenta',
    objeto({
        fecha: fecha,
        tipo: enumerado(['factura', 'pago', 'mora', 'nota_credito', 'ajuste']),
        referencia_id: id,
        descripcion: texto,
        cargo: Dinero,
        abono: Dinero,
        saldo: Dinero,
    }),
)

export const EstadoCuenta = definirEsquema(
    'EstadoCuenta',
    objeto(
        {
            cliente_id: id,
            saldo: { ...Dinero, description: 'Suma del auxiliar CxC del cliente (positivo = debe)' },
            saldo_a_favor: {
                ...Dinero,
                description: 'Anticipos del cliente sin aplicar (se aplican a las próximas facturas)',
            },
            facturas_pendientes: lista(Factura),
            movimientos: {
                ...lista(MovimientoEstadoCuenta),
                description: 'Auxiliar CxC por asiento, en orden contable; el último saldo es `saldo`',
            },
        },
        ['saldo_a_favor'],
    ),
)

export const Banco = definirEsquema('Banco', objeto({ id, nombre: texto, activo: booleano }))

export const CuentaBancaria = definirEsquema(
    'CuentaBancaria',
    objeto({
        id,
        banco_id: id,
        banco_nombre: texto,
        numero: texto,
        alias: texto,
        moneda: enumerado(['GTQ', 'USD']),
        activa: { ...booleano, description: 'Una cuenta inactiva no recibe pagos nuevos' },
        cuenta_id: { ...id, description: 'Subcuenta de 1.1.02 Bancos en el libro' },
        cuenta_codigo: texto,
        ...auditable,
    }),
)

export const Comprobante = definirEsquema(
    'Comprobante',
    objeto(
        {
            id,
            cliente_id: id,
            cliente_nombre: texto,
            servicio_id: nulable(id),
            metodo: enumerado(['deposito', 'transferencia', 'ach', 'remesa']),
            cuenta_bancaria_id: { ...id, description: 'Cuenta bancaria propia de destino' },
            cuenta_bancaria_nombre: { ...texto, description: 'Banco y alias de la cuenta de destino' },
            banco_origen_id: { ...nulable(id), description: 'Banco de origen (transferencia, ach)' },
            banco_origen_nombre: nulable(texto),
            referencia: texto,
            monto: Dinero,
            fecha_deposito: fecha,
            archivo_tipo: enumerado(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
            archivo_tamano: { ...entero, description: 'Bytes (máximo 5 MB)' },
            archivo_nombre: { ...nulable(texto), description: 'Nombre original del archivo subido' },
            canal: enumerado(['portal', 'panel']),
            nota: nulable(texto),
            estado: enumerado(['pendiente', 'aprobado', 'rechazado']),
            motivo_rechazo: nulable(texto),
            pago_id: { ...nulable(id), description: 'Pago creado al aprobarlo' },
            registrado_por: nulable(id),
            verificado_por: { ...nulable(id), description: 'Quién lo aprobó o rechazó' },
            verificado_en: nulable(instante),
            pago: { ...Pago, description: 'Solo al aprobar: el pago registrado (aplicaciones y servicios)' },
            ...auditable,
        },
        ['pago'],
    ),
)

/** Respuesta binaria: la foto o el PDF del comprobante. */
export const ArchivoComprobante = {
    type: 'string',
    format: 'binary',
    description:
        'Foto (image/jpeg, image/png, image/webp) o PDF. La respuesta real lleva el Content-Type del archivo ' +
        '(el generador de OpenAPI declara application/json)',
}
