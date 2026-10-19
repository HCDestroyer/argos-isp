/**
 * Catálogo de eventos de dominio (ver `.claude/CLAUDE.md`).
 *
 * Los eventos se escriben en `audit.outbox` con `t.emit(evento, payload)` dentro de la misma
 * transacción que el cambio; un relay (A1) los publica a Redis Streams. Los consumidores deben
 * ser idempotentes: un evento puede llegar dos veces.
 *
 * Convenciones del payload: claves en snake_case, ids numéricos, dinero como string decimal
 * ("150.00"), fechas como ISO 8601 (UTC para instantes, YYYY-MM-DD para fechas).
 */

export type EstadoServicio = 'activo' | 'limitado' | 'suspendido' | 'retirado'
/** Métodos de pago (`billing.pagos.metodo`). transferencia, ach y remesa: decisión del PM 2026-10-16. */
export const METODOS_PAGO = [
    'caja',
    'pasarela',
    'deposito',
    'transferencia',
    'ach',
    'remesa',
    'agente',
    'debito',
] as const
export type MetodoPago = (typeof METODOS_PAGO)[number]
export type CanalNotificacion = 'correo' | 'telegram' | 'whatsapp'

/** Monto decimal serializado, p. ej. "150.00". Nunca `number`. */
export type Dinero = string

/**
 * Multiempresa (A3, 2026-10-17): todos los eventos de billing y ledger llevan `empresa_id`, la
 * empresa (NIT) del documento. Aditivo: los consumidores que no lo lean no cambian.
 */
interface PayloadFactura {
    factura_id: number
    empresa_id: number
    servicio_id: number | null
    cliente_id: number
    total: Dinero
    /** fecha de vencimiento YYYY-MM-DD */
    vence: string
}

interface PayloadPago {
    pago_id: number
    /** un pago es de una sola empresa; un cobro de caja que cubre varias emite un evento por pago */
    empresa_id: number
    /** cobro de caja repartido por empresa (`billing.cobros`); null si el pago no vino de un cobro */
    cobro_id: number | null
    /** quien paga */
    cliente_id: number
    monto: Dinero
    metodo: MetodoPago
    facturas: number[]
    /**
     * el pagador y los dueños de las facturas aplicadas (pago de terceros: una persona paga la
     * factura de un familiar). Siempre lo envía billing desde 2026-10-16; opcional por eventos
     * anteriores.
     */
    clientes?: number[]
}

/** Nota de crédito interna (A3, semana 3): reduce el saldo de `factura_id` y la CxC del cliente. */
interface PayloadNotaCredito {
    nota_credito_id: number
    empresa_id: number
    factura_id: number
    servicio_id: number | null
    cliente_id: number
    monto: Dinero
    motivo: string
}

interface PayloadPromesa {
    promesa_id: number
    empresa_id: number
    servicio_id: number
    /** instante ISO 8601 */
    vence: string
    monto: Dinero
}

/** Comprobante de depósito (A3, día 4). `pago_id` solo al aprobar; `motivo` solo al rechazar. */
interface PayloadComprobante {
    comprobante_id: number
    empresa_id: number
    cliente_id: number
    pago_id: number | null
    motivo: string | null
}

interface PayloadSesion {
    servicio_id: number | null
    nas_ip: string
    acct_session_id: string
    ipv4: string | null
    prefijos_v6: string[]
}

/**
 * Campos de `core.clientes` que emiten `cliente.actualizado`: los que Horus muestra (`nombre`,
 * `tipo`, `codigo`) y la identificación del receptor FEL (`nit_cui`, `tipo_documento_fiscal`).
 */
export const CAMPOS_CLIENTE_ACTUALIZADO = [
    'nombre',
    'tipo',
    'codigo',
    'nit_cui',
    'tipo_documento_fiscal',
] as const
export type CampoClienteActualizado = (typeof CAMPOS_CLIENTE_ACTUALIZADO)[number]

