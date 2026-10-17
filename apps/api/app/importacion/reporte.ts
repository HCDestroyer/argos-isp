import type { ProblemaFila } from '#importacion/canonico'
import type { CuadreTabla } from '#importacion/archivo'

export type { CuadreTabla } from '#importacion/archivo'

/** Montos del origen o de ArgosIsp para el cuadre de dinero (strings con 2 decimales). */
export interface MontosCuadre {
    /** total de las facturas (IVA incluido) */
    facturado: string
    /** lo cobrado de esas facturas (total − pendiente) */
    cobrado: string
    /** lo que se debe de esas facturas */
    pendiente: string
    /** suma de los pagos registrados */
    pagos: string
}

/**
 * Reporte de una corrida del importador. Todo id de `*_origen` es el id del sistema de origen; los ids de
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
    /** sistema de origen (`mikrowisp`, `smartisp`, `csv` o el `--sistema` del CSV) */
    origen: string
    /** archivo o directorio leído */
    fuente: string | null
    /** empresa a la que se asignó lo importado (`--empresa` o la única activa) */
    empresa: { id: number; nombre: string; nit: string | null }
    /** tablas del origen que no se archivaron ni se cuentan (`--excluir-tablas`) */
    tablas_excluidas: Array<{ tabla: string; filas: number }>
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
        /** pagos históricos (RegistrarPagoHistorico de A3, modo B) */
        pagos: ConteoEntidad
        /** promesas vigentes del origen */
        promesas: ConteoEntidad
    }
    /** líneas informativas del adaptador (p. ej. servicios sin PPPoE por router) */
    notas_origen: string[]
    /**
     * Cuadre de dinero del origen contra ArgosIsp. En ArgosIsp cuentan las facturas y pagos de
     * esta importación (por su id externo) y los saldos iniciales, que explican lo que no entró
     * como factura o pago.
     */
    dinero: {
        origen: MontosCuadre
        argosisp: MontosCuadre & { saldos_iniciales: string }
        /** ArgosIsp − origen */
        diferencia: MontosCuadre
        /** lo que explica cada diferencia */
        explicacion: string[]
    }
    /** cuadre por tabla del origen: leídas = creadas + existentes + solo archivo + omitidas */
    tablas: CuadreTabla[]
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
        routers_sin_credenciales: Array<{ router_origen: string; nombre: string; faltan: string[] }>
        /** mismo NIT en varios clientes del origen: se importan todos */
        clientes_nit_duplicado: Array<{ nit: string; clientes_origen: string[] }>
        /** servicio sin plan en el origen: no se importa (sus facturas van al saldo inicial) */
        servicios_sin_plan: Array<{ servicio_origen: string; cliente_origen: string; etiqueta: string }>
        /** pago de un cliente a la factura de otro (informativo: el pago histórico la salda igual) */
        pagos_cruzados: Array<{
            pago_origen: string
            pagador_origen: string
            factura_origen: string
            dueno_origen: string
            monto: string
        }>
        /** pago cuya factura no entró: queda a favor del pagador y el saldo inicial lo compensa */
        pagos_sin_factura: Array<{
            pago_origen: string
            factura_origen: string
            monto: string
            motivo: string
        }>
        /** pago del origen que no se importa (p. ej. sin fecha); el saldo inicial lo compensa */
        pagos_no_importados: Array<{
            pago_origen: string
            cliente_origen: string
            monto: string
            motivo: string
        }>
        /** misma IP en varios servicios del origen: se importa el primero (por orden del archivo) */
        ips_duplicadas: Array<{ ip: string; servicios_origen: string[]; importado_origen: string | null }>
        /** la IP no cae en ninguna red del router: el servicio no se importa */
        ips_fuera_de_red: Array<{ servicio_origen: string; ip: string; router_origen: string }>
        /** la IP ya la tiene otro servicio de ArgosIsp */
        ips_en_uso: Array<{ servicio_origen: string; ip: string; servicio_id: number }>
        /** servicio sin IP en el origen: ArgosIsp le asignó una */
        ips_nuevas: Array<{ servicio_origen: string; ip: string | null }>
        planes_sin_equivalente: Array<{
            plan_origen: string
            nombre: string | null
            motivo: string
            servicios: number
        }>
        clientes_sin_nit: Array<{ cliente_origen: string; nombre: string }>
        nit_invalidos: Array<{ cliente_origen: string; nombre: string; nit: string; motivo: string }>
        user_ppp_duplicados: Array<{ user_ppp: string; servicios_origen: string[]; motivo: string }>
        /** estado en el origen distinto de activo: se aplicará con las facturas (A3) */
        servicios_suspendidos_origen: Array<{ servicio_origen: string; user_ppp: string }>
        servicios_retirados_origen: Array<{ servicio_origen: string; user_ppp: string }>
        /** referencias rotas: cliente, router o plan que no está o no se pudo importar */
        referencias_faltantes: Array<{
            entidad: string
            id_origen: string
            falta: string
            id_falta_origen: string
        }>
        /** servicio sin PPPoE (ip_estatica, dhcp_fija) que ArgosIsp aún no admite: no se importa */
        tipos_conexion_pendientes: Array<{ servicio_origen: string; tipo_conexion: string; motivo: string }>
        /** factura sin servicio en ArgosIsp: su monto entra en el saldo inicial del cliente */
        facturas_a_saldo: Array<{
            factura_origen: string
            cliente_origen: string
            pendiente: string
            motivo: string
        }>
        /** factura de cargo único (sin periodo): con su nota del origen */
        facturas_cargo_unico: Array<{
            factura_origen: string
            cliente_origen: string
            total: string
            nota: string | null
        }>
        /** factura sin cargo (total 0): no mueve dinero */
        facturas_sin_cargo: Array<{ factura_origen: string; cliente_origen: string; motivo: string }>
        /** factura pagada en el origen sin ningún pago que la cubra: entra `saldada_en_origen` */
        facturas_saldadas_en_origen: Array<{ factura_origen: string; cliente_origen: string; total: string }>
        /** promesa vigente del origen que no entró */
        promesas_no_importadas: Array<{ promesa_origen: string; cliente_origen: string; motivo: string }>
        /** cliente cuyo saldo en ArgosIsp no es el del origen */
        saldos_distintos: Array<{
            cliente_origen: string
            nombre: string | null
            origen: string
            importado: string
            diferencia: string
        }>
        /** servicio ya importado en otra empresa: no se mueve (`servicios.cambiar_empresa` en el panel) */
        servicios_otra_empresa: Array<{ servicio_origen: string; servicio_id: number; empresa_id: number }>
    }
    /** filas con formato inválido (omitidas) o campos descartados (avisos) */
    formato: ProblemaFila[]
    /** errores que devolvieron las acciones de dominio */
    errores: Array<{ entidad: string; id_origen: string; accion: string; mensaje: string }>
    /** lo que falta del origen y queda para otra tarea */
    pendiente: string[]
}

