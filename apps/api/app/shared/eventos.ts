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

/**
 * Estados del servicio (`core.servicios.estado`). `pendiente_instalacion` (vendido desde Iris, aún sin
 * instalar; `contratos/instalacion.md`) solo sale con `servicios.activar_instalacion` o `servicios.retirar`.
 */
export const ESTADOS_SERVICIO = [
    'pendiente_instalacion',
    'activo',
    'limitado',
    'suspendido',
    'retirado',
] as const
export type EstadoServicioConPendiente = (typeof ESTADOS_SERVICIO)[number]
/**
 * Estados sin `pendiente_instalacion`: los que ven hoy billing, portal y lealtad. Se mantiene
 * mientras A3 y A5 adoptan el pendiente (`.claude/integration/a1.md`); el núcleo usa
 * `EstadoServicioConPendiente` donde un pendiente puede aparecer.
 */
export type EstadoServicio = Exclude<EstadoServicioConPendiente, 'pendiente_instalacion'>
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
    'primer_periodo',
] as const
export type CampoAdicionalCambiado = (typeof CAMPOS_ADICIONAL_CAMBIADO)[number]

/** Primer periodo de un adicional `cobrado` agregado a mitad de periodo (lo factura A3). */
export const PRIMEROS_PERIODOS_ADICIONAL = ['prorrateado', 'sin_costo'] as const
export type PrimerPeriodoAdicional = (typeof PRIMEROS_PERIODOS_ADICIONAL)[number]