export const MODALIDADES_ADICIONAL = ['incluido', 'cortesia', 'cobrado'] as const
export type ModalidadAdicional = (typeof MODALIDADES_ADICIONAL)[number]
export const CAMPOS_ADICIONAL_CAMBIADO = [
    'modalidad',
    'identificador',
    'credencial',
    'precio',
    'motivo',
] as const
export type CampoAdicionalCambiado = (typeof CAMPOS_ADICIONAL_CAMBIADO)[number]

/** Asignación de un adicional a un servicio (`core.servicios_adicionales`). */
interface PayloadAdicional {
    servicio_id: number
    cliente_id: number
    empresa_id: number
    adicional_id: number
    asignacion_id: number
    modalidad: ModalidadAdicional
}

export interface CatalogoEventos {
    // núcleo (A1). `empresa_id` (multiempresa, 2026-10-17): la empresa del servicio; aditivo.
    'servicio.creado': {
        servicio_id: number
        empresa_id: number
        cliente_id: number
        router_id: number
        plan_id: number
    }
    'servicio.estado_cambiado': {
        servicio_id: number
        empresa_id: number
        de: EstadoServicio
        a: EstadoServicio
        motivo: string
    }
    /**
     * `tipo_conexion`, `mac` y `amarre_ip_mac` (semana 2, WISP): el dispatcher de RouterOS (A2)
     * recalcula el estado deseado del servicio y limpia lo del tipo anterior.
     * `empresa` (multiempresa): el servicio pasó a otra empresa (`servicios.cambiar_empresa`);
     * `empresa_anterior_id` solo viene en ese caso. No cambia nada en la red.
     * `motivo: 'plan_temporal'` (lealtad, aditivo): inicio, fin o cancelación de un plan temporal
     * (`core.servicios_planes_temporales`, `plan_temporal_id`); llega con `campos: ['plan']` y se
     * aplica como cualquier cambio de plan (CoA de velocidad, sin cortar la sesión).
     */
    'servicio.config_cambiada': {
        servicio_id: number
        empresa_id: number
        campos: Array<
            'plan' | 'ips' | 'prefijo_v6' | 'router' | 'tipo_conexion' | 'mac' | 'amarre_ip_mac' | 'empresa'
        >
        empresa_anterior_id?: number
        motivo?: 'plan_temporal'
        plan_temporal_id?: number
    }
    /**
     * Cambió algo que altera las colas de un plan (semana 2, `contratos/velocidad.md`): velocidades,
     * reuso, garantizado, ráfaga o prioridad del plan (`router_id: null`, afecta todos los routers)
     * o su excepción en un router (`router_id`), o el `rate_limit_override`. A2 recalcula los
     * padres y perfiles PPP del plan; `aaa-cache` reescribe `aaa:user:*` de sus servicios.
     */
    'plan.velocidad_cambiada': {
        plan_id: number
        router_id: number | null
        campos: string[]
    }
    /**
     * Cambió el control de velocidad de un router (`routers.cambiar_control_velocidad`) o la
     * capacidad del enlace (`routers.editar`). `de`/`a` iguales si solo cambió la capacidad. A2
     * ejecuta el cambio en el router (padres, árbol, PCQ) por lotes.
     */
    'router.control_cambiado': {
        router_id: number
        de: 'simple' | 'arbol_pcq'
        a: 'simple' | 'arbol_pcq'
        capacidad_bajada_kbps: number | null
        capacidad_subida_kbps: number | null
        campos: Array<'control_velocidad' | 'capacidad'>
        motivo: string | null
    }
    /**
     * Servicios adicionales de un servicio (decisión del PM, 19 oct; `contratos/adicionales.md`):
     * streaming, IPTV… Nunca llevan la credencial. A3 factura los `cobrado`; A5 los muestra en el
     * portal. No cambian nada en la red (`aaa-cache` y `routeros` los ignoran).
     */
    'servicio.adicional_agregado': PayloadAdicional & {
        /** `manual`: lo agregó alguien; `plan`: lo trajo el plan al crear el servicio o cambiar de plan */
        origen: 'manual' | 'plan'
    }
    'servicio.adicional_cambiado': PayloadAdicional & {
        /** campos que cambiaron; `credencial` solo dice que cambió (nunca el valor) */
        campos: CampoAdicionalCambiado[]
        modalidad_anterior: ModalidadAdicional
    }
    'servicio.adicional_quitado': PayloadAdicional & {
        /** `manual` (quitado a mano), `cambio_plan`, `retiro` o `cambio_empresa` */
        origen: 'manual' | 'cambio_plan' | 'retiro' | 'cambio_empresa'
        motivo: string | null
    }
    'asignacion.cambiada': {
        servicio_id: number
        empresa_id: number
        ipv4: string[]
        prefijo_enlace_v6: string | null
        prefijo_delegado_v6: string | null
        inicio: string
        fin: string | null
    }

