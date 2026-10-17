import type { ReporteImportacion } from '#importacion/reporte'

/**
 * Reporte de diferencias para personas: **una línea por diferencia**, agrupada por entidad, con
 * su causa y qué hacer en el origen. Sale en Markdown (para leer) y en CSV (para filtrar en una
 * hoja de cálculo). Ninguna de las dos lleva datos que cambien entre corridas (request_id, horas,
 * ids que asigna la base al crear), así que dos corridas en seco sobre la misma base dan el mismo
 * archivo y se pueden comparar con `diff`.
 */

export type Gravedad = 'error' | 'omitido' | 'aviso' | 'info'

export interface LineaDiferencia {
    /** router, red, plan, cliente, servicio, factura, pago, saldo */
    entidad: string
    /** id en el sistema de origen (o la referencia que corresponda) */
    id_origen: string
    /** código estable de la diferencia (`ips_duplicadas`, `formato`, `error_accion`, ...) */
    tipo: string
    gravedad: Gravedad
    /** qué pasó con esa fila */
    detalle: string
    /** por qué */
    causa: string
    /** qué corregir en el origen (o "nada") */
    accion: string
}

const ORDEN_ENTIDADES = ['router', 'red', 'plan', 'zona', 'cliente', 'servicio', 'factura', 'pago', 'saldo']

const ENTIDAD_DE_ARCHIVO: Array<[RegExp, string]> = [
    // Nombres canónicos (CSV) y tablas de Mikrowisp 6 y SmartISP. `address_routers` antes que `routers`.
    [/redes|networks|^ipv4$|address_routers/, 'red'],
    [/routers|^server$|^nas$/, 'router'],
    [/planes|perfiles|plans/, 'plan'],
    [/saldo|balance/, 'saldo'],
    [/servicios|services/, 'servicio'],
    [/clientes|usuarios|clients/, 'cliente'],
    [/facturas|bills|bill_customers|invoices/, 'factura'],
    [/pagos|operaciones|payment/, 'pago'],
]

