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
            retirada_en: {
                ...nulable(instante),
                description:
                    'Retirada (POST /plantillas-facturacion/:id/retirar): sigue facturando a sus servicios y no se asigna a nuevos; null si vigente',
            },
            retirada_por: nulable(id),
            motivo_retiro: nulable(texto),
            ...auditable,
        },
        ['por_defecto'],
    ),
)

export const EstadoFactura = definirEsquema(
    'EstadoFactura',
    enumerado([
        'por_certificar',
        'emitida',
        'parcial',
        'pagada',
        'vencida',
        'anulada',
        'castigada',
        'acreditada',
    ]),
)

export const FacturaLinea = definirEsquema(
    'FacturaLinea',
    objeto(
        {
            id,
            concepto: texto,
            tipo: enumerado(['servicio', 'producto', 'mora', 'otro', 'descuento']),
            cantidad: { type: 'string', description: 'Decimal con hasta 3 decimales' },
            precio_unitario: Dinero,
            gravable: booleano,
            iva: {
                ...Dinero,
                description: 'En una línea descuento, negativo: el IVA de la factura es el del neto',
            },
            total: { ...Dinero, description: 'En una línea descuento, negativo' },
            linea_id: {
                ...nulable(id),
                description: 'Solo en tipo descuento: la línea que descuenta (de la misma factura)',
            },
            descuento: { ...Dinero, description: 'Suma de los descuentos de esta línea (0.00 si no tiene)' },
            cuenta_codigo: {
                ...nulable(texto),
                description:
                    'Cuenta de ingreso de la línea (concepto de un cargo único); null = la de su tipo',
            },
        },
        ['linea_id', 'descuento', 'cuenta_codigo'],
    ),
)

export const Factura = definirEsquema(
    'Factura',
    objeto(
        {
            id,
            empresa_id: {
                ...id,
                description: 'Empresa (NIT) del documento (multiempresa)',
            },
            empresa_nombre: { ...texto, description: 'Nombre comercial de la empresa que emite' },
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
            fel_uuid: { ...nulable(texto), description: 'Autorización (UUID SAT) del DTE vigente' },
            fel_serie: nulable(texto),
            fel_numero: nulable(texto),
            fel_estado: {
                ...nulable(texto),
                description:
                    'Estado del DTE vigente (o del último rechazado): pendiente, certificado, error_temporal, rechazado, contingencia, anulacion_pendiente, anulado',
            },
            dte_id: { ...nulable(id), description: 'DTE vigente (GET /dte/:id)' },
            fel_error: { ...nulable(texto), description: 'Error visible del DTE (SAT, receptor_requerido…)' },
            aviso_cobro: {
                ...booleano,
                description:
                    'Aviso de cobro (certificar_al = pagar): su IVA está en 2.1.11 hasta certificarse',
            },
            certificar_al: nulable(enumerado(['emitir', 'pagar', 'nunca'])),
            tipo_dte: { ...nulable(texto), description: 'FACT, FPEQ… (null sin FEL)' },
            tipo: {
                ...enumerado(['servicio', 'mora']),
                description: 'servicio = factura del periodo; mora = recargo por vencimiento de otra factura',
            },
            factura_origen_id: { ...nulable(id), description: 'Factura que originó la mora' },
            vencida_en: { ...nulable(instante), description: 'Cuándo se marcó vencida' },
            anulada_en: { ...nulable(instante), description: 'Cuándo se anuló' },
            motivo_anulacion: nulable(texto),
            cargo_unico: {
                ...booleano,
                description: 'Cargo único manual (POST /facturas/cargo-unico, clave_unica cargo-<uuid>)',
            },
            motivo_sin_costo_id: {
                ...nulable(id),
                description: 'Cargo en Q0: motivo del catálogo (GET /motivos-sin-costo)',
            },
            motivo_sin_costo_nombre: nulable(texto),
            motivo_sin_costo_texto: { ...nulable(texto), description: 'Explicación del cargo en Q0' },
            origen: {
                ...nulable(texto),
                description:
                    'Sistema de origen de una factura importada (mikrowisp, smartisp…); null si la emitió ArgosIsp',
            },
            id_externo: { ...nulable(texto), description: 'Id de la factura en su sistema de origen' },
            sustituida_por: {
                ...nulable(id),
                description:
                    'Factura nueva que sustituyó a esta (POST /facturas/:id/sustituir); null si no fue sustituida',
            },
            sustituye_a: {
                ...nulable(id),
                description: 'Factura original que esta sustituye; null si no es una sustituta',
            },
            ...auditable,
        },
        [
            'sustituida_por',
            'sustituye_a',
            'tipo',
            'factura_origen_id',
            'vencida_en',
            'anulada_en',
            'motivo_anulacion',
            'cargo_unico',
            'motivo_sin_costo_id',
            'motivo_sin_costo_nombre',
            'motivo_sin_costo_texto',
            'cliente_nombre',
            'acreditado',
            'origen',
            'id_externo',
            'empresa_nombre',
            'dte_id',
            'fel_error',
            'aviso_cobro',
            'certificar_al',
            'tipo_dte',
        ],
    ),
)

