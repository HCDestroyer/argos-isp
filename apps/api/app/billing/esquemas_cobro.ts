import {
    Dinero,
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
import { ESTADOS_BORRADOR } from '#ledger/borradores'
import { Comprobante, Pago } from '#billing/esquemas'
import { ORIGENES_GESTION, RESULTADOS_GESTION, TIPOS_GESTION } from '#billing/gestiones_cobro'

/**
 * Schemas de respuesta de las decisiones del PM del 21 nov (operación de cobro, A3).
 */

const camposGestion = {
    id,
    gestion_id: { ...id, description: 'Alias de id (contrato Iris 0.13.0)' },
    empresa_id: id,
    cliente_id: id,
    servicio_id: nulable(id),
    contacto_id: {
        ...nulable(id),
        description: 'Contacto con quien se habló (X-Iris-Contacto); null = el titular',
    },
    tipo: enumerado(TIPOS_GESTION),
    resultado: enumerado(RESULTADOS_GESTION),
    ocurrido_en: instante,
    origen_tipo: enumerado(ORIGENES_GESTION),
    origen_id: nulable(texto),
    sistema_origen: {
        ...nulable(enumerado(['iris'])),
        description: 'iris si la registró Iris; null desde el panel',
    },
    iris_gestion_id: { ...nulable(texto), description: 'UUID v7 de Iris (de Idempotency-Key)' },
    iris_actor: nulable(texto),
    nota: nulable(texto),
    tiene_adjunto: booleano,
    adjunto_tipo: nulable(texto),
    registrado_por: nulable(id),
    registrado_por_nombre: nulable(texto),
    created_at: instante,
}

export const GestionCobro = definirEsquema('GestionCobro', objeto(camposGestion))

export const GestionCobroRegistrada = definirEsquema(
    'GestionCobroRegistrada',
    objeto({
        ...camposGestion,
        repetida: {
            ...booleano,
            description:
                'true si Iris repitió la misma gestión (mismo iris_gestion_id y datos): no se duplicó',
        },
    }),
)

export const AjustesCobro = definirEsquema(
    'AjustesCobro',
    objeto({
        empresa_id: id,
        asientos_requieren_aprobacion: {
            ...booleano,
            description:
                'Decisión 10: un asiento manual queda como borrador hasta que otro usuario lo aprueba',
        },
        pausa_tope_dias: { ...entero, description: 'Decisión 16: días máximos de una pausa sin cobro' },
        version: { ...entero, description: '0 = nunca se guardó (valores de fábrica)' },
        updated_by: nulable(id),
        updated_at: nulable(instante),
    }),
)

export const BorradorAsiento = definirEsquema(
    'BorradorAsiento',
    objeto({
        id,
        empresa_id: id,
        fecha: { ...nulable(fecha), description: 'null = la fecha de hoy al aprobar' },
        descripcion: texto,
        movimientos: lista(
            objeto({
                cuenta: texto,
                debe: Dinero,
                haber: Dinero,
                cliente_id: nulable(id),
                proveedor_id: nulable(id),
            }),
        ),
        total: Dinero,
        estado: enumerado(ESTADOS_BORRADOR),
        creado_por: nulable(id),
        creado_por_nombre: nulable(texto),
        created_at: instante,
        decidido_por: nulable(id),
        decidido_por_nombre: nulable(texto),
        decidido_en: nulable(instante),
        motivo_rechazo: nulable(texto),
        asiento_id: { ...nulable(id), description: 'El asiento que se registró al aprobarlo' },
    }),
)

export const AsientoManual = definirEsquema(
    'AsientoManual',
    objeto({
        estado: {
            ...enumerado(['registrado', 'pendiente_aprobacion']),
            description:
                'registrado: ya está en el libro; pendiente_aprobacion: borrador que aprueba otro usuario',
        },
        asiento_id: nulable(id),
        borrador: nulable(BorradorAsiento),
    }),
)

export const CoberturaComprobante = definirEsquema(
    'CoberturaComprobante',
    objeto({
        deuda: { ...Dinero, description: 'Saldo de las facturas a las que se aplicó, antes del pago' },
        aplicado: { ...Dinero, description: 'Lo que el pago cubrió de esas facturas' },
        falta: {
            ...Dinero,
            description: 'Lo que esas facturas siguen debiendo (0.00 si quedaron cubiertas)',
        },
    }),
)

/** `POST /comprobantes/:id/aprobar`: el comprobante con su pago y la cobertura (decisión del PM 14). */
export const ComprobanteAprobado = definirEsquema('ComprobanteAprobado', {
    allOf: [
        Comprobante,
        objeto({
            pago: { ...Pago, description: 'El pago registrado (como POST /pagos)' },
            cobertura: {
                ...CoberturaComprobante,
                description:
                    'Decisión del PM 14: con menos dinero se abona a las facturas más viejas y se informa cuánto falta',
            },
        }),
    ],
})

export const PausaServicio = definirEsquema(
    'PausaServicio',
    objeto({
        id,
        empresa_id: id,
        servicio_id: id,
        cliente_id: id,
        desde: { ...fecha, description: 'Primer día de la pausa (Guatemala)' },
        hasta: {
            ...fecha,
            description: 'Día en que se reactiva (exclusivo); los periodos que empiezan antes no se facturan',
        },
        dias: entero,
        motivo: texto,
        estado: enumerado(['activa', 'terminada']),
        terminada_en: nulable(instante),
        fin_motivo: nulable(enumerado(['vencida', 'manual', 'reactivado', 'retirado'])),
        creada_por: nulable(id),
        terminada_por: nulable(id),
        version: entero,
        created_at: instante,
    }),
)

export const BancoOrigen = definirEsquema(
    'BancoOrigen',
    objeto({
        id,
        nombre: texto,
        orden: entero,
        activo: { ...booleano, description: 'false: fuera de las listas de todas las empresas' },
        oculto: { ...booleano, description: 'Oculto en la empresa activa (decisión del PM 23)' },
        version: entero,
    }),
)