    // aaa (A2)
    'sesion.iniciada': PayloadSesion
    /**
     * `motivo` = `causa_fin` de la sesión: `Acct-Terminate-Cause` del NAS (`User-Request`,
     * `Lost-Carrier`…), `NAS-Reboot`, `Sesion-Reemplazada` o `sin_interim` (cierre del cron de
     * sesiones colgadas). Agregado en la semana 3; los consumidores que no lo lean no cambian.
     */
    'sesion.terminada': PayloadSesion & { motivo: string | null }
    /** Desconexión manual pedida desde el panel o la API; la ejecuta `coa` (Disconnect-Request). */
    'sesion.desconexion_solicitada': {
        sesion_id: number
        servicio_id: number | null
        nas_ip: string
        acct_session_id: string
        user_ppp: string
        motivo: string
    }
    /** `servicio_id` null solo en una desconexión manual de una sesión sin servicio conocido. */
    'coa.fallido': { servicio_id: number | null; nas_ip: string; tipo: 'coa' | 'disconnect'; error: string }
    /**
     * El dispatcher de RouterOS (A2, `app/network/routeros`) agotó los reintentos contra la API
     * REST del router. `servicio_id` null en una reconciliación del router completo. El
     * reconciliador vuelve a aplicar el estado deseado cuando el router responde.
     */
    'routeros.fallido': {
        servicio_id: number | null
        router_id: number
        /** Comando legible que falló (`queue/simple add`, `ip/firewall/address-list remove`…) o `reconciliar` */
        operacion: string
        error: string
    }
    /** `aaa` no respondió su health check durante el umbral (60 s). `desde` = primer fallo. */
    'aaa.caido': { nodo: string; desde: string; ultimo_error?: string | null }
    /** `aaa` volvió a responder. `desde` = inicio de la caída, `hasta` = primer health check bueno. */
    'aaa.recuperado': { nodo: string; desde: string; hasta: string; ultimo_error: string | null }

    /**
     * Cambiaron datos del cliente que muestran otros sistemas (contrato Horus §2.3): `nombre`,
     * `tipo` o `codigo` (hoy inmutable; se reserva para un cambio futuro), o su identificación de
     * receptor FEL: `nit_cui` y `tipo_documento_fiscal` (reclasificado al editar). Sin `empresa_id`: el
     * cliente no es de una empresa, sus servicios sí. Lo consume el worker de webhooks a Horus (A6).
     */
    'cliente.actualizado': {
        cliente_id: number
        campos: CampoClienteActualizado[]
    }

