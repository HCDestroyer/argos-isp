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
import { NOMBRES_REGLA } from '#billing/promesas'

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
    objeto(
        {
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
            por_defecto: {
                ...booleano,
                description:
                    'Plantilla de los servicios creados sin plantilla_facturacion_id (a lo sumo una)',
            },
            ...auditable,
        },
        ['por_defecto'],
    ),
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
            cliente_nombre: texto,
            servicio_id: nulable(id),
            periodo: fecha,
            clave_unica: texto,
            emitida_en: instante,
            vence_en: fecha,
            estado: EstadoFactura,
            subtotal: Dinero,
            iva: Dinero,
            total: Dinero,
            pagado: {
                ...Dinero,
                description: 'Lo cubierto de la factura: pagos, saldos a favor y notas de crédito',
            },
            acreditado: {
                ...Dinero,
                description: 'Parte de pagado que viene de notas de crédito (saldo = total − pagado)',
            },
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
        [
            'tipo',
            'factura_origen_id',
            'vencida_en',
            'anulada_en',
            'motivo_anulacion',
            'cliente_nombre',
            'acreditado',
        ],
    ),
)

export const NotaCredito = definirEsquema(
    'NotaCredito',
    objeto({
        id,
        factura_id: id,
        cliente_id: id,
        cliente_nombre: texto,
        servicio_id: nulable(id),
        fecha: { ...fecha, description: 'Fecha contable (Guatemala)' },
        subtotal: Dinero,
        iva: { ...Dinero, description: 'IVA acreditado, proporcional al de la factura' },
        monto: { ...Dinero, description: 'subtotal + iva' },
        motivo: texto,
        asiento_id: { ...nulable(id), description: 'Asiento nota_credito (Debe ingresos/IVA, Haber CxC)' },
        created_by: nulable(id),
        created_by_nombre: nulable(texto),
        created_at: instante,
    }),
)