export const ConceptoCargo = definirEsquema(
    'ConceptoCargo',
    objeto({
        id,
        empresa_id: id,
        nombre: texto,
        tipo: { ...enumerado(['producto', 'otro']), description: 'producto = bien, otro = servicio (DTE)' },
        cuenta_codigo: { ...texto, description: 'Cuenta de ingreso del plan de cuentas' },
        cuenta_nombre: nulable(texto),
        gravable: { ...booleano, description: 'Lleva IVA (incluido en el precio)' },
        activo: { ...booleano, description: 'Uno inactivo no se usa en cargos nuevos' },
        ...auditable,
    }),
)

export const MotivoSinCosto = definirEsquema(
    'MotivoSinCosto',
    objeto({
        id,
        empresa_id: id,
        nombre: texto,
        activo: { ...booleano, description: 'Uno inactivo no se usa en cargos nuevos' },
        ...auditable,
    }),
)

export const NotaCredito = definirEsquema(
    'NotaCredito',
    objeto(
        {
            id,
            empresa_id: { ...id, description: 'Empresa de la factura (multiempresa)' },
            factura_id: id,
            cliente_id: id,
            cliente_nombre: texto,
            servicio_id: nulable(id),
            fecha: { ...fecha, description: 'Fecha contable (Guatemala)' },
            subtotal: Dinero,
            iva: { ...Dinero, description: 'IVA acreditado, proporcional al de la factura' },
            monto: { ...Dinero, description: 'subtotal + iva' },
            motivo: texto,
            asiento_id: {
                ...nulable(id),
                description: 'Asiento nota_credito (Debe ingresos/IVA, Haber CxC)',
            },
            created_by: nulable(id),
            created_by_nombre: nulable(texto),
            created_at: instante,
            anulada_en: {
                ...nulable(instante),
                description:
                    'Anulada porque la SAT rechazó su NCRE en definitivo (fase 3); null si sigue vigente',
            },
            dte_id: {
                ...nulable(id),
                description:
                    'Su NCRE (GET /dte/:id): la vigente o la última rechazada; null en una nota interna',
            },
            fel_estado: {
                ...nulable(texto),
                description:
                    'Estado de su NCRE: pendiente, enviando, certificado, error_temporal, rechazado, contingencia, anulacion_pendiente, anulado',
            },
            fel_uuid: { ...nulable(texto), description: 'Autorización (UUID SAT) de su NCRE' },
            fel_serie: nulable(texto),
            fel_numero: nulable(texto),
            fel_error: { ...nulable(texto), description: 'Error visible de su NCRE (SAT…)' },
        },
        [
            'empresa_id',
            'anulada_en',
            'dte_id',
            'fel_estado',
            'fel_uuid',
            'fel_serie',
            'fel_numero',
            'fel_error',
        ],
    ),
)