    // billing (A3)
    'factura.emitida': PayloadFactura
    'factura.vencida': PayloadFactura
    'factura.anulada': PayloadFactura
    'pago.registrado': PayloadPago
    'pago.anulado': PayloadPago
    /** nota de crédito sobre el saldo de una factura; el servicio ya se re-evaluó en la acción */
    'nota_credito.emitida': PayloadNotaCredito
    /** la NCRE de la nota la rechazó la SAT en definitivo y la nota se anuló con su reverso (fase 3) */
    'nota_credito.anulada': {
        nota_credito_id: number
        empresa_id: number
        factura_id: number
        cliente_id: number
        monto: Dinero
        motivo: string
    }
    'promesa.creada': PayloadPromesa
    'promesa.cumplida': PayloadPromesa
    'promesa.incumplida': PayloadPromesa
    /** el cliente (portal) o un operador (panel) subió un comprobante; queda pendiente de revisión */
    'comprobante.recibido': PayloadComprobante
    /** se aprobó y ya es un pago (`pago_id`); el pago emite además `pago.registrado` */
    'comprobante.aprobado': PayloadComprobante
    /** se rechazó con `motivo`; la referencia queda libre para subirlo de nuevo */
    'comprobante.rechazado': PayloadComprobante

    // ledger (A3)
    'caja.cerrada': {
        caja_id: number
        empresa_id: number
        cajero_id: number | null
        esperado: Dinero
        contado: Dinero
        diferencia: Dinero
    }
    /**
     * La cadena de hash del libro de la empresa no verifica (contrato de localización fiscal
     * §10.10): el sello `sello` guarda `esperado` y el recálculo dio `obtenido`. Lo emite el
     * sellador o la verificación diaria, una vez por (empresa, sello).
     */
    'libro.integridad_rota': {
        empresa_id: number
        sello: number
        asiento_id: number | null
        esperado: string
        obtenido: string
    }

    // notify (A6)
    'notificacion.enviada': {
        cliente_id: number
        canal: CanalNotificacion
        evento_origen: string
        estado: 'enviado' | 'fallido'
    }
    /**
     * Cambió la configuración de canales de notificación (global si `empresa_id` es null). Los
     * procesos que envían recargan la suya (regla 5). `campos` son columnas, nunca valores.
     */
    'notificaciones.config_cambiada': {
        configuracion_id: number
        empresa_id: number | null
        campos: string[]
    }