export const FacturaDetalle = definirEsquema('FacturaDetalle', {
    allOf: [
        Factura,
        objeto(
            {
                lineas: lista(FacturaLinea),
                reglas_snapshot: jsonLibre,
                notas_credito: { ...lista(NotaCredito), description: 'Notas de crédito de la factura' },
            },
            ['notas_credito'],
        ),
    ],
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

export const NotaCreditoEmitida = definirEsquema('NotaCreditoEmitida', {
    allOf: [
        NotaCredito,
        objeto({
            factura: { ...FacturaDetalle, description: 'La factura con su nuevo saldo y estado' },
            servicios: {
                ...lista(ServicioEvaluado),
                description: 'Cómo quedó el servicio de la factura (reactivación inmediata)',
            },
        }),
    ],
})

export const Pago = definirEsquema(
    'Pago',
    objeto(
        {
            id,
            cliente_id: id,
            cliente_nombre: { ...texto, description: 'Nombre del pagador' },
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
                description:
                    'Solo al registrar o anular: cómo quedó cada servicio afectado (reactivación inmediata o nuevo corte)',
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
            historico: {
                ...booleano,
                description:
                    'Pago importado de otro sistema con su fecha original (created_at): no pasó por caja ni bancos',
            },
            ...auditable,
        },
        [
            'historico',
            'cliente_nombre',
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

const CANALES_PROMESA = ['portal', 'ia', 'operador', 'supervisor'] as const
const valorRegla = { type: ['string', 'number', 'boolean', 'null'] }

export const ReglaEvaluada = definirEsquema(
    'ReglaEvaluada',
    objeto(
        {
            regla: {
                ...enumerado(NOMBRES_REGLA),
                description: 'Nombre estable de la regla (contratos/promesas.md)',
            },
            ok: booleano,
            valor: { ...valorRegla, description: 'Lo medido (días, monto "0.00", cantidad, %)' },
            limite: { ...valorRegla, description: 'Límite aplicado (null = sin límite)' },
            origen: {
                ...enumerado(['general', ...CANALES_PROMESA]),
                description: 'general o el canal cuyo límite reemplazó al general',
            },
            detalle: { ...texto, description: 'Explicación para la pantalla' },
            aplica: {
                ...booleano,
                description: 'Solo en la simulación: false si la configuración no la exige',
            },
        },
        ['aplica'],
    ),
)

export const DeudaEvaluada = definirEsquema(
    'DeudaEvaluada',
    objeto({
        pendiente: Dinero,
        vencida: Dinero,
        pagado_pendientes: Dinero,
        facturas_vencidas: entero,
    }),
)

export const HistorialPromesas = definirEsquema(
    'HistorialPromesas',
    objeto({
        ventana: { ...entero, description: 'Cuántas promesas resueltas se miran' },
        resueltas: entero,
        cumplidas: entero,
        cumplimiento_pct: nulable(entero),
    }),
)

export const AprobacionPromesa = definirEsquema(
    'AprobacionPromesa',
    objeto({
        por: { ...nulable(id), description: 'Supervisor que aprobó' },
        en: instante,
        nota: nulable(texto),
    }),
)

export const CierrePromesa = definirEsquema(
    'CierrePromesa',
    objeto(
        {
            estado: enumerado(['cumplida', 'incumplida', 'cancelada', 'rechazada']),
            en: instante,
            motivo: { ...texto, description: 'Rechazo o cancelación (operador, o "venció sin aprobación")' },
            por: { ...nulable(id), description: 'Quién la rechazó o canceló' },
            pagado: { ...Dinero, description: 'Cumplida o incumplida: lo pagado mientras estuvo activa' },
            deuda_vencida: { ...Dinero, description: 'Cumplida o incumplida: deuda vencida al resolverse' },
        },
        ['motivo', 'por', 'pagado', 'deuda_vencida'],
    ),
)

export const EvaluacionPromesa = definirEsquema(
    'EvaluacionPromesa',
    objeto(
        {
            resultado: enumerado(['aprobada', 'rechazada', 'pendiente_aprobacion']),
            regla: {
                type: ['string', 'null'],
                enum: [...NOMBRES_REGLA, null],
                description:
                    'La primera que falló (rechazada), requiere_aprobacion (pendiente) o null (aprobada)',
            },
            motivo: texto,
            canal: enumerado(CANALES_PROMESA),
            evaluada_en: instante,
            reglas: {
                ...lista(ReglaEvaluada),
                description: 'Reglas revisadas en orden; termina en la que decidió',
            },
            deuda: DeudaEvaluada,
            historial: HistorialPromesas,
            siguiente_facturacion: nulable(fecha),
            aprobacion: { ...AprobacionPromesa, description: 'Al aprobar una pendiente' },
            cierre: { ...CierrePromesa, description: 'Al cumplirse, incumplirse, rechazarse o cancelarse' },
        },
        ['aprobacion', 'cierre'],
    ),
)

export const Promesa = definirEsquema(
    'Promesa',
    objeto(
        {
            id,
            servicio_id: id,
            cliente_id: id,
            cliente_nombre: texto,
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
            // la API ya responde siempre con la forma de EvaluacionPromesa; el campo sigue abierto
            // hasta que el panel migre sus fixtures (a3.md) y entonces pasa a nulable(EvaluacionPromesa)
            resultado_evaluacion: {
                ...nulable(jsonLibre),
                description:
                    'Forma estable: components.schemas.EvaluacionPromesa (Schema<"EvaluacionPromesa">). Por qué se aprobó, rechazó o quedó pendiente; ver contratos/promesas.md',
            },
            servicio: {
                ...ServicioEvaluado,
                description:
                    'Solo al crear o aprobar una promesa activa: cómo quedó el servicio (reactivación)',
            },
            ...auditable,
        },
        ['servicio', 'cliente_nombre'],
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
            verificado_por_nombre: { ...nulable(texto), description: 'Nombre de quien lo aprobó o rechazó' },
            verificado_en: nulable(instante),
            pago: { ...Pago, description: 'Solo al aprobar: el pago registrado (aplicaciones y servicios)' },
            ...auditable,
        },
        ['pago', 'verificado_por_nombre'],
    ),
)

export const ResumenComprobantes = definirEsquema(
    'ResumenComprobantes',
    objeto({
        total: { ...entero, description: 'Comprobantes que cumplen todos los filtros (todas las páginas)' },
        monto: { ...Dinero, description: 'Suma de sus montos' },
        pendientes: {
            ...entero,
            description: 'Pendientes con los demás filtros, sin importar estado (contador del menú)',
        },
        monto_pendiente: { ...Dinero, description: 'Suma de los montos pendientes' },
    }),
)

export const PaginaComprobantes = definirEsquema(
    'PaginaComprobantes',
    objeto({
        data: lista(Comprobante),
        nextCursor: { type: ['string', 'null'] },
        resumen: ResumenComprobantes,
    }),
)

/** Respuesta binaria: la foto o el PDF del comprobante. */
export const ArchivoComprobante = {
    type: 'string',
    format: 'binary',
    description:
        'Foto (image/jpeg, image/png, image/webp) o PDF. La respuesta real lleva el Content-Type del archivo ' +
        '(el generador de OpenAPI declara application/json)',
}

export const CobroPasarela = definirEsquema(
    'CobroPasarela',
    objeto(
        {
            id,
            proveedor: texto,
            id_proveedor: { ...nulable(texto), description: 'Id del cobro en el proveedor' },
            cliente_id: id,
            cliente_nombre: texto,
            servicio_id: nulable(id),
            monto: Dinero,
            facturas: lista(id),
            estado: enumerado(['pendiente', 'pagado', 'fallido', 'expirado']),
            url_pago: { ...nulable(texto), description: 'Adonde se manda al cliente para pagar' },
            url_retorno: {
                ...nulable(texto),
                description:
                    'Adonde el proveedor devuelve al cliente al terminar (ya con {cobro_id} resuelto)',
            },
            expira_en: nulable(instante),
            canal: texto,
            pago_id: { ...nulable(id), description: 'Pago registrado al llegar el webhook' },
            monto_pagado: nulable(Dinero),
            comision: Dinero,
            pagado_en: nulable(instante),
            conciliado_en: nulable(instante),
            ...auditable,
        },
        ['url_retorno'],
    ),
)

export const ResultadoWebhookPasarela = definirEsquema(
    'ResultadoWebhookPasarela',
    objeto(
        {
            recibido: booleano,
            duplicado: {
                ...booleano,
                description: 'El evento ya se había procesado (no se registra otro pago)',
            },
            id_evento: texto,
            cobro_id: nulable(id),
            pago_id: nulable(id),
            estado: texto,
            ignorado: { ...texto, description: 'cobro_desconocido o cobro_ya_pagado' },
        },
        ['ignorado'],
    ),
)

const DiferenciaConciliacion = objeto({
    tipo: enumerado([
        'pago_sin_registrar',
        'pago_sin_cobro_en_proveedor',
        'monto_distinto',
        'pago_anulado',
        'pago_sin_cobro',
        'error_consulta',
    ]),
    cobro_id: nulable(id),
    pago_id: nulable(id),
    id_proveedor: nulable(texto),
    nuestro: nulable(Dinero),
    proveedor: nulable(Dinero),
    detalle: texto,
})

export const ConciliacionPasarela = definirEsquema(
    'ConciliacionPasarela',
    objeto(
        {
            id,
            proveedor: texto,
            fecha,
            revisados: entero,
            conciliados: entero,
            cobros_conciliados: lista(id),
            diferencias: lista(DiferenciaConciliacion),
            ejecutado_por: nulable(id),
            created_at: instante,
        },
        ['ejecutado_por', 'created_at'],
    ),
)

export const ReglaSimulada = definirEsquema(
    'ReglaSimulada',
    objeto({
        regla: texto,
        ok: booleano,
        aplica: { ...booleano, description: 'false: la configuración no exige esta regla' },
        valor: { ...valorRegla, description: 'Lo medido (días, monto, cantidad, %)' },
        limite: { ...valorRegla, description: 'Límite aplicado (null = sin límite)' },
        origen: { ...texto, description: 'general o el canal cuyo límite reemplazó al general' },
        detalle: { ...texto, description: 'Explicación para la pantalla' },
    }),
)

export const SimulacionPromesa = definirEsquema(
    'SimulacionPromesa',
    objeto({
        servicio_id: id,
        cliente_id: id,
        canal: enumerado(['portal', 'ia', 'operador', 'supervisor']),
        vence_en: instante,
        monto: Dinero,
        evaluada_en: instante,
        resultado: {
            ...enumerado(['aprobada', 'rechazada', 'pendiente_aprobacion']),
            description: 'Lo que deciden las reglas (igual que al crear con estos datos)',
        },
        regla: { ...nulable(texto), description: 'Primera regla que falla o requiere_aprobacion' },
        motivo: texto,
        resultado_creacion: {
            ...enumerado(['aprobada', 'rechazada', 'pendiente_aprobacion', 'error']),
            description: 'error: crear respondería 422/409 por alguna validación',
        },
        reglas: { ...lista(ReglaSimulada), description: 'Todas las reglas, en el orden en que se evalúan' },
        validaciones: lista(
            objeto({
                campo: enumerado(['monto', 'vence_en', 'servicio_id']),
                ok: booleano,
                regla: texto,
                detalle: texto,
            }),
        ),
        deuda: objeto({
            pendiente: Dinero,
            vencida: Dinero,
            pagado_pendientes: Dinero,
            facturas_vencidas: entero,
        }),
        historial: objeto({
            ventana: entero,
            resueltas: entero,
            cumplidas: entero,
            cumplimiento_pct: nulable(entero),
        }),
        siguiente_facturacion: nulable(fecha),
        limites: objeto({
            habilitadas: booleano,
            permitido: booleano,
            requiere_aprobacion: booleano,
            plazo_max_dias: entero,
            fecha_maxima: { ...fecha, description: 'Último día en que puede vencer' },
            siguiente_facturacion: nulable(fecha),
            deuda_pendiente: Dinero,
            deuda_vencida: Dinero,
            deuda_maxima: nulable(Dinero),
            abono_requerido: Dinero,
            abono_pagado: Dinero,
            max_por_periodo: entero,
            en_periodo: entero,
        }),
        suspension_manual: {
            ...booleano,
            description: 'Suspendido a mano: la promesa no lo reactivaría',
        },
    }),
)