/** Datos fiscales del emisor de una factura (su empresa): lo que FEL necesita (semana 5). */
export const EmisorFactura = definirEsquema(
    'EmisorFactura',
    objeto({
        empresa_id: id,
        nit: nulable(texto),
        razon_social: nulable(texto),
        nombre_comercial: texto,
        direccion_fiscal: nulable(texto),
        municipio: nulable(texto),
        departamento: nulable(texto),
        correo: nulable(texto),
        regimen_isr: {
            ...nulable(
                enumerado(['sujeto_pagos_trimestrales', 'retencion_definitiva', 'pequeno_contribuyente']),
            ),
            description: 'Régimen ISR del emisor (frases de FEL)',
        },
        codigo_establecimiento: nulable(entero),
    }),
)

export const FacturaPagoAplicado = definirEsquema(
    'FacturaPagoAplicado',
    objeto({
        aplicacion_id: id,
        pago_id: id,
        cobro_id: { ...nulable(id), description: 'Cobro repartido del pago (multiempresa); null si no' },
        monto: { ...Dinero, description: 'Lo aplicado de ese pago a esta factura' },
        pago_monto: { ...Dinero, description: 'Monto total del pago' },
        metodo: texto,
        referencia: nulable(texto),
        estado: {
            ...texto,
            description:
                'Estado del pago (registrado, anulado…): una aplicación de un pago anulado ya no cuenta',
        },
        historico: { ...booleano, description: 'Pago histórico importado (sin caja ni banco)' },
        aplicado_en: instante,
    }),
)

export const FacturaAsiento = definirEsquema(
    'FacturaAsiento',
    objeto({
        id,
        fecha,
        origen_tipo: enumerado(['factura', 'mora']),
        descripcion: texto,
        diario: { ...nulable(texto), description: 'Código del diario (VEN…)' },
        numero: { ...nulable(entero), description: 'Número en su diario y año' },
        total: { ...Dinero, description: 'Σ debe del asiento' },
        reversa_de: { ...nulable(id), description: 'Asiento que este revierte' },
        revertido_por: { ...nulable(id), description: 'Reverso de este asiento, si lo hay' },
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
                emisor: {
                    ...EmisorFactura,
                    description: 'Empresa que emite la factura con sus datos fiscales (FEL)',
                },
                pagos: {
                    ...lista(FacturaPagoAplicado),
                    description: 'Pagos aplicados a la factura, en orden (también los de pagos anulados)',
                },
                asientos: {
                    ...lista(FacturaAsiento),
                    description:
                        'Asientos de la factura (origen factura o mora), los reversos incluidos; vacío en una importada sin asiento o por certificar',
                },
                diferencia_cobro_tope: {
                    ...nulable(Dinero),
                    description:
                        'Tope vigente de la empresa para POST /pagos/:id/cerrar-diferencia (diferencia_cobro_tope); null sin localización',
                },
            },
            ['notas_credito', 'emisor'],
        ),
    ],
})

const BloqueoCorrida = objeto({
    empresa_id: id,
    tipo: enumerado(['global', 'ventas', 'compras', 'impuestos', 'duro']),
    hasta: { ...nulable(fecha), description: 'Bloqueo vigente de ese tipo' },
    fecha: { ...fecha, description: 'Fecha contable que quedó bajo el bloqueo' },
    documentos: { type: 'integer', description: 'Servicios o facturas que no se contabilizaron' },
    ejemplos: { ...lista(id), description: 'Los primeros 20 ids' },
})

const camposBloqueo = {
    bloqueados: {
        type: 'integer',
        description:
            'Documentos que no se contabilizaron por un bloqueo del libro; se reintentan en la siguiente corrida',
    },
    bloqueos: {
        ...lista(BloqueoCorrida),
        description: 'Detalle por empresa y tipo de bloqueo (también va en libro.proceso_bloqueado)',
    },
}

/**
 * Decisión del PM (19 oct): lo que antes era una factura de Q0 (mes gratis, descuento del 100 %, cargo
 * único sin costo, canje). Registro interno: sin CxC, IVA, DTE, folio ni documento para el cliente.
 */