/** Bloqueo o desbloqueo de un adicional por el estado del servicio (`contratos/adicionales.md`). */
interface PayloadBloqueoAdicional {
    servicio_id: number
    cliente_id: number
    empresa_id: number
    asignacion_id: number
    adicional_id: number
    /** usuario de IPTV, correo de la cuenta… (nunca la credencial) */
    identificador: string | null
    modalidad: ModalidadAdicional
    /** estado del servicio que lo causó (`suspendido` al bloquear; `activo` o `limitado` al desbloquear) */
    estado_servicio: EstadoServicio
    /** motivo del cambio de estado del servicio */
    motivo: string | null
}

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
        de: EstadoServicioConPendiente
        a: EstadoServicio
        motivo: string
        /**
         * Solo en la activación de la instalación (`motivo: 'instalacion'`, `contratos/instalacion.md`)
         * cuando viene de otro sistema: p. ej. `iris_orden` y el id de la orden. Aditivo.
         */
        origen_tipo?: string
        origen_id?: string
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
    /**
     * Servicio eliminado porque nunca se usó (decisión del PM, 29 oct; `contratos/eliminar.md`).
     * La fila de `core.servicios` ya no existe: RouterOS borra lo que le haya creado, Iris lo quita.
     */
    'servicio.eliminado': {
        servicio_id: number
        empresa_id: number
        cliente_id: number
        router_id: number
    }
    /**
     * Router eliminado sin historial (`contratos/eliminar.md`). FreeRADIUS regenera sus clientes y
     * el agente WireGuard borra el peer. `empresa_id` = `empresa_sugerida_id` (o null).
     */
    'router.eliminado': {
        router_id: number
        empresa_id: number | null
    }
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
        /** solo con `cobrado`: cómo se cobra el periodo en curso (A3) */
        primer_periodo: PrimerPeriodoAdicional | null
        /** nace bloqueado si el servicio está suspendido (se emite además `adicional.bloqueado`) */
        bloqueo: 'vigente' | 'bloqueado'
    }
    'servicio.adicional_cambiado': PayloadAdicional & {
        /** campos que cambiaron; `credencial` solo dice que cambió (nunca el valor) */
        campos: CampoAdicionalCambiado[]
        modalidad_anterior: ModalidadAdicional
    }
    /**
     * El servicio pasó a `suspendido` (o se le agregó un adicional estando suspendido): la cuenta
     * externa (streaming, IPTV) debe bloquearse. Lo consume quien integre esos proveedores; hoy nadie.
     */
    'adicional.bloqueado': PayloadBloqueoAdicional
    /** El servicio salió de `suspendido` (`activo` o `limitado`): la cuenta externa se reactiva. */
    'adicional.desbloqueado': PayloadBloqueoAdicional
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
    /**
     * Caídas repetidas (A2, pedido A6 de Iris): el servicio acumuló `sesiones` sesiones terminadas
     * (sin contar las causas ignoradas: Disconnect de Argos, reinicio del router, cierre del cron)
     * entre `desde` y `hasta`, dentro de `ventana_minutos`, con `umbral` como mínimo. A lo sumo uno
     * por servicio y ventana. Lo reenvía A6 por webhook a Iris (ticket proactivo).
     */
    'servicio.caidas_repetidas': {
        servicio_id: number
        empresa_id: number
        cliente_id: number
        router_id: number
        /** Sesión cuyo cierre cruzó el umbral */
        sesion_id: number
        sesiones: number
        /** ISO: fin de la primera sesión contada / de la última (la que cruzó el umbral) */
        desde: string
        hasta: string
        umbral: number
        ventana_minutos: number
        /** Sesiones contadas por `causa_fin` (`Lost-Carrier`, `User-Request`, …) */
        causas: Record<string, number>
    }
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
    /**
     * B: el saldo pequeño que dejó el pago se cerró como gasto (`5.3.05 / CxC`, sin tocar IVA ni DTE);
     * las facturas quedaron cubiertas y sus servicios ya se reevaluaron en la acción
     */
    'pago.diferencia_cerrada': {
        pago_id: number
        empresa_id: number
        /** pagador */
        cliente_id: number
        facturas: number[]
        monto: Dinero
    }
    /**
     * Contracargo abierto en la pasarela sobre un pago registrado (Recurrente `dispute.*`): sin acción
     * automática; A6 avisa a contabilidad. Una vez por pago (los `dispute.update` no lo repiten)
     */
    'pago.disputa_abierta': {
        pago_id: number
        empresa_id: number
        /** cobro en línea (`billing.pasarela_cobros.id`) */
        cobro_id: number
        /** pagador */
        cliente_id: number
        monto: Dinero
        proveedor: string
        /** razón del emisor o del tarjetahabiente (`fraudulent`, `duplicate`…); null si no viene */
        motivo: string | null
    }
    /**
     * Decisión del PM (19 oct): lo que sería una factura de Q0 (mes gratis, descuento del 100 %, cargo
     * sin costo, canje) es una bonificación interna; sin CxC ni documento para el cliente
     */
    'bonificacion.registrada': {
        bonificacion_id: number
        empresa_id: number
        cliente_id: number
        servicio_id: number | null
        /** YYYY-MM-DD */
        periodo: string
        origen: 'mes_gratis' | 'descuento_100' | 'cargo_sin_costo' | 'canje'
        /** valor con IVA de lo bonificado */
        bruto: Dinero
    }
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
    /**
     * Cambió el bloqueo `tipo` del libro de la empresa (contrato de localización fiscal §10.4):
     * `hasta` es el vigente nuevo (null = sin bloqueo de ese tipo) y `anterior` el que había.
     */
    'libro.bloqueo_cambiado': {
        empresa_id: number
        tipo: 'global' | 'ventas' | 'compras' | 'impuestos' | 'duro'
        hasta: string | null
        anterior: string | null
    }
    /**
     * Un cron (`proceso`: `facturas.generar`, `facturas.vencer_pendientes`) no pudo contabilizar
     * `documentos` porque `fecha` cae bajo el bloqueo `tipo` (hasta `hasta`). Quedan pendientes y
     * se reintentan en la siguiente corrida. Uno por corrida, empresa y tipo.
     */
    /**
     * `cierres.verificar` corrió la lista de verificación de cierre de la empresa (§10.5):
     * `periodo` AAAA-MM o AAAA; `anomalias` = claves en anomalía sin supervisar.
     */
    'libro.checks_verificados': {
        empresa_id: number
        tipo: 'mensual' | 'impuestos' | 'anual'
        periodo: string
        anomalias: string[]
    }
    'libro.proceso_bloqueado': {
        empresa_id: number
        proceso: string
        tipo: 'global' | 'ventas' | 'compras' | 'impuestos' | 'duro'
        hasta: string | null
        fecha: string
        documentos: number
        ejemplos: number[]
    }
    /**
     * Cierre anual (§9.1, fase 6 PR C): el ejercicio `anio` de la empresa quedó cerrado (resultados
     * en cero, traslado a 3.3.01, reserva legal y diciembre cerrado). Montos con 2 decimales.
     */
    'ejercicio.cerrado': {
        empresa_id: number
        cierre_id: number
        anio: number
        resultado: string
        isr: string
        reserva_legal: string
    }
    /** Un admin reabrió el ejercicio: los asientos del cierre se revirtieron y diciembre quedó abierto. */
    'ejercicio.reabierto': {
        empresa_id: number
        cierre_id: number
        anio: number
        motivo: string
    }
    /**
     * Emisión oficial con folio de un libro legal (§7, fase 6 PR D): `desde`/`hasta` meses completos,
     * folios usados y SHA-256 del archivo guardado. `reimpresion_de` = la emisión anterior que cubría
     * el rango (null si es la primera).
     */
    'libro.emitido': {
        emision_id: number
        empresa_id: number
        libro: 'diario' | 'mayor' | 'compras' | 'ventas'
        desde: string
        hasta: string
        folio_inicial: number
        folio_final: number
        formato: 'pdf' | 'xlsx'
        sha256: string
        reimpresion_de: number | null
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
    /**
     * Calendario fiscal (fase 7 PR A, §11.3 y §21): una obligación sin presentar alcanzó un umbral
     * (`umbral` 7, 3, 1 o 0 días). Una vez por obligación y umbral; `dias` = días calendario que
     * faltan (igual al umbral salvo que el cron haya estado detenido). Lo emite el cron.
     */
    'fiscal.vencimiento_proximo': {
        obligacion_id: number
        empresa_id: number
        impuesto: string
        periodo_desde: string
        periodo_hasta: string
        formulario: string | null
        vence_en: string
        dias: number
        umbral: number
    }
    /**
     * Pequeño contribuyente: lo facturado del año (libro de ventas) alcanzó `umbral_pct` del
     * `pc_limite_anual`. Una vez por umbral y año. Montos con 2 decimales.
     */
    'fiscal.limite_pc': {
        empresa_id: number
        umbral_pct: string
        acumulado: string
        limite: string
        anio: number
    }
    /**
     * Declaraciones (fase 7 PR B, §9.3, §10.6 y §11.3): borradores que el sistema nunca presenta.
     * `monto` = `a_pagar` del borrador (en `pagada`, lo pagado con mora y multa). `version` 1, 2…
     */
    'declaracion.calculada': PayloadDeclaracion
    'declaracion.revisada': PayloadDeclaracion
    'declaracion.presentada': PayloadDeclaracion
    'declaracion.pagada': PayloadDeclaracion
    'declaracion.pago_anulado': PayloadPagoDeclaracionAnulado
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
    /**
     * Inventario (A3, `contratos/inventario.md` §7, fase A). `cantidad` con signo (+ entra, − sale)
     * y hasta 3 decimales, como texto; `costo_total` con signo.
     */
    'inventario.movimiento_registrado': {
        movimiento_id: number
        empresa_id: number
        tipo: string
        producto_id: number
        bodega_id: number
        cantidad: string
        costo_total: Dinero
        unidad_id: number | null
        servicio_id: number | null
        origen_tipo: string | null
        origen_id: number | null
        /** orden de Iris que lo originó (`iris_orden`, `contratos/iris.md` §5.1 A3); null sin ella */
        origen_externo_tipo: string | null
        origen_externo_id: string | null
    }
    /** Una unidad de serie se prestó en comodato a un servicio (fase B). */
    'inventario.comodato_asignado': PayloadComodato & OrigenExternoPayload
    /** La unidad volvió del servicio a una bodega, a su valor en libros. */
    'inventario.comodato_devuelto': PayloadComodato &
        OrigenExternoPayload & { condicion: 'nuevo' | 'usado'; bodega_id: number }
    /** El servicio se retiró con la unidad en comodato: queda por recuperar. */
    'inventario.equipo_por_recuperar': PayloadComodato
    /** La existencia total del producto cruzó su mínimo hacia abajo; `bodega_id` null = total. */
    'inventario.existencia_minima': {
        empresa_id: number
        producto_id: number
        bodega_id: number | null
        cantidad: string
        minimo: string
    }
    /** Se cerró un conteo físico (fase C): valor del faltante y del sobrante ajustados, y líneas contadas. */
    'inventario.conteo_cerrado': {
        conteo_id: number
        empresa_id: number
        bodega_id: number
        faltante: Dinero
        sobrante: Dinero
        lineas: number
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
    /** §7.4: se avisó a un ganador (titular o suplente que tomó un premio); notify avisa al cliente */
    'sorteo.ganador_notificado': {
        sorteo_id: number
        empresa_id: number
        ganador_id: number
        cliente_id: number
        posicion: number
        tipo: 'titular' | 'suplente'
        /** código público (seudónimo) del participante */
        codigo: string
        premio: { posicion: number; nombre: string; valor: Dinero; tipo: string }
        /** ISO 8601: fin del plazo para reclamar */
        reclamar_antes: string
        /** el ganador cuyo premio no reclamado toma (suplente), o null */
        sustituye_a: number | null
    }
    /** §7.4: venció el plazo de reclamo; el premio pasó al siguiente suplente (o quedó sin reclamar) */
    'sorteo.premio_no_reclamado': {
        sorteo_id: number
        empresa_id: number
        ganador_id: number
        cliente_id: number
        posicion: number
        premio_posicion: number
        /** el suplente que lo toma, o null si no quedan */
        suplente_id: number | null
        motivo: string
    }
    /** §7.3 punto 6: se cerró el acta (PDF con su SHA-256) */
    'sorteo.acta_cerrada': { sorteo_id: number; empresa_id: number; acta_hash: string }
    /** H22: se deshizo la entrega de un premio (egreso, asiento o canje, e ISR) con `sorteos.anular_entrega` */
    'sorteo.entrega_anulada': {
        sorteo_id: number
        empresa_id: number
        cliente_id: number
        posicion: number
        motivo: string
    }
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
/** Orden de Iris que originó la operación (`contratos/iris.md` §5.1 A3); null sin ella. */
interface OrigenExternoPayload {
    origen_externo_tipo: string | null
    origen_externo_id: string | null
}

/** Unidad de serie en comodato (`contratos/inventario.md` §7). */
interface PayloadComodato {
    unidad_id: number
    empresa_id: number
    servicio_id: number
    cliente_id: number
    producto_id: number
    serie: string | null
    mac: string | null
}

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
    /** aditivo (decisión del PM, 19 oct): la bonificación a la que se aplicó en lugar de una factura de Q0 */
    bonificacion_id?: number | null
}

export interface PayloadDeclaracion {
    declaracion_id: number
    empresa_id: number
    impuesto: string
    periodo_desde: string
    periodo_hasta: string
    vence_en: string
    monto: string
    version: number
    /** solo `declaracion.revisada` de una rectificación en cascada (H34): la revisión que la causó */
    motivo?: 'cascada'
    cascada_de?: number
    /** solo en la cascada (fase 8, pedido de A6): la versión sustituida estaba presentada */
    estaba_presentada?: boolean
    /** solo `declaracion.pagada` (fase 8, pedido de A6): el pago registrado */
    pago_id?: number
}

/** `declaracion.pago_anulado` (fase 7 PR C): `monto` = total del pago anulado (impuesto, mora y multa). */
export interface PayloadPagoDeclaracionAnulado extends Omit<
    PayloadDeclaracion,
    'motivo' | 'cascada_de' | 'estaba_presentada' | 'pago_id'
> {
    pago_id: number
    /** reverso del asiento `pago_impuesto` */
    asiento_id: number
    motivo: string
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
    'adicional.bloqueado',
    'adicional.desbloqueado',
    'plan.velocidad_cambiada',
    'router.control_cambiado',
    'servicio.eliminado',
    'router.eliminado',
    'cliente.actualizado',
    'sesion.iniciada',
    'sesion.terminada',
    'servicio.caidas_repetidas',
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
    'pago.diferencia_cerrada',
    'pago.disputa_abierta',
    'bonificacion.registrada',
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
    'libro.bloqueo_cambiado',
    'libro.proceso_bloqueado',
    'ejercicio.cerrado',
    'ejercicio.reabierto',
    'libro.checks_verificados',
    'libro.emitido',
    'notificacion.enviada',
    'notificaciones.config_cambiada',
    'fiscal.localizacion_instalada',
    'fiscal.parametros_cambiados',
    'fiscal.config_cambiada',
    'fiscal.vencimiento_proximo',
    'fiscal.limite_pc',
    'declaracion.calculada',
    'declaracion.revisada',
    'declaracion.presentada',
    'declaracion.pagada',
    'declaracion.pago_anulado',
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
    'inventario.movimiento_registrado',
    'inventario.comodato_asignado',
    'inventario.comodato_devuelto',
    'inventario.equipo_por_recuperar',
    'inventario.existencia_minima',
    'inventario.conteo_cerrado',
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
    'sorteo.entrega_anulada',
    'sorteo.ganador_notificado',
    'sorteo.premio_no_reclamado',
    'sorteo.acta_cerrada',
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