    // fiscal (A3, `contratos/localizacion-fiscal.md` §10.3)
    'fiscal.localizacion_instalada': {
        empresa_id: number
        pais: string
        /** versión instalada, p. ej. `gt-2026.1` */
        codigo: string
        /** versión anterior; null en la primera instalación */
        de_codigo: string | null
    }
    /** invalida la caché de parámetros (regla 5); null = valor global de la instalación */
    'fiscal.parametros_cambiados': {
        empresa_id: number | null
        claves: string[]
        /** YYYY-MM-DD: la vigencia más antigua de lo insertado */
        vigente_desde: string
    }
    /** nunca lleva valores secretos */
    'fiscal.config_cambiada': {
        empresa_id: number
        campos: Array<'regimen' | 'fel_modo' | 'proveedor' | 'credenciales' | 'establecimientos' | 'frases'>
    }
    // FEL (A3, `contratos/localizacion-fiscal.md` §11.3)
    'dte.certificado': {
        dte_id: number
        empresa_id: number
        documento_tipo: 'factura' | 'nota_credito' | 'nota_debito'
        documento_id: number
        tipo_dte: string
        autorizacion: string
        serie: string | null
        numero: string | null
        contingencia: boolean
    }
    /** `definitivo: false` = se agotaron los reintentos automáticos (sigue en error_temporal) */
    'dte.rechazado': {
        dte_id: number
        empresa_id: number
        documento_tipo: 'factura' | 'nota_credito' | 'nota_debito'
        documento_id: number
        error: string
        definitivo: boolean
    }
    'dte.anulado': {
        dte_id: number
        empresa_id: number
        documento_tipo: 'factura' | 'nota_credito' | 'nota_debito'
        documento_id: number
        motivo: string
    }
    'fel.contingencia_cambiada': {
        empresa_id: number
        activa: boolean
        motivo: string
    }
    'factura.sustituida': {
        factura_id: number
        nueva_factura_id: number
        empresa_id: number
        servicio_id: number | null
        cliente_id: number
        motivo: string
    }
    /**
     * Cobros y bancos (contrato de localización fiscal §10.3 y §10.9, fase 4). `proveedor` es el código
     * del proveedor de cobro (`falsa`, `agente`, `debito`); `pagos` los ids incluidos (sin contracargos).
     */
    'cobros.liquidados': {
        liquidacion_id: number
        empresa_id: number
        proveedor: string
        bruto: Dinero
        comision: Dinero
        neto: Dinero
        pagos: number[]
    }
    /** Efectivo de un turno de caja depositado en el banco (queda en 1.1.11 hasta conciliarse). */
    'caja.depositada': {
        deposito_id: number
        empresa_id: number
        caja_id: number
        /** cuenta bancaria propia (null si el depósito fue a un banco del libro sin cuenta propia) */
        cuenta_bancaria_id: number | null
        /** subcuenta del libro (1.1.02.NN) que recibe el depósito */
        cuenta_id: number
        monto: Dinero
    }
    'banco.extracto_importado': {
        extracto_id: number
        empresa_id: number
        cuenta_bancaria_id: number | null
        cuenta_id: number
        /** número de líneas importadas */
        lineas: number
        /** Σ de las líneas (con signo) */
        monto: Dinero
    }
    'banco.conciliado': {
        /** primera fila de la conciliación (su `id` en `POST /bancos/conciliaciones/:id/anular`) */
        conciliacion_id: number
        empresa_id: number
        cuenta_bancaria_id: number | null
        cuenta_id: number
        /** línea del extracto conciliada */
        linea_id: number
        lineas: number
        monto: Dinero
    }
    'cartera.castigada': {
        castigo_id: number
        empresa_id: number
        cliente_id: number
        facturas: number[]
        monto: Dinero
    }
    /**
     * Compras, activos y diferidos (contrato de localización fiscal §3.4 y §10.10, fase 5).
     * `periodo_iva` es el mes del libro de compras (YYYY-MM).
     */
    'compra.registrada': {
        compra_id: number
        empresa_id: number
        proveedor_id: number
        total: Dinero
        iva: Dinero
        periodo_iva: string
    }
    'compra.anulada': {
        compra_id: number
        empresa_id: number
        proveedor_id: number
        total: Dinero
        iva: Dinero
        periodo_iva: string
    }
    /** Baja (venta, retiro o anulación de su compra) de un activo fijo; `valor_libros` al darlo de baja. */
    'activo.dado_de_baja': {
        activo_id: number
        empresa_id: number
        motivo: string
        valor_libros: Dinero
    }
    // lealtad (A3, `contratos/lealtad.md` §13). Puntos enteros (no dinero); fechas YYYY-MM-DD.
    /** cambió el programa o sus reglas: quien guarde reglas en caché las relee (regla 5) */
    'lealtad.programa_cambiado': {
        programa_id: number
        empresa_id: number
        /** columnas del programa, o `reglas` si cambió una regla */
        campos: string[]
    }
    /** acumulación (o ajuste positivo): un lote nuevo */
    'lealtad.puntos_acumulados': {
        movimiento_id: number
        empresa_id: number
        cliente_id: number
        servicio_id: number | null
        /** null en un ajuste manual */
        regla_id: number | null
        puntos: number
        /** null = el programa no vence puntos */
        vence_en: string | null
    }
    /** reverso de lo otorgado (pago o factura anulada…) o ajuste negativo; `puntos` es positivo */
    'lealtad.puntos_revertidos': {
        movimiento_id: number
        empresa_id: number
        cliente_id: number
        puntos: number
        origen_tipo: string
        origen_id: number | null
    }
    /** una vez por lote, `aviso_vencimiento_dias` antes de `vence_en` (A6 avisa al cliente) */
    'lealtad.puntos_por_vencer': {
        empresa_id: number
        cliente_id: number
        puntos: number
        vence_en: string
        /** aditivo: el lote (`lealtad.movimientos.id`) */
        lote_id: number
    }
    'lealtad.puntos_vencidos': {
        movimiento_id: number
        empresa_id: number
        cliente_id: number
        puntos: number
    }
    /** canje de puntos (fase 2): reservado para la próxima factura, aplicado (nota o plan temporal) o revertido */
    'lealtad.canje_reservado': PayloadCanjeLealtad
    'lealtad.canje_aplicado': PayloadCanjeLealtad
    'lealtad.canje_revertido': PayloadCanjeLealtad
    // sorteos (lealtad fase 3, `contratos/lealtad.md` §7 y §13)
    /** bases congeladas y compromiso de la semilla publicados */
    'sorteo.bases_publicadas': {
        sorteo_id: number
        empresa_id: number
        bases_hash: string
        compromiso: string
        /** ISO 8601 */
        fecha_sorteo: string
    }
    /** foto del corte: participantes, boletos y `lista_hash` */
    'sorteo.corte_cerrado': {
        sorteo_id: number
        empresa_id: number
        participantes: number
        boletos: number
        lista_hash: string
    }
    /** resultado calculado con `argos-sorteo-v1`; A6 avisa a los titulares */
    'sorteo.ejecutado': {
        sorteo_id: number
        empresa_id: number
        ganadores: Array<{ cliente_id: number; tipo: 'titular' | 'suplente'; posicion: number }>
    }
    'sorteo.premio_entregado': {
        sorteo_id: number
        empresa_id: number
        cliente_id: number
        posicion: number
    }
    'sorteo.cancelado': { sorteo_id: number; empresa_id: number; motivo: string }
    'lealtad.referido_calificado': {
        /** `lealtad.referidos.id` */
        referido_id: number
        empresa_id: number
        referidor_id: number
        /** el cliente referido */
        cliente_id: number
    }
    // integraciones · Horus Flow (A6, `contratos/horus.md`). Horus no decide cortes: ningún
    // consumidor cambia el estado de un servicio por estos eventos (ADR-0030).
    /** Cambió la configuración del conector Horus: los procesos la releen (regla 5). Nunca valores. */
    'horus.config_cambiada': { activo: boolean; campos: string[] }
    /** Horus abrió un hallazgo de seguridad de un cliente (§3.4 `finding.opened`). */
    'horus.hallazgo_abierto': PayloadHallazgoHorus
    /** Horus resolvió un hallazgo (§3.4 `finding.resolved`). */
    'horus.hallazgo_resuelto': PayloadHallazgoHorus
    /** Cambió el estado de seguridad de un cliente en Horus (§3.4 `customer.security_state_changed`). */
    'horus.estado_seguridad_cambiado': PayloadClienteHorus & {
        estado: string
        estado_anterior: string | null
        hallazgos_abiertos: number | null
    }
    /** Un router que vigila Horus cambió de estado (§3.4 `router.status_changed`). */
    'horus.router_estado_cambiado': {
        webhook_id: string
        router: {
            id: string
            nombre: string | null
            estado: string
            estado_anterior: string | null
            motivo: string | null
        }
    }
    /** Un servicio de infraestructura (IPTV, HTTP…) cambió de estado (§3.4 `infra_service.state_changed`). */
    'horus.servicio_infra_cambiado': {
        webhook_id: string
        servicio_infra: {
            id: string
            nombre: string | null
            estado: string
            estado_anterior: string | null
            motivo: string | null
        }
    }
}