export const Bonificacion = definirEsquema(
    'Bonificacion',
    objeto({
        id,
        empresa_id: id,
        cliente_id: id,
        servicio_id: nulable(id),
        periodo: fecha,
        clave_unica: {
            ...texto,
            description:
                'servicio_id-periodo (ocupa el periodo: el cron no lo vuelve a facturar) o cargo-<uuid>',
        },
        concepto: texto,
        origen: enumerado(['mes_gratis', 'descuento_100', 'cargo_sin_costo', 'canje']),
        bruto: { ...Dinero, description: 'Valor con IVA de lo entregado sin cobrar' },
        base: { ...Dinero, description: 'Sin IVA: monto del asiento 5.1.01 / ingreso' },
        lineas: lista(
            objeto(
                {
                    concepto: texto,
                    tipo: texto,
                    cantidad: texto,
                    precio_unitario: Dinero,
                    gravable: booleano,
                    iva: Dinero,
                    total: Dinero,
                    cuenta_codigo: texto,
                },
                ['cuenta_codigo'],
            ),
        ),
        motivo_id: id,
        motivo_nombre: texto,
        motivo_texto: texto,
        canje_id: nulable(id),
        asiento_id: id,
        created_at: instante,
    }),
)

export const CargoUnicoEmitido = definirEsquema(
    'CargoUnicoEmitido',
    objeto({
        documento: {
            ...enumerado(['factura', 'bonificacion']),
            description: 'bonificacion si el total quedó en Q0 (decisión del PM: nunca una factura de Q0)',
        },
        factura: nulable(FacturaDetalle),
        bonificacion: nulable(Bonificacion),
    }),
)

export const CorridasFacturacion = definirEsquema(
    'CorridasFacturacion',
    objeto({
        empresa_id: id,
        procesos: lista(
            objeto({
                proceso: enumerado(['facturas.generar', 'facturas.vencer_pendientes']),
                corrida_en: { ...nulable(instante), description: 'null = aún no corrió para la empresa' },
                actor_tipo: nulable(texto),
                canal: nulable(texto),
                hasta: nulable(fecha),
                bloqueados: {
                    type: 'integer',
                    description:
                        'Documentos de la empresa que la corrida no contabilizó por un bloqueo del libro',
                },
                bloqueos: { ...lista(BloqueoCorrida), description: 'Solo los de la empresa' },
                resultado: {
                    ...nulable(jsonLibre),
                    description:
                        'Solo de la empresa: facturas.generar → generadas, omitidas, bonificadas, errores, bloqueados, bloqueos; facturas.vencer_pendientes → vencidas, moras, errores, bloqueados, bloqueos. null si una corrida anterior de varias empresas no lo separaba',
                },
            }),
        ),
    }),
)

export const ResultadoGeneracion = definirEsquema(
    'ResultadoGeneracion',
    objeto(
        {
            generadas: entero,
            omitidas: { type: 'integer', description: 'Ya tenían factura del periodo' },
            facturas: lista(id),
            bonificadas: {
                type: 'integer',
                description: 'Periodos en cero registrados como bonificación (nunca una factura de Q0)',
            },
            bonificaciones: lista(id),
            errores: { type: 'integer', description: 'Servicios que no se pudieron facturar (ver log)' },
            ...camposBloqueo,
        },
        ['errores', 'bonificadas', 'bonificaciones', 'bloqueados', 'bloqueos'],
    ),
)

