import type { ProblemaFila } from '#importacion/fuente'

/**
 * Reporte de una corrida del importador. Todo id de `*_mw` es el id de Mikrowisp; los ids de
 * ArgosIsp van sin sufijo. Se imprime como texto (`formatearReporte`) y se guarda como JSON.
 */

export interface ConteoEntidad {
    /** filas válidas en el origen */
    origen: number
    /** creadas por esta corrida (en seco: las que se crearían) */
    creados: number
    /** ya importadas en una corrida anterior (idempotencia) */
    existentes: number
    /** no importadas: ver diferencias y errores */
    omitidos: number
}

export interface ReporteImportacion {
    modo: 'en_seco' | 'real'
    request_id: string
    inicio: string
    fin: string
    directorio: string | null
    resumen: {
        routers: ConteoEntidad
        redes: ConteoEntidad
        planes: ConteoEntidad
        zonas: ConteoEntidad
        clientes: ConteoEntidad
        implementaciones: ConteoEntidad
        servicios: ConteoEntidad
        /** facturas pendientes (ImportarFacturaPendiente de A3) */
        facturas: ConteoEntidad
        /** saldos iniciales por cliente (RegistrarSaldoInicial de A3) */
        saldos: ConteoEntidad
        /** pagos históricos (acción de A3 pendiente: hoy todos omitidos) */
        pagos: ConteoEntidad
    }
    /** cómo se reconoce lo ya importado: `core.ids_externos` o solo claves naturales */
    ids_externos: 'tabla' | 'ninguno'
    /**
     * Suma de saldos: origen (saldos.csv, o la suma de sus facturas pendientes si el cliente no
     * está en saldos.csv) contra lo que queda en ArgosIsp (CxC − anticipos de cada cliente, dentro
     * de la misma transacción; en seco, antes de revertir). Montos con 2 decimales y signo.
     */
    saldos: {
        clientes: number
        suma_origen: string
        suma_importada: string
        diferencia: string
        cuadra: boolean
    }
    diferencias: {
        /** router sin usuario/clave de la API o sin secreto RADIUS: se importa igual */
        routers_sin_credenciales: Array<{ router_mw: string; nombre: string; faltan: string[] }>
        /** mismo NIT en varios clientes del origen: se importan todos */
        clientes_nit_duplicado: Array<{ nit: string; clientes_mw: string[] }>
        /** servicio sin plan en el origen: no se importa (sus facturas van al saldo inicial) */
        servicios_sin_plan: Array<{ servicio_mw: string; cliente_mw: string; etiqueta: string }>
        /** pago de un cliente a la factura de otro (informativo: el pendiente ya lo descuenta) */
        pagos_cruzados: Array<{
            pago_mw: string
            pagador_mw: string
            factura_mw: string
            dueno_mw: string
            monto: string
        }>
        /** misma IP en varios servicios del origen: se importa el primero (por orden del archivo) */
        ips_duplicadas: Array<{ ip: string; servicios_mw: string[]; importado_mw: string | null }>
        /** la IP no cae en ninguna red del router: el servicio no se importa */
        ips_fuera_de_red: Array<{ servicio_mw: string; ip: string; router_mw: string }>
        /** la IP ya la tiene otro servicio de ArgosIsp */
        ips_en_uso: Array<{ servicio_mw: string; ip: string; servicio_id: number }>
        /** servicio sin IP en el origen: ArgosIsp le asignó una */
        ips_nuevas: Array<{ servicio_mw: string; ip: string | null }>
        planes_sin_equivalente: Array<{
            plan_mw: string
            nombre: string | null
            motivo: string
            servicios: number
        }>
        clientes_sin_nit: Array<{ cliente_mw: string; nombre: string }>
        nit_invalidos: Array<{ cliente_mw: string; nombre: string; nit: string; motivo: string }>
        user_ppp_duplicados: Array<{ user_ppp: string; servicios_mw: string[]; motivo: string }>
        /** estado en Mikrowisp distinto de activo: se aplicará con las facturas (A3) */
        servicios_suspendidos_origen: Array<{ servicio_mw: string; user_ppp: string }>
        servicios_retirados_origen: Array<{ servicio_mw: string; user_ppp: string }>
        /** referencias rotas: cliente, router o plan que no está o no se pudo importar */
        referencias_faltantes: Array<{ entidad: string; id_mw: string; falta: string; id_falta_mw: string }>
        /** servicio sin PPPoE (ip_estatica, dhcp_fija) que ArgosIsp aún no admite: no se importa */
        tipos_conexion_pendientes: Array<{ servicio_mw: string; tipo_conexion: string; motivo: string }>
        /** factura sin servicio en ArgosIsp: su monto entra en el saldo inicial del cliente */
        facturas_a_saldo: Array<{ factura_mw: string; cliente_mw: string; pendiente: string; motivo: string }>
        /** cliente cuyo saldo en ArgosIsp no es el del origen */
        saldos_distintos: Array<{
            cliente_mw: string
            nombre: string | null
            origen: string
            importado: string
            diferencia: string
        }>
    }
    /** filas con formato inválido (omitidas) o campos descartados (avisos) */
    formato: ProblemaFila[]
    /** errores que devolvieron las acciones de dominio */
    errores: Array<{ entidad: string; id_mw: string; accion: string; mensaje: string }>
    /** lo que falta del origen y queda para otra tarea */
    pendiente: string[]
}

