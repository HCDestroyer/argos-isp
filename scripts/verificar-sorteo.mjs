#!/usr/bin/env node
// Verificación independiente de un sorteo de ArgosIsp (algoritmo `argos-sorteo-v1`,
// `.claude/integration/contratos/lealtad.md` §7.3). Sin dependencias: solo `node:crypto`.
//
// Uso:
//   curl -s https://<isp>/api/v1/lealtad/sorteos/<id>/verificacion > sorteo.json
//   node scripts/verificar-sorteo.mjs sorteo.json
//
// Comprueba que:
//   1. SHA-256(semilla) = compromiso publicado con las bases;
//   2. SHA-256 de las líneas `codigo|boletos\n` = lista_hash publicado en el corte;
//   3. SHA-256 del JSON canónico de las bases = bases_hash;
//   4. el cálculo da los mismos titulares y suplentes, en el mismo orden;
//   5. cada titular tiene el premio de su puesto (premio 1 × cantidad, premio 2…) y los suplentes ninguno.
// Sale con código 0 si todo coincide y 1 si algo no.
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const ALGORITMO = 'argos-sorteo-v1'

const sha256 = (datos) => createHash('sha256').update(datos).digest('hex')
const hmac = (clave, mensaje) => createHmac('sha256', clave).update(mensaje, 'utf8').digest()

function jsonCanonico(valor) {
    if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null)
    if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`
    const claves = Object.keys(valor)
        .filter((k) => valor[k] !== undefined)
        .sort()
    return `{${claves.map((k) => `${JSON.stringify(k)}:${jsonCanonico(valor[k])}`).join(',')}}`
}

function sortear(s, listaHash, basesHash, valorPublico, lista, cuantos) {
    const semillaFinal = hmac(s, `${listaHash}${basesHash}${valorPublico}`)
    const restantes = [...lista]
    const elegidos = []
    for (let i = 0; elegidos.length < cuantos && restantes.length > 0; i++) {
        const T = BigInt(restantes.reduce((n, p) => n + p.boletos, 0))
        const r = BigInt('0x' + hmac(semillaFinal, `${ALGORITMO}:${i}`).toString('hex'))
        const limite = (2n ** 256n / T) * T
        if (r >= limite) continue
        let boleto = r % T
        const k = restantes.findIndex((p) => (boleto -= BigInt(p.boletos)) < 0n)
        elegidos.push(restantes[k].codigo)
        restantes.splice(k, 1)
    }
    return elegidos
}

export function verificar(datos) {
    const fallas = []
    if (datos.algoritmo !== ALGORITMO) fallas.push(`algoritmo ${datos.algoritmo}: este script verifica ${ALGORITMO}`)
    const semilla = Buffer.from(datos.semilla, 'hex')
    if (sha256(semilla) !== datos.compromiso) fallas.push('la semilla no corresponde al compromiso publicado')
    const lista = [...datos.lista].sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0))
    const listaHash = sha256(lista.map((p) => `${p.codigo}|${p.boletos}\n`).join(''))
    if (listaHash !== datos.lista_hash) fallas.push('la lista no corresponde a lista_hash')
    if (datos.bases && sha256(jsonCanonico(datos.bases)) !== datos.bases_hash) {
        fallas.push('las bases no corresponden a bases_hash')
    }
    const elegidos = sortear(
        semilla,
        datos.lista_hash,
        datos.bases_hash,
        datos.valor_publico,
        lista,
        datos.titulares + datos.suplentes,
    )
    const publicados = [...datos.ganadores].sort((a, b) => a.posicion - b.posicion).map((g) => g.codigo)
    if (JSON.stringify(elegidos) !== JSON.stringify(publicados)) {
        fallas.push(`el cálculo da ${elegidos.join(', ')} y se publicó ${publicados.join(', ')}`)
    }
    // 5. cada titular recibe el premio que le toca por su puesto: premio 1 (× cantidad), premio 2…; los
    //    suplentes, ninguno (los premios salen de las bases, ya verificadas contra bases_hash)
    if (datos.bases && Array.isArray(datos.bases.premios)) {
        const porPuesto = [...datos.bases.premios]
            .sort((a, b) => a.posicion - b.posicion)
            .flatMap((p) => Array.from({ length: p.cantidad }, () => p.posicion))
        const ordenados = [...datos.ganadores].sort((a, b) => a.posicion - b.posicion)
        for (const [i, g] of ordenados.entries()) {
            const esperado = i < datos.titulares ? porPuesto[i] ?? null : null
            const tipo = i < datos.titulares ? 'titular' : 'suplente'
            if ((g.premio_posicion ?? null) !== esperado || (g.tipo && g.tipo !== tipo)) {
                fallas.push(
                    `el puesto ${g.posicion} (${g.codigo}) debía ser ${tipo} con premio ${esperado ?? 'ninguno'} y se publicó ${g.tipo ?? '?'} con premio ${g.premio_posicion ?? 'ninguno'}`,
                )
            }
        }
    }
    return { ok: fallas.length === 0, elegidos, fallas }
}

const archivo = process.argv[2]
if (archivo) {
    const resultado = verificar(JSON.parse(readFileSync(archivo, 'utf8')))
    if (resultado.ok) {
        console.log(`Sorteo verificado: ${resultado.elegidos.join(', ')}`)
    } else {
        console.error(`El sorteo NO se verifica:\n- ${resultado.fallas.join('\n- ')}`)
        process.exit(1)
    }
}