export const ResultadoVencimiento = definirEsquema(
    'ResultadoVencimiento',
    objeto({
        vencidas: { type: 'integer', description: 'Facturas que pasaron a vencida' },
        moras: { type: 'integer', description: 'Recargos de mora creados' },
        errores: { type: 'integer', description: 'Facturas que no se pudieron procesar (ver log)' },
        ...camposBloqueo,
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

export const SustitucionFactura = definirEsquema(
    'SustitucionFactura',
    objeto({
        original: {
            ...FacturaDetalle,
            description: 'La factura sustituida (anulada o acreditada por completo)',
        },
        nueva: { ...FacturaDetalle, description: 'La factura nueva del mismo periodo' },
        tipo: enumerado(['anulacion', 'nota_credito']),
        nota_credito_id: { ...nulable(id), description: 'La nota (NCRE) que acreditó la original' },
    }),
)

export const Pago = definirEsquema(
    'Pago',
    objeto(
        {
            id,
            empresa_id: {
                ...id,
                description: 'Empresa (NIT) del documento (multiempresa)',
            },
            cobro_id: {
                ...nulable(id),
                description:
                    'Cobro de caja repartido por empresa (GET /cobros/:id); null si no vino de un cobro',
            },
            pagos: {
                type: 'array',
                items: { $ref: '#/components/schemas/Pago' },
                description:
                    'Solo al registrar (POST /pagos): todos los pagos del cobro, uno por empresa; la raíz es el primero',
            },
            cliente_id: id,
            cliente_nombre: { ...texto, description: 'Nombre del pagador' },
            metodo: enumerado([...METODOS_PAGO]),
            monto: {
                ...Dinero,
                description:
                    'Lo que el pago aplica a la deuda (efectivo o depósito + constancias de retención)',
            },
            comision: Dinero,
            retenido: {
                ...Dinero,
                description:
                    'Parte del monto cubierta con constancias de retención del cliente (fase 5): a caja o banco entró monto − comision − retenido',
            },
            constancias: {
                ...lista(
                    objeto({
                        impuesto: enumerado(['iva', 'isr']),
                        impuesto_codigo: texto,
                        numero: texto,
                        fecha,
                        monto: Dinero,
                    }),
                ),
                description: 'Constancias de retención recibidas con el pago (1.1.05 IVA, 1.1.06 ISR)',
            },
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
            proveedor_cobro_id: {
                ...nulable(id),
                description:
                    'Proveedor de cobro (pasarela, agente, débito) cuya cuenta puente 1.1.10.NN recibió el pago por el bruto; null = directo al banco',
            },
            proveedor_cobro_nombre: {
                ...nulable(texto),
                description: 'Nombre del proveedor de cobro; null sin proveedor',
            },
            liquidacion_id: {
                ...nulable(id),
                description: 'Liquidación del proveedor que incluyó el pago; null = sin liquidar',
            },
            historico: {
                ...booleano,
                description:
                    'Pago importado de otro sistema con su fecha original (created_at): no pasó por caja ni bancos',
            },
            origen: {
                ...nulable(texto),
                description:
                    'Sistema de origen del pago histórico (mikrowisp, smartisp, csv…); null si es de ArgosIsp',
            },
            id_externo: { ...nulable(texto), description: 'Id del pago en su sistema de origen' },
            ...auditable,
        },
        [
            'retenido',
            'constancias',
            'proveedor_cobro_id',
            'proveedor_cobro_nombre',
            'liquidacion_id',
            'historico',
            'origen',
            'id_externo',
            'cliente_nombre',
            'anulado_en',
            'motivo_anulacion',
            'servicios',
            'banco_origen_id',
            'banco_origen_nombre',
            'cuenta_bancaria_id',
            'cuenta_bancaria_nombre',
            'pagos',
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
            empresa_id: { ...id, description: 'Empresa del servicio (multiempresa)' },
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
            resultado_evaluacion: {
                ...nulable(EvaluacionPromesa),
                description:
                    'Por qué se aprobó, rechazó o quedó pendiente (aprobacion y cierre se agregan después); ver contratos/promesas.md',
            },
            servicio: {
                ...ServicioEvaluado,
                description:
                    'Solo al crear o aprobar una promesa activa: cómo quedó el servicio (reactivación)',
            },
            ...auditable,
        },
        ['servicio', 'cliente_nombre', 'empresa_id'],
    ),
)

export const MovimientoEstadoCuenta = definirEsquema(
    'MovimientoEstadoCuenta',
    objeto(
        {
            empresa_id: { ...id, description: 'Empresa (libro) del asiento' },
            fecha: fecha,
            tipo: {
                ...enumerado(['factura', 'pago', 'mora', 'nota_credito', 'diferencia_cobro', 'ajuste']),
                description:
                    'diferencia_cobro = saldo pequeño de un pago cerrado como gasto (abono sin cobro)',
            },
            referencia_id: id,
            descripcion: texto,
            cargo: Dinero,
            abono: Dinero,
            saldo: Dinero,
        },
        ['empresa_id'],
    ),
)

export const SeccionEstadoCuenta = definirEsquema(
    'SeccionEstadoCuenta',
    objeto({
        empresa_id: id,
        nombre_comercial: texto,
        razon_social: nulable(texto),
        nit: nulable(texto),
        logo_url: nulable(texto),
        saldo: { ...Dinero, description: 'Auxiliar CxC del cliente en esta empresa (positivo = debe)' },
        saldo_a_favor: { ...Dinero, description: 'Anticipos del cliente en esta empresa' },
        facturas_pendientes: lista(Factura),
        movimientos: {
            ...lista(MovimientoEstadoCuenta),
            description: 'Saldo acumulado dentro de la empresa',
        },
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
            empresas: {
                ...lista(SeccionEstadoCuenta),
                description:
                    'Multiempresa: una sección por empresa (cada NIT cobra lo suyo); saldo de la raíz = total informativo',
            },
        },
        ['saldo_a_favor', 'empresas'],
    ),
)

export const Banco = definirEsquema('Banco', objeto({ id, nombre: texto, activo: booleano }))

export const CuentaBancaria = definirEsquema(
    'CuentaBancaria',
    objeto(
        {
            id,
            empresa_id: {
                ...id,
                description: 'Empresa dueña de la cuenta: sus depósitos son pagos de esa empresa',
            },
            banco_id: id,
            banco_nombre: texto,
            numero: texto,
            alias: texto,
            moneda: enumerado(['GTQ', 'USD']),
            activa: { ...booleano, description: 'Una cuenta inactiva no recibe pagos nuevos' },
            cuenta_id: { ...id, description: 'Subcuenta de 1.1.02 Bancos en el libro' },
            cuenta_codigo: texto,
            ...auditable,
        },
        ['empresa_id'],
    ),
)

export const Comprobante = definirEsquema(
    'Comprobante',
    objeto(
        {
            id,
            empresa_id: {
                ...id,
                description:
                    'Empresa (NIT) del documento (multiempresa). Siempre viene; opcional en el esquema para no romper clientes tipados',
            },
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
        ['pago', 'verificado_por_nombre', 'empresa_id'],
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
            empresa_id: {
                ...id,
                description:
                    'Empresa (NIT) del documento (multiempresa). Siempre viene; opcional en el esquema para no romper clientes tipados',
            },
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
        ['url_retorno', 'empresa_id'],
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

/** Marca de la empresa en un recibo (multiempresa: el recibo lleva una sección por empresa). */
export const EmpresaRecibo = definirEsquema(
    'EmpresaRecibo',
    objeto({
        id,
        nombre_comercial: texto,
        razon_social: nulable(texto),
        nit: nulable(texto),
        direccion_fiscal: nulable(texto),
        telefono: nulable(texto),
        correo: nulable(texto),
        logo_url: nulable(texto),
    }),
)

export const Cobro = definirEsquema(
    'Cobro',
    objeto({
        id,
        cliente_id: id,
        cliente_nombre: texto,
        metodo: enumerado([...METODOS_PAGO]),
        monto: { ...Dinero, description: 'Total cobrado (suma de los pagos de todas las empresas)' },
        registrado_por: nulable(id),
        created_at: instante,
        secciones: {
            ...lista(
                objeto({
                    empresa: EmpresaRecibo,
                    pago: Pago,
                }),
            ),
            description: 'Un pago por empresa con su marca (las del alcance del usuario)',
        },
    }),
)