/**
 * Lo común de los eventos de Horus sobre un cliente: el `servicio_id`, `cliente_id` y
 * `empresa_id` de Argos (de `external` del webhook, verificados contra `core.servicios`; null si
 * Horus no tiene identidad vigente) y la IP que vio Horus.
 */
interface PayloadClienteHorus {
    /** `X-Webhook-Id` / `id` del webhook de Horus (deduplicación) */
    webhook_id: string
    servicio_id: number | null
    cliente_id: number | null
    empresa_id: number | null
    ip: string | null
}

type PayloadHallazgoHorus = PayloadClienteHorus & {
    hallazgo: {
        id: string | null
        tipo: string | null
        severidad: string | null
        resumen: string | null
        abierto_en: string | null
        reabierto: boolean
    }
}

/** Canje de lealtad (`contratos/lealtad.md` §13). */
interface PayloadCanjeLealtad {
    canje_id: number
    empresa_id: number
    cliente_id: number
    servicio_id: number
    premio_id: number
    /** tipo de premio: descuento_factura, mes_gratis, mejora_plan… */
    tipo: string
    puntos: number
    /** factura con el descuento (nota de crédito o próxima factura); null si no aplica */
    factura_id: number | null
}

export type NombreEvento = keyof CatalogoEventos
export type PayloadEvento<E extends NombreEvento> = CatalogoEventos[E]

