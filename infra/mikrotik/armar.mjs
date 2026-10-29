#!/usr/bin/env node
// Arma los scripts de RouterOS desde infra/mikrotik/piezas (una sola fuente para el laboratorio y
// el script de conexión, contratos/conexion-routers.md §3):
//
//   lab.rsc                               laboratorio (se edita su cabecera y se importa a mano)
//   plantillas/conexion.rsc.tpl           script de conexión (GET /routers/:id/script-conexion)
//   plantillas/conexion-servicio.rsc.tpl  el mismo con ?incluir=servicio (PPPoE, perfiles y corte)
//
// Uso:  node infra/mikrotik/armar.mjs              escribe los tres archivos
//       node infra/mikrotik/armar.mjs --verificar  falla si alguno no coincide con las piezas (CI)
// Las piezas no se editan en los archivos armados: se edita la pieza y se vuelve a armar.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))

export const SALIDAS = {
    'lab.rsc': [
        'lab-cabecera.rsc',
        'servicio-limpieza.rsc',
        'lab-wireguard.rsc',
        'servicio-base.rsc',
        'comun-radius.rsc',
        'servicio-firewall.rsc',
        'comun-api-rest.rsc',
        'servicio-orden.rsc',
        'servicio-fasttrack.rsc',
        'lab-pie.rsc',
    ],
    'plantillas/conexion.rsc.tpl': [
        'conexion-cabecera.rsc.tpl',
        'conexion-limpieza.rsc',
        'conexion-tunel.rsc',
        'comun-api-rest.rsc',
        'conexion-registro.rsc',
        'comun-radius.rsc',
        'conexion-gestion.rsc',
        'conexion-orden.rsc',
        'conexion-pie.rsc',
    ],
    'plantillas/conexion-servicio.rsc.tpl': [
        'conexion-cabecera.rsc.tpl',
        'conexion-servicio.rsc.tpl',
        'conexion-limpieza.rsc',
        'servicio-limpieza.rsc',
        'conexion-tunel.rsc',
        'comun-api-rest.rsc',
        'conexion-registro.rsc',
        'comun-radius.rsc',
        'servicio-base.rsc',
        'servicio-firewall.rsc',
        'conexion-gestion.rsc',
        'servicio-orden.rsc',
        'conexion-orden.rsc',
        'servicio-fasttrack.rsc',
        'conexion-pie.rsc',
    ],
}

export function armar(salida) {
    const texto = SALIDAS[salida].map((p) => readFileSync(join(DIR, 'piezas', p), 'utf8')).join('')
    return salida.startsWith('plantillas/') ? paraTerminal(texto) : texto
}

/**
 * Las plantillas se pegan en New Terminal (Winbox) además de importarse. El terminal de RouterOS
 * no maneja bien UTF-8 y cuenta las llaves de los comentarios al decidir dónde termina un bloque:
 * se dejan en ASCII y sin comentarios dentro del bloque (los comentarios siguen en las piezas).
 */
export function paraTerminal(texto) {
    const lineas = texto.split('\n')
    const inicio = lineas.indexOf('{')
    const salida = lineas
        .filter((l, i) => i <= inicio || !(/^\s*#/.test(l) || l.trim() === ''))
        .join('\n')
        .replace(/[«»“”]/g, "'")
        .replace(/→/g, '->')
        .replace(/[—–]/g, '-')
        .replace(/·/g, '-')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
    const ajeno = salida.match(/[^\x09\x0a\x0d\x20-\x7e]/)
    if (ajeno) {
        throw new Error(`carácter no ASCII en la plantilla: ${JSON.stringify(ajeno[0])}`)
    }
    return salida
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const verificar = process.argv.includes('--verificar')
    let distintos = 0
    for (const salida of Object.keys(SALIDAS)) {
        const ruta = join(DIR, salida)
        const texto = armar(salida)
        if (verificar) {
            let actual = ''
            try {
                actual = readFileSync(ruta, 'utf8')
            } catch {}
            if (actual !== texto) {
                distintos++
                console.error(
                    `infra/mikrotik/${salida} no coincide con sus piezas: corre node infra/mikrotik/armar.mjs y commitea`,
                )
            }
        } else {
            writeFileSync(ruta, texto)
            console.log(`infra/mikrotik/${salida}`)
        }
    }
    process.exit(distintos ? 1 : 0)
}