export function lineasDiferencias(r: ReporteImportacion): LineaDiferencia[] {
    const l: LineaDiferencia[] = []
    const d = r.diferencias
    const add = (x: LineaDiferencia) => l.push(x)

    for (const x of d.routers_sin_credenciales) {
        add({
            entidad: 'router',
            id_origen: x.router_origen,
            tipo: 'router_sin_credenciales',
            gravedad: 'aviso',
            detalle: `${x.nombre}: se importa sin ${x.faltan.join(', ')}`,
            causa: 'El origen no tiene esos datos del router',
            accion: x.faltan.includes('radius_secret')
                ? 'Cargar usuario, clave de la API y secreto RADIUS en el panel antes de migrar el router'
                : 'Cargar usuario y clave de la API REST en el panel (sin ellos no hay reconciliación ni colas)',
        })
    }
    for (const x of d.planes_sin_equivalente) {
        add({
            entidad: 'plan',
            id_origen: x.plan_origen,
            tipo: 'plan_sin_equivalente',
            gravedad: 'omitido',
            detalle: `${x.nombre ?? '(sin nombre)'}: ${x.servicios} servicios quedan fuera`,
            causa: x.motivo,
            accion: 'Agregar el plan al origen, corregir equivale_a o crear el plan en ArgosIsp',
        })
    }
    for (const x of d.clientes_nit_duplicado) {
        for (const id of x.clientes_origen.slice(1)) {
            add({
                entidad: 'cliente',
                id_origen: id,
                tipo: 'nit_duplicado',
                gravedad: 'aviso',
                detalle: `NIT ${x.nit} también lo tiene el cliente ${x.clientes_origen[0]}; se importan los dos`,
                causa: 'El mismo NIT está en varios clientes del origen',
                accion: 'Si es la misma persona, unir los clientes en el origen; si no, corregir el NIT',
            })
        }
    }
    for (const x of d.clientes_sin_nit) {
        add({
            entidad: 'cliente',
            id_origen: x.cliente_origen,
            tipo: 'sin_nit',
            gravedad: 'info',
            detalle: `${x.nombre}: se importa sin NIT (factura a Consumidor Final)`,
            causa: 'El cliente no tiene NIT en el origen',
            accion: 'Pedir el NIT al cliente si lo necesita en su factura',
        })
    }
    for (const x of d.nit_invalidos) {
        add({
            entidad: 'cliente',
            id_origen: x.cliente_origen,
            tipo: 'nit_invalido',
            gravedad: 'aviso',
            detalle: `${x.nombre}: "${x.nit}" se importa sin NIT (queda en campos_personalizados.${r.origen}_nit)`,
            causa: x.motivo,
            accion: 'Corregir el NIT en el origen',
        })
    }
    for (const x of d.servicios_sin_plan) {
        add({
            entidad: 'servicio',
            id_origen: x.servicio_origen,
            tipo: 'servicio_sin_plan',
            gravedad: 'omitido',
            detalle: `${x.etiqueta} (cliente ${x.cliente_origen}) no se importa; sus facturas van al saldo inicial del cliente`,
            causa: 'El servicio no tiene plan en el origen',
            accion: 'Asignarle un plan en el origen',
        })
    }
    for (const x of d.ips_duplicadas) {
        for (const id of x.servicios_origen.filter((s) => s !== x.importado_origen)) {
            add({
                entidad: 'servicio',
                id_origen: id,
                tipo: 'ip_duplicada',
                gravedad: 'omitido',
                detalle: `IP ${x.ip}: se importó el servicio ${x.importado_origen ?? 'ninguno'}; este no`,
                causa: `La IP ${x.ip} está en los servicios ${x.servicios_origen.join(', ')} del origen`,
                accion: 'Dejar la IP en un solo servicio (o vaciarla para que ArgosIsp asigne otra)',
            })
        }
    }
    for (const x of d.ips_fuera_de_red) {
        add({
            entidad: 'servicio',
            id_origen: x.servicio_origen,
            tipo: 'ip_fuera_de_red',
            gravedad: 'omitido',
            detalle: `IP ${x.ip} no se importa`,
            causa: `La IP no cae en ninguna red del router ${x.router_origen}`,
            accion: 'Agregar la red del router (redes) o corregir la IP',
        })
    }
    for (const x of d.ips_en_uso) {
        add({
            entidad: 'servicio',
            id_origen: x.servicio_origen,
            tipo: 'ip_en_uso',
            gravedad: 'omitido',
            detalle: `IP ${x.ip} no se importa`,
            causa: `La IP ya es del servicio ${x.servicio_id} de ArgosIsp`,
            accion: 'Revisar cuál de los dos servicios tiene la IP de verdad',
        })
    }
    for (const x of d.ips_nuevas) {
        add({
            entidad: 'servicio',
            id_origen: x.servicio_origen,
            tipo: 'ip_nueva',
            gravedad: 'info',
            detalle: `ArgosIsp asigna ${x.ip ?? 'una IP del pool del router'}`,
            causa: 'El servicio no tiene IP en el origen',
            accion: 'Nada (o poner la IP en el origen si debe conservarla)',
        })
    }
    for (const x of d.user_ppp_duplicados) {
        for (const id of x.servicios_origen.slice(x.motivo.startsWith('repetido') ? 1 : 0)) {
            add({
                entidad: 'servicio',
                id_origen: id,
                tipo: 'user_ppp_duplicado',
                gravedad: 'omitido',
                detalle: `${x.user_ppp} no se importa`,
                causa: x.motivo,
                accion: 'Cambiar el usuario PPPoE de uno de los servicios en el origen',
            })
        }
    }
    for (const x of d.servicios_suspendidos_origen) {
        add({
            entidad: 'servicio',
            id_origen: x.servicio_origen,
            tipo: 'suspendido_origen',
            gravedad: 'info',
            detalle: `${x.user_ppp} se importa activo`,
            causa: 'Suspendido en el origen; el corte lo decide la evaluación con las facturas importadas',
            accion: 'Nada',
        })
    }
    for (const x of d.servicios_retirados_origen) {
        add({
            entidad: 'servicio',
            id_origen: x.servicio_origen,
            tipo: 'retirado_origen',
            gravedad: 'info',
            detalle: `${x.user_ppp} no se importa`,
            causa: 'Retirado en el origen',
            accion: 'Nada',
        })
    }
    for (const x of d.tipos_conexion_pendientes) {
        add({
            entidad: 'servicio',
            id_origen: x.servicio_origen,
            tipo: 'tipo_conexion_pendiente',
            gravedad: 'omitido',
            detalle: `${x.tipo_conexion} no se importa`,
            causa: x.motivo,
            accion: 'Nada en el origen',
        })
    }
    for (const x of d.referencias_faltantes) {
        add({
            entidad: x.entidad,
            id_origen: x.id_origen,
            tipo: 'referencia_faltante',
            gravedad: 'omitido',
            detalle: `No se importa: falta ${x.falta} ${x.id_falta_origen}`,
            causa: `El ${x.falta} ${x.id_falta_origen} no está en el origen o no se pudo importar`,
            accion: `Revisar el ${x.falta} ${x.id_falta_origen} en el origen (o su línea en este reporte)`,
        })
    }
    for (const x of d.facturas_a_saldo) {
        add({
            entidad: 'factura',
            id_origen: x.factura_origen,
            tipo: 'factura_a_saldo',
            gravedad: 'aviso',
            detalle: `Q ${x.pendiente} del cliente ${x.cliente_origen} entran en su saldo inicial (no como factura)`,
            causa: x.motivo,
            accion: 'Nada (el saldo cuadra); para tenerla como factura, indicar su servicio en el origen',
        })
    }
    for (const x of d.pagos_cruzados) {
        add({
            entidad: 'pago',
            id_origen: x.pago_origen,
            tipo: 'pago_cruzado',
            gravedad: 'info',
            detalle: `El cliente ${x.pagador_origen} pagó Q ${x.monto} de la factura ${x.factura_origen} del cliente ${x.dueno_origen}`,
            causa: 'Pago de un cliente a la factura de otro en el origen; se importa igual (el pago salda esa factura)',
            accion: 'Nada (confirmar que no fue un error de digitación)',
        })
    }
    for (const x of d.pagos_sin_factura) {
        add({
            entidad: 'pago',
            id_origen: x.pago_origen,
            tipo: 'pago_sin_factura',
            gravedad: 'aviso',
            detalle: `Q ${x.monto} de la factura ${x.factura_origen} quedan a favor del cliente; el saldo inicial lo compensa`,
            causa: x.motivo,
            accion: 'Revisar por qué no entró la factura (ver sus líneas); el saldo del cliente cuadra igual',
        })
    }
    for (const x of d.pagos_no_importados) {
        add({
            entidad: 'pago',
            id_origen: x.pago_origen,
            tipo: 'pago_no_importado',
            gravedad: 'omitido',
            detalle: `Q ${x.monto} del cliente ${x.cliente_origen} no entra al historial; el saldo inicial lo compensa`,
            causa: x.motivo,
            accion: 'Completar el dato en el origen si se quiere el pago en el estado de cuenta',
        })
    }
    for (const x of d.saldos_distintos) {
        add({
            entidad: 'saldo',
            id_origen: x.cliente_origen,
            tipo: 'saldo_distinto',
            gravedad: 'error',
            detalle:
                `${x.nombre ?? ''}: origen Q ${x.origen}, ArgosIsp Q ${x.importado} (diferencia Q ${x.diferencia})`.trim(),
            causa: 'Algo del cliente no se pudo importar (ver sus otras líneas)',
            accion: 'Corregir las líneas de ese cliente y repetir en seco',
        })
    }
    for (const x of r.formato) {
        const tabla = x.archivo.split(':').at(-1) ?? x.archivo
        const entidad = ENTIDAD_DE_ARCHIVO.find(([re]) => re.test(tabla))?.[1] ?? x.archivo
        add({
            entidad,
            id_origen: x.id ?? `${x.archivo}:${x.linea}`,
            tipo: x.aviso ? 'formato_campo' : 'formato_fila',
            gravedad: x.aviso ? 'aviso' : 'omitido',
            detalle: x.aviso
                ? `Se importa sin el campo (${x.archivo}:${x.linea})`
                : `Fila omitida (${x.archivo}:${x.linea})`,
            causa: x.mensaje,
            accion: 'Corregir el dato en el origen',
        })
    }
    for (const x of r.errores) {
        add({
            entidad: x.entidad,
            id_origen: x.id_origen,
            tipo: 'error_accion',
            gravedad: 'error',
            detalle: `La acción ${x.accion} lo rechazó`,
            causa: x.mensaje,
            accion: 'Corregir el dato en el origen o avisar al equipo si el mensaje no se entiende',
        })
    }
    const orden = (e: string) => {
        const i = ORDEN_ENTIDADES.indexOf(e)
        return i === -1 ? ORDEN_ENTIDADES.length : i
    }
    // Orden estable: por entidad; dentro, en el orden en que se detectaron.
    return l
        .map((x, i) => ({ x, i }))
        .sort((a, b) => orden(a.x.entidad) - orden(b.x.entidad) || a.i - b.i)
        .map((a) => a.x)
}