export function conteoVacio(origen = 0): ConteoEntidad {
    return { origen, creados: 0, existentes: 0, omitidos: 0 }
}

export function formatearReporte(r: ReporteImportacion): string {
    const lineas: string[] = []
    const titulo = r.modo === 'en_seco' ? 'EN SECO (nada se guardó)' : 'REAL'
    lineas.push(`Importación desde Mikrowisp · ${titulo}`)
    lineas.push(`request_id ${r.request_id} · ${r.inicio} → ${r.fin}`)
    if (r.directorio) lineas.push(`origen ${r.directorio}`)
    lineas.push('')
    lineas.push('Entidad            origen  creados  existentes  omitidos')
    for (const [nombre, c] of Object.entries(r.resumen)) {
        lineas.push(
            `${nombre.padEnd(18)} ${String(c.origen).padStart(6)} ${String(c.creados).padStart(8)} ${String(
                c.existentes,
            ).padStart(11)} ${String(c.omitidos).padStart(9)}`,
        )
    }
    lineas.push('')
    lineas.push(
        `Saldos (${r.saldos.clientes} clientes): origen Q ${r.saldos.suma_origen} · ArgosIsp Q ${r.saldos.suma_importada} · ` +
            (r.saldos.cuadra ? 'CUADRA' : `DIFERENCIA Q ${r.saldos.diferencia}`),
    )
    lineas.push(
        `Ids externos: ${r.ids_externos === 'tabla' ? 'core.ids_externos' : 'claves naturales (sin core.ids_externos)'}`,
    )

    const d = r.diferencias
    const seccion = (titulo2: string, filas: string[]) => {
        if (filas.length === 0) return
        lineas.push('', `${titulo2} (${filas.length})`)
        for (const fila of filas) lineas.push(`  - ${fila}`)
    }
    seccion(
        'Routers sin credenciales (se importan; cargarlas en el panel)',
        d.routers_sin_credenciales.map(
            (x) => `router ${x.router_mw} ${x.nombre}: falta ${x.faltan.join(', ')}`,
        ),
    )
    seccion(
        'Clientes con el mismo NIT (se importan todos)',
        d.clientes_nit_duplicado.map((x) => `NIT ${x.nit}: clientes ${x.clientes_mw.join(', ')}`),
    )
    seccion(
        'Servicios sin plan (no se importan; sus facturas van al saldo inicial)',
        d.servicios_sin_plan.map(
            (x) => `servicio ${x.servicio_mw} (${x.etiqueta}) · cliente ${x.cliente_mw}`,
        ),
    )
    seccion(
        'Pagos a facturas de otro cliente (informativo)',
        d.pagos_cruzados.map(
            (x) =>
                `pago ${x.pago_mw}: cliente ${x.pagador_mw} pagó Q ${x.monto} de la factura ${x.factura_mw} del cliente ${x.dueno_mw}`,
        ),
    )
    seccion(
        'IPs duplicadas en el origen',
        d.ips_duplicadas.map(
            (x) =>
                `${x.ip}: servicios ${x.servicios_mw.join(', ')}; se importa ${x.importado_mw ?? 'ninguno'}`,
        ),
    )
    seccion(
        'IPs fuera de las redes del router',
        d.ips_fuera_de_red.map((x) => `servicio ${x.servicio_mw}: ${x.ip} (router ${x.router_mw})`),
    )
    seccion(
        'IPs en uso por otro servicio de ArgosIsp',
        d.ips_en_uso.map((x) => `servicio ${x.servicio_mw}: ${x.ip} (servicio ${x.servicio_id})`),
    )
    seccion(
        'Servicios sin IP en el origen (IP nueva)',
        d.ips_nuevas.map((x) => `servicio ${x.servicio_mw}: ${x.ip ?? 'del pool del router'}`),
    )
    seccion(
        'Planes sin equivalente',
        d.planes_sin_equivalente.map(
            (x) =>
                `plan ${x.plan_mw}${x.nombre ? ` ${x.nombre}` : ''}: ${x.motivo} (${x.servicios} servicios)`,
        ),
    )
    seccion(
        'Clientes sin NIT (se importan sin NIT)',
        d.clientes_sin_nit.map((x) => `cliente ${x.cliente_mw}: ${x.nombre}`),
    )
    seccion(
        'NIT inválidos (se importan sin NIT; el original queda en campos_personalizados.mikrowisp_nit)',
        d.nit_invalidos.map((x) => `cliente ${x.cliente_mw}: ${x.nombre} · "${x.nit}" · ${x.motivo}`),
    )
    seccion(
        'user_ppp duplicados',
        d.user_ppp_duplicados.map(
            (x) => `${x.user_ppp}: servicios ${x.servicios_mw.join(', ')} · ${x.motivo}`,
        ),
    )
    seccion(
        'Suspendidos en Mikrowisp (se importan activos; el corte se aplica con las facturas)',
        d.servicios_suspendidos_origen.map((x) => `servicio ${x.servicio_mw}: ${x.user_ppp}`),
    )
    seccion(
        'Retirados en Mikrowisp (no se importan)',
        d.servicios_retirados_origen.map((x) => `servicio ${x.servicio_mw}: ${x.user_ppp}`),
    )
    seccion(
        'Referencias faltantes',
        d.referencias_faltantes.map((x) => `${x.entidad} ${x.id_mw}: falta ${x.falta} ${x.id_falta_mw}`),
    )
    seccion(
        'Servicios sin PPPoE pendientes (no se importan)',
        d.tipos_conexion_pendientes.map((x) => `servicio ${x.servicio_mw} (${x.tipo_conexion}): ${x.motivo}`),
    )
    seccion(
        'Facturas sin servicio en ArgosIsp (su monto va al saldo inicial del cliente)',
        d.facturas_a_saldo.map(
            (x) => `factura ${x.factura_mw} · cliente ${x.cliente_mw} · Q ${x.pendiente}: ${x.motivo}`,
        ),
    )
    seccion(
        'Saldos distintos al origen',
        d.saldos_distintos.map(
            (x) =>
                `cliente ${x.cliente_mw}${x.nombre ? ` ${x.nombre}` : ''}: origen Q ${x.origen} · ArgosIsp Q ${x.importado} · diferencia Q ${x.diferencia}`,
        ),
    )
    seccion(
        'Formato',
        r.formato.map(
            (x) =>
                `${x.archivo}:${x.linea}${x.id ? ` (id ${x.id})` : ''} ${x.aviso ? 'aviso' : 'omitida'}: ${x.mensaje}`,
        ),
    )
    seccion(
        'Errores de las acciones',
        r.errores.map((x) => `${x.entidad} ${x.id_mw} · ${x.accion}: ${x.mensaje}`),
    )
    seccion('Pendiente', r.pendiente)
    return lineas.join('\n')
}