export function conteoVacio(origen = 0): ConteoEntidad {
    return { origen, creados: 0, existentes: 0, omitidos: 0 }
}

export function formatearReporte(r: ReporteImportacion): string {
    const lineas: string[] = []
    const titulo = r.modo === 'en_seco' ? 'EN SECO (nada se guardó)' : 'REAL'
    lineas.push(`Importación desde ${r.origen} · ${titulo}`)
    lineas.push(`request_id ${r.request_id} · ${r.inicio} → ${r.fin}`)
    if (r.fuente) lineas.push(`fuente ${r.fuente}`)
    lineas.push(
        `empresa ${r.empresa.id} · ${r.empresa.nombre}${r.empresa.nit ? ` · NIT ${r.empresa.nit}` : ''}`,
    )
    if (r.tablas_excluidas.length > 0) {
        lineas.push(
            `tablas excluidas del archivo: ${r.tablas_excluidas.map((t) => `${t.tabla} (${t.filas} filas)`).join(', ')}`,
        )
    }
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
    const m = r.dinero
    lineas.push('', 'Dinero            origen       ArgosIsp     diferencia')
    for (const campo of ['facturado', 'cobrado', 'pendiente', 'pagos'] as const) {
        lineas.push(
            `${campo.padEnd(14)} ${m.origen[campo].padStart(12)} ${m.argosisp[campo].padStart(12)} ${m.diferencia[campo].padStart(12)}`,
        )
    }
    lineas.push(`saldos iniciales en ArgosIsp: Q ${m.argosisp.saldos_iniciales}`)
    for (const e of m.explicacion) lineas.push(`  - ${e}`)
    if (r.tablas.length > 0) {
        lineas.push(
            '',
            'Tabla del origen        leídas  creadas  existentes  al saldo  solo archivo  omitidas',
        )
        for (const t of r.tablas) {
            lineas.push(
                `${t.tabla.padEnd(22)} ${String(t.leidas).padStart(7)} ${String(t.creadas).padStart(8)} ${String(t.existentes).padStart(11)} ${String(t.al_saldo).padStart(9)} ${String(t.solo_archivo).padStart(13)} ${String(t.omitidas).padStart(9)}`,
            )
        }
    }
    for (const n of r.notas_origen) lineas.push(n)

    const d = r.diferencias
    const seccion = (titulo2: string, filas: string[]) => {
        if (filas.length === 0) return
        lineas.push('', `${titulo2} (${filas.length})`)
        for (const fila of filas) lineas.push(`  - ${fila}`)
    }
    seccion(
        'Routers sin credenciales (se importan; cargarlas en el panel)',
        d.routers_sin_credenciales.map(
            (x) => `router ${x.router_origen} ${x.nombre}: falta ${x.faltan.join(', ')}`,
        ),
    )
    seccion(
        'Clientes con el mismo NIT (se importan todos)',
        d.clientes_nit_duplicado.map((x) => `NIT ${x.nit}: clientes ${x.clientes_origen.join(', ')}`),
    )
    seccion(
        'Servicios sin plan (no se importan; sus facturas van al saldo inicial)',
        d.servicios_sin_plan.map(
            (x) => `servicio ${x.servicio_origen} (${x.etiqueta}) · cliente ${x.cliente_origen}`,
        ),
    )
    seccion(
        'Pagos a facturas de otro cliente (informativo)',
        d.pagos_cruzados.map(
            (x) =>
                `pago ${x.pago_origen}: cliente ${x.pagador_origen} pagó Q ${x.monto} de la factura ${x.factura_origen} del cliente ${x.dueno_origen}`,
        ),
    )
    seccion(
        'Pagos cuya factura no entró (quedan a favor; el saldo inicial lo compensa)',
        d.pagos_sin_factura.map(
            (x) => `pago ${x.pago_origen} · factura ${x.factura_origen} · Q ${x.monto}: ${x.motivo}`,
        ),
    )
    seccion(
        'Pagos no importados (el saldo inicial lo compensa)',
        d.pagos_no_importados.map(
            (x) => `pago ${x.pago_origen} · cliente ${x.cliente_origen} · Q ${x.monto}: ${x.motivo}`,
        ),
    )
    seccion(
        'IPs duplicadas en el origen',
        d.ips_duplicadas.map(
            (x) =>
                `${x.ip}: servicios ${x.servicios_origen.join(', ')}; se importa ${x.importado_origen ?? 'ninguno'}`,
        ),
    )
    seccion(
        'IPs fuera de las redes del router',
        d.ips_fuera_de_red.map((x) => `servicio ${x.servicio_origen}: ${x.ip} (router ${x.router_origen})`),
    )
    seccion(
        'IPs en uso por otro servicio de ArgosIsp',
        d.ips_en_uso.map((x) => `servicio ${x.servicio_origen}: ${x.ip} (servicio ${x.servicio_id})`),
    )
    seccion(
        'Servicios sin IP en el origen (IP nueva)',
        d.ips_nuevas.map((x) => `servicio ${x.servicio_origen}: ${x.ip ?? 'del pool del router'}`),
    )
    seccion(
        'Planes sin equivalente',
        d.planes_sin_equivalente.map(
            (x) =>
                `plan ${x.plan_origen}${x.nombre ? ` ${x.nombre}` : ''}: ${x.motivo} (${x.servicios} servicios)`,
        ),
    )
    seccion(
        'Clientes sin NIT (se importan sin NIT)',
        d.clientes_sin_nit.map((x) => `cliente ${x.cliente_origen}: ${x.nombre}`),
    )
    seccion(
        `NIT inválidos (se importan sin NIT; el original queda en campos_personalizados.${r.origen}_nit)`,
        d.nit_invalidos.map((x) => `cliente ${x.cliente_origen}: ${x.nombre} · "${x.nit}" · ${x.motivo}`),
    )
    seccion(
        'user_ppp duplicados',
        d.user_ppp_duplicados.map(
            (x) => `${x.user_ppp}: servicios ${x.servicios_origen.join(', ')} · ${x.motivo}`,
        ),
    )
    seccion(
        'Suspendidos en el origen (se importan activos; el corte se aplica con las facturas)',
        d.servicios_suspendidos_origen.map((x) => `servicio ${x.servicio_origen}: ${x.user_ppp}`),
    )
    seccion(
        'Retirados en el origen (no se importan)',
        d.servicios_retirados_origen.map((x) => `servicio ${x.servicio_origen}: ${x.user_ppp}`),
    )
    seccion(
        'Referencias faltantes',
        d.referencias_faltantes.map(
            (x) => `${x.entidad} ${x.id_origen}: falta ${x.falta} ${x.id_falta_origen}`,
        ),
    )
    seccion(
        'Servicios sin PPPoE pendientes (no se importan)',
        d.tipos_conexion_pendientes.map(
            (x) => `servicio ${x.servicio_origen} (${x.tipo_conexion}): ${x.motivo}`,
        ),
    )
    seccion(
        'Facturas sin servicio en ArgosIsp (su monto va al saldo inicial del cliente)',
        d.facturas_a_saldo.map(
            (x) =>
                `factura ${x.factura_origen} · cliente ${x.cliente_origen} · Q ${x.pendiente}: ${x.motivo}`,
        ),
    )
    seccion(
        'Cargos únicos (sin periodo)',
        d.facturas_cargo_unico.map(
            (x) =>
                `factura ${x.factura_origen} · cliente ${x.cliente_origen} · Q ${x.total}${x.nota ? ` · ${x.nota}` : ''}`,
        ),
    )
    seccion(
        'Facturas sin cargo (total 0)',
        d.facturas_sin_cargo.map(
            (x) => `factura ${x.factura_origen} · cliente ${x.cliente_origen}: ${x.motivo}`,
        ),
    )
    seccion(
        'Facturas pagadas sin ningún pago en el origen (entran saldadas en el origen, sin asiento)',
        d.facturas_saldadas_en_origen.map(
            (x) => `factura ${x.factura_origen} · cliente ${x.cliente_origen} · Q ${x.total}`,
        ),
    )
    seccion(
        'Promesas no importadas',
        d.promesas_no_importadas.map(
            (x) => `promesa ${x.promesa_origen} · cliente ${x.cliente_origen}: ${x.motivo}`,
        ),
    )
    seccion(
        'Saldos distintos al origen',
        d.saldos_distintos.map(
            (x) =>
                `cliente ${x.cliente_origen}${x.nombre ? ` ${x.nombre}` : ''}: origen Q ${x.origen} · ArgosIsp Q ${x.importado} · diferencia Q ${x.diferencia}`,
        ),
    )
    seccion(
        'Servicios ya importados en otra empresa (no se movieron)',
        d.servicios_otra_empresa.map(
            (x) => `servicio ${x.servicio_origen} → ${x.servicio_id} (empresa ${x.empresa_id})`,
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
        r.errores.map((x) => `${x.entidad} ${x.id_origen} · ${x.accion}: ${x.mensaje}`),
    )
    seccion('Pendiente', r.pendiente)
    return lineas.join('\n')
}