const COLUMNAS: Array<keyof LineaDiferencia> = [
    'entidad',
    'id_origen',
    'tipo',
    'gravedad',
    'detalle',
    'causa',
    'accion',
]

/** CSV (RFC 4180, separador coma, UTF-8 con BOM para que Excel respete los acentos). */
export function reporteCsv(r: ReporteImportacion): string {
    const celda = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const filas = [
        COLUMNAS.join(','),
        ...lineasDiferencias(r).map((x) => COLUMNAS.map((c) => celda(x[c])).join(',')),
    ]
    return '﻿' + filas.join('\r\n') + '\r\n'
}

/** Markdown: resumen, saldos y una tabla por entidad con una fila por diferencia. */
export function reporteMarkdown(r: ReporteImportacion): string {
    const md = (v: string) => v.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
    const s: string[] = []
    s.push(
        `# Importación desde ${r.origen} · ${r.modo === 'en_seco' ? 'en seco (no se guardó nada)' : 'real'}`,
    )
    s.push('')
    if (r.fuente) s.push(`Fuente: \`${r.fuente}\``, '')
    s.push('## Resumen', '')
    s.push('| Entidad | Origen | Creados | Existentes | Omitidos |', '| --- | ---: | ---: | ---: | ---: |')
    for (const [nombre, c] of Object.entries(r.resumen)) {
        s.push(`| ${nombre} | ${c.origen} | ${c.creados} | ${c.existentes} | ${c.omitidos} |`)
    }
    s.push('')
    s.push('## Saldos', '')
    s.push(
        `- Clientes con saldo: ${r.saldos.clientes}`,
        `- Suma en el origen: Q ${r.saldos.suma_origen}`,
        `- Suma en ArgosIsp: Q ${r.saldos.suma_importada}`,
        r.saldos.cuadra
            ? '- **Cuadra**'
            : `- **No cuadra: diferencia Q ${r.saldos.diferencia}** (ver la sección saldo)`,
        `- Ids externos: ${r.ids_externos === 'tabla' ? 'core.ids_externos' : 'claves naturales'}`,
    )
    const lineas = lineasDiferencias(r)
    s.push('', `## Diferencias (${lineas.length})`)
    if (lineas.length === 0) s.push('', 'Sin diferencias.')
    const porEntidad = new Map<string, LineaDiferencia[]>()
    for (const x of lineas) porEntidad.set(x.entidad, [...(porEntidad.get(x.entidad) ?? []), x])
    for (const [entidad, grupo] of porEntidad) {
        s.push('', `### ${entidad} (${grupo.length})`, '')
        s.push(
            '| Id en el origen | Diferencia | Gravedad | Detalle | Causa | Qué hacer |',
            '| --- | --- | --- | --- | --- | --- |',
        )
        for (const x of grupo) {
            s.push(
                `| ${md(x.id_origen)} | ${x.tipo} | ${x.gravedad} | ${md(x.detalle)} | ${md(x.causa)} | ${md(x.accion)} |`,
            )
        }
    }
    if (r.pendiente.length > 0) {
        s.push('', '## Pendiente', '')
        for (const p of r.pendiente) s.push(`- ${p}`)
    }
    return s.join('\n') + '\n'
}