/** Lista en tiempo de ejecución (para validar y para el relay). */
export const EVENTOS = [
    'servicio.creado',
    'servicio.estado_cambiado',
    'servicio.config_cambiada',
    'asignacion.cambiada',
    'servicio.adicional_agregado',
    'servicio.adicional_cambiado',
    'servicio.adicional_quitado',
    'plan.velocidad_cambiada',
    'router.control_cambiado',
    'cliente.actualizado',
    'sesion.iniciada',
    'sesion.terminada',
    'sesion.desconexion_solicitada',
    'coa.fallido',
    'routeros.fallido',
    'aaa.caido',
    'aaa.recuperado',
    'factura.emitida',
    'factura.vencida',
    'factura.anulada',
    'pago.registrado',
    'pago.anulado',
    'nota_credito.emitida',
    'nota_credito.anulada',
    'promesa.creada',
    'promesa.cumplida',
    'promesa.incumplida',
    'comprobante.recibido',
    'comprobante.aprobado',
    'comprobante.rechazado',
    'caja.cerrada',
    'libro.integridad_rota',
    'notificacion.enviada',
    'notificaciones.config_cambiada',
    'fiscal.localizacion_instalada',
    'fiscal.parametros_cambiados',
    'fiscal.config_cambiada',
    'dte.certificado',
    'dte.rechazado',
    'dte.anulado',
    'fel.contingencia_cambiada',
    'factura.sustituida',
    'cobros.liquidados',
    'caja.depositada',
    'banco.extracto_importado',
    'banco.conciliado',
    'cartera.castigada',
    'compra.registrada',
    'compra.anulada',
    'activo.dado_de_baja',
    'lealtad.programa_cambiado',
    'lealtad.puntos_acumulados',
    'lealtad.puntos_revertidos',
    'lealtad.puntos_por_vencer',
    'lealtad.puntos_vencidos',
    'lealtad.canje_reservado',
    'lealtad.canje_aplicado',
    'lealtad.canje_revertido',
    'sorteo.bases_publicadas',
    'sorteo.corte_cerrado',
    'sorteo.ejecutado',
    'sorteo.premio_entregado',
    'sorteo.cancelado',
    'lealtad.referido_calificado',
    'horus.config_cambiada',
    'horus.hallazgo_abierto',
    'horus.hallazgo_resuelto',
    'horus.estado_seguridad_cambiado',
    'horus.router_estado_cambiado',
    'horus.servicio_infra_cambiado',
] as const satisfies readonly NombreEvento[]

type Faltantes = Exclude<NombreEvento, (typeof EVENTOS)[number]>
// Si agregas un evento al catálogo y no a EVENTOS, esta línea no compila.
const eventosCompletos: Faltantes extends never ? true : Faltantes = true
void eventosCompletos

export function esEvento(nombre: string): nombre is NombreEvento {
    return (EVENTOS as readonly string[]).includes(nombre)
}
