#!/usr/bin/env node
/**
 * Sintetiza el audio del tour (WAV 44.1 kHz, 16 bits, estéreo), sin
 * dependencias y sin muestras externas: todo sale de osciladores, ruido y
 * filtros escritos aquí. Determinista (PRNG con semilla).
 *
 *   public/audio/musica.wav        synthwave suave de la duración del tour
 *   public/audio/whoosh.wav        movimientos de cámara
 *   public/audio/clic.wav          clic suave del cursor
 *   public/audio/confirmacion.wav  dos notas ascendentes (pago / servicio activo)
 *   public/audio/corte.wav         tono grave descendente (corte)
 *   public/audio/neon.wav          encendido de tubo neón: chisporroteo y zumbido
 *
 * Uso: node scripts/generar-audio.mjs   (o pnpm audio)
 *
 * La duración se toma de src/guion.ts (Node 22 lo importa quitando los tipos).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DURACION_TOTAL, FPS, LINEA_DE_TIEMPO } from '../src/guion.ts'

const SR = 44100
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio')

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** PRNG determinista (mulberry32). */
function prng(semilla) {
    let a = semilla >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const midiAHz = (nota) => 440 * Math.pow(2, (nota - 69) / 12)
const dbAGanancia = (db) => Math.pow(10, db / 20)

function estereo(segundos) {
    const n = Math.ceil(segundos * SR)
    return { L: new Float32Array(n), R: new Float32Array(n), n }
}

/** Biquad RBJ (lowpass / bandpass / highpass) con coeficientes actualizables. */
function biquad(tipo) {
    let b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    return {
        ajustar(frecuencia, q = 0.707) {
            const f = Math.min(Math.max(frecuencia, 20), SR * 0.45)
            const w = (2 * Math.PI * f) / SR
            const cos = Math.cos(w)
            const alfa = Math.sin(w) / (2 * q)
            let c0, c1, c2
            if (tipo === 'lp') [c0, c1, c2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
            else if (tipo === 'hp') [c0, c1, c2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
            else [c0, c1, c2] = [alfa, 0, -alfa]
            const a0 = 1 + alfa
            b0 = c0 / a0
            b1 = c1 / a0
            b2 = c2 / a0
            a1 = (-2 * cos) / a0
            a2 = (1 - alfa) / a0
        },
        procesar(x) {
            const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1
            x1 = x
            y2 = y1
            y1 = y
            return y
        },
    }
}

/** Corrección polyBLEP para osciladores sin tanto aliasing. */
function polyBlep(t, dt) {
    if (t < dt) {
        t /= dt
        return t + t - t * t - 1
    }
    if (t > 1 - dt) {
        t = (t - 1) / dt
        return t * t + t + t + 1
    }
    return 0
}

function sierra(fase, dt) {
    return 2 * fase - 1 - polyBlep(fase, dt)
}

function cuadrada(fase, dt) {
    let v = fase < 0.5 ? 1 : -1
    v += polyBlep(fase, dt)
    v -= polyBlep((fase + 0.5) % 1, dt)
    return v
}

/** Reverberación tipo Schroeder (4 peines + 2 pasa-todo) por canal. */
function reverb(entrada, { tamano = 1, amortiguacion = 0.35, realimentacion = 0.8 } = {}) {
    const salida = new Float32Array(entrada.length)
    const peines = [1116, 1188, 1277, 1356].map((d) => ({
        buf: new Float32Array(Math.round(d * tamano)),
        i: 0,
        filtro: 0,
    }))
    const pasaTodo = [556, 441].map((d) => ({ buf: new Float32Array(Math.round(d * tamano)), i: 0 }))
    for (let n = 0; n < entrada.length; n++) {
        const x = entrada[n]
        let suma = 0
        for (const p of peines) {
            const y = p.buf[p.i]
            p.filtro = y * (1 - amortiguacion) + p.filtro * amortiguacion
            p.buf[p.i] = x + p.filtro * realimentacion
            p.i = (p.i + 1) % p.buf.length
            suma += y
        }
        let y = suma * 0.25
        for (const a of pasaTodo) {
            const b = a.buf[a.i]
            const v = y + b * 0.5
            a.buf[a.i] = v
            y = b - v * 0.5
            a.i = (a.i + 1) % a.buf.length
        }
        salida[n] = y
    }
    return salida
}

/** Retardo estéreo ping-pong. */
function delayPingPong(L, R, segundos, realimentacion, mezcla) {
    const d = Math.round(segundos * SR)
    const bufL = new Float32Array(d)
    const bufR = new Float32Array(d)
    let i = 0
    for (let n = 0; n < L.length; n++) {
        const eL = bufL[i]
        const eR = bufR[i]
        bufL[i] = (L[n] + R[n]) * 0.5 + eR * realimentacion
        bufR[i] = eL * realimentacion
        L[n] += eL * mezcla
        R[n] += eR * mezcla
        i = (i + 1) % d
    }
}

function picoYRms(L, R) {
    let pico = 0
    let suma = 0
    for (let n = 0; n < L.length; n++) {
        pico = Math.max(pico, Math.abs(L[n]), Math.abs(R[n]))
        suma += L[n] * L[n] + R[n] * R[n]
    }
    return { pico, rms: Math.sqrt(suma / (2 * L.length)) }
}

/**
 * Normaliza: pico a −1 dBFS como máximo y sonoridad RMS cerca de `rmsObjetivoDb`
 * (aprox. de −14 LUFS para música; los efectos solo se limitan por pico).
 */
function normalizar(L, R, { picoDb = -1, rmsObjetivoDb } = {}) {
    const { pico, rms } = picoYRms(L, R)
    let g = dbAGanancia(picoDb) / (pico || 1)
    if (rmsObjetivoDb !== undefined) g = Math.min(g, dbAGanancia(rmsObjetivoDb) / (rms || 1))
    for (let n = 0; n < L.length; n++) {
        L[n] *= g
        R[n] *= g
    }
    const final = picoYRms(L, R)
    return { picoDb: 20 * Math.log10(final.pico), rmsDb: 20 * Math.log10(final.rms) }
}

function escribirWav(nombre, { L, R }) {
    const n = L.length
    const datos = Buffer.alloc(44 + n * 4)
    datos.write('RIFF', 0)
    datos.writeUInt32LE(36 + n * 4, 4)
    datos.write('WAVE', 8)
    datos.write('fmt ', 12)
    datos.writeUInt32LE(16, 16)
    datos.writeUInt16LE(1, 20)
    datos.writeUInt16LE(2, 22)
    datos.writeUInt32LE(SR, 24)
    datos.writeUInt32LE(SR * 4, 28)
    datos.writeUInt16LE(4, 32)
    datos.writeUInt16LE(16, 34)
    datos.write('data', 36)
    datos.writeUInt32LE(n * 4, 40)
    for (let i = 0; i < n; i++) {
        const l = Math.max(-1, Math.min(1, L[i]))
        const r = Math.max(-1, Math.min(1, R[i]))
        datos.writeInt16LE(Math.round(l * 32767), 44 + i * 4)
        datos.writeInt16LE(Math.round(r * 32767), 46 + i * 4)
    }
    mkdirSync(DIR, { recursive: true })
    writeFileSync(join(DIR, nombre), datos)
}

function fundidos(L, R, entrada, salida) {
    const ne = Math.round(entrada * SR)
    const ns = Math.round(salida * SR)
    for (let n = 0; n < L.length; n++) {
        let g = 1
        if (n < ne) g *= Math.sin(((n / ne) * Math.PI) / 2) ** 2
        const r = L.length - n
        if (r < ns) g *= Math.sin(((r / ns) * Math.PI) / 2) ** 2
        L[n] *= g
        R[n] *= g
    }
}

// ---------------------------------------------------------------------------
// Música: synthwave suave, Am–F–C–G a 100 BPM
// ---------------------------------------------------------------------------

function musica() {
    const duracion = DURACION_TOTAL / FPS
    const azar = prng(2026)
    const BPM = 100
    const PULSO = 60 / BPM
    const COMPAS = PULSO * 4
    const ACORDES = [
        { nombre: 'Am', notas: [57, 60, 64, 69], bajo: 45 },
        { nombre: 'F', notas: [53, 57, 60, 65], bajo: 41 },
        { nombre: 'C', notas: [55, 60, 64, 67], bajo: 48 },
        { nombre: 'G', notas: [55, 59, 62, 67], bajo: 43 },
    ]
    const compases = Math.ceil(duracion / COMPAS) + 1

    // Secciones según el guion: batería desde el segundo compás hasta el cierre.
    const cierre = LINEA_DE_TIEMPO[LINEA_DE_TIEMPO.length - 1].desde / FPS
    const inicioBateria = 2 * COMPAS
    const finBateria = Math.floor(cierre / COMPAS) * COMPAS
    const ultimoCompasArmonico = Math.floor((duracion - 0.01) / COMPAS)

    const pad = estereo(duracion + 2)
    const bajo = estereo(duracion + 2)
    const arpegio = estereo(duracion + 2)
    const bateria = estereo(duracion + 2)

    // --- Pad: sierras desafinadas por un pasabajos que respira -----------------
    {
        const filtroL = biquad('lp')
        const filtroR = biquad('lp')
        for (let c = 0; c < compases; c++) {
            // En el cierre se sostiene Am hasta el final.
            const acorde = c >= ultimoCompasArmonico - 1 && c * COMPAS >= finBateria ? ACORDES[0] : ACORDES[c % 4]
            const t0 = c * COMPAS
            const largo = COMPAS + 0.9
            const i0 = Math.round(t0 * SR)
            const fases = acorde.notas.map(() => [azar(), azar(), azar(), azar()])
            for (let k = 0; k < Math.round(largo * SR); k++) {
                const n = i0 + k
                if (n >= pad.n) break
                const t = k / SR
                const env = Math.min(1, t / 0.45) * (t > COMPAS ? Math.max(0, 1 - (t - COMPAS) / 0.9) : 1)
                let l = 0
                let r = 0
                acorde.notas.forEach((nota, v) => {
                    const f = midiAHz(nota)
                    const desafino = [-7, 6, -3, 9] // cents
                    for (let d = 0; d < 4; d++) {
                        const fd = f * Math.pow(2, desafino[d] / 1200)
                        const dt = fd / SR
                        fases[v][d] = (fases[v][d] + dt) % 1
                        const s = sierra(fases[v][d], dt)
                        if (d % 2 === 0) l += s
                        else r += s
                    }
                })
                pad.L[n] += l * env * 0.05
                pad.R[n] += r * env * 0.05
            }
        }
        for (let n = 0; n < pad.n; n++) {
            const t = n / SR
            // El filtro se abre en la portada y luego respira con un LFO lento.
            const apertura = Math.min(1, t / 5)
            const corte = 380 + apertura * (650 + 380 * Math.sin(2 * Math.PI * 0.045 * t))
            if (n % 32 === 0) {
                filtroL.ajustar(corte, 0.9)
                filtroR.ajustar(corte * 1.04, 0.9)
            }
            pad.L[n] = filtroL.procesar(pad.L[n])
            pad.R[n] = filtroR.procesar(pad.R[n])
        }
    }

    // --- Bajo: corcheas con envolvente y pasabajos ----------------------------
    {
        const filtro = biquad('lp')
        const patron = [0, 0, 12, 0, 0, 0, 12, 0]
        const corchea = PULSO / 2
        let fase = 0
        const inicioBajo = COMPAS
        for (let c = 1; c < compases; c++) {
            if (c * COMPAS >= finBateria + COMPAS) break
            const acorde = ACORDES[c % 4]
            for (let k = 0; k < 8; k++) {
                const t0 = c * COMPAS + k * corchea
                if (t0 < inicioBajo || t0 >= duracion) continue
                const f = midiAHz(acorde.bajo + patron[k])
                const i0 = Math.round(t0 * SR)
                const largo = Math.round(corchea * 0.92 * SR)
                for (let j = 0; j < largo; j++) {
                    const n = i0 + j
                    if (n >= bajo.n) break
                    const t = j / SR
                    const dt = f / SR
                    fase = (fase + dt) % 1
                    const env = Math.min(1, t / 0.004) * Math.exp(-t * 6)
                    if (j % 16 === 0) filtro.ajustar(180 + 900 * Math.exp(-t * 14), 1.1)
                    const s = filtro.procesar(sierra(fase, dt) * 0.7 + cuadrada(fase, dt) * 0.3)
                    // Entrada gradual del bajo en el segundo compás
                    const gradual = Math.min(1, (t0 - inicioBajo) / COMPAS + 0.4)
                    bajo.L[n] += s * env * 0.32 * gradual
                    bajo.R[n] += s * env * 0.32 * gradual
                }
            }
        }
    }

    // --- Arpegio: semicorcheas pulsadas con retardo ping-pong -----------------
    {
        const filtro = biquad('lp')
        filtro.ajustar(2600, 0.8)
        const semicorchea = PULSO / 4
        const patron = [0, 1, 2, 3, 2, 1, 2, 3]
        const inicioArp = 1.2
        let fase = 0
        const total = Math.floor(duracion / semicorchea)
        for (let k = 0; k < total; k++) {
            const t0 = k * semicorchea
            if (t0 < inicioArp) continue
            const c = Math.floor(t0 / COMPAS)
            const acorde = t0 >= finBateria && c >= ultimoCompasArmonico - 1 ? ACORDES[0] : ACORDES[c % 4]
            const nota = acorde.notas[patron[k % patron.length]] + 12
            const f = midiAHz(nota)
            const i0 = Math.round(t0 * SR)
            const largo = Math.round(0.22 * SR)
            // Acento en el primer tiempo y entrada suave en la portada.
            const acento = k % 4 === 0 ? 1 : 0.7
            const entrada = Math.min(1, (t0 - inicioArp) / 3)
            for (let j = 0; j < largo; j++) {
                const n = i0 + j
                if (n >= arpegio.n) break
                const t = j / SR
                const dt = f / SR
                fase = (fase + dt) % 1
                const tri = 1 - 4 * Math.abs(Math.round(fase - 0.25) - (fase - 0.25))
                const s = filtro.procesar(tri * 0.6 + cuadrada(fase, dt) * 0.25)
                const env = Math.min(1, t / 0.003) * Math.exp(-t * 18)
                const v = s * env * 0.11 * acento * entrada
                // Paneo alterno suave
                const pan = k % 2 === 0 ? 0.35 : 0.65
                arpegio.L[n] += v * (1 - pan) * 1.4
                arpegio.R[n] += v * pan * 1.4
            }
        }
        delayPingPong(arpegio.L, arpegio.R, PULSO * 0.75, 0.38, 0.45)
    }

    // --- Batería suave: bombo, caja y hi-hat ----------------------------------
    {
        const ruido = prng(77)
        const filtroCaja = biquad('bp')
        filtroCaja.ajustar(1800, 0.7)
        const filtroHat = biquad('hp')
        filtroHat.ajustar(7000, 0.7)
        const golpe = (t0, fn) => {
            const i0 = Math.round(t0 * SR)
            for (let j = 0; j < Math.round(0.5 * SR); j++) {
                const n = i0 + j
                if (n >= bateria.n) break
                const v = fn(j / SR)
                bateria.L[n] += v
                bateria.R[n] += v
            }
        }
        for (let c = 0; c < compases; c++) {
            const tc = c * COMPAS
            if (tc < inicioBateria || tc >= finBateria) continue
            // Bombo en 1 y 3 (y una anticipación cada dos compases)
            const bombos = [0, 2, ...(c % 2 === 1 ? [3.5] : [])]
            for (const b of bombos) {
                let fase = 0
                golpe(tc + b * PULSO, (t) => {
                    const f = 45 + 85 * Math.exp(-t * 35)
                    fase += f / SR
                    return Math.sin(2 * Math.PI * fase) * Math.exp(-t * 7) * 0.55
                })
            }
            // Caja en 2 y 4: ruido filtrado + cuerpo de 190 Hz
            for (const b of [1, 3]) {
                golpe(tc + b * PULSO, (t) => {
                    const cuerpo = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30) * 0.18
                    const r = filtroCaja.procesar(ruido() * 2 - 1) * Math.exp(-t * 18) * 0.38
                    return cuerpo + r
                })
            }
            // Hi-hat en contratiempos
            for (let k = 0; k < 8; k++) {
                if (k % 2 === 0) continue
                golpe(tc + k * (PULSO / 2), (t) => filtroHat.procesar(ruido() * 2 - 1) * Math.exp(-t * 60) * 0.12)
            }
        }
    }

    // --- Mezcla ---------------------------------------------------------------
    const n = Math.ceil(duracion * SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    const envioL = new Float32Array(n)
    const envioR = new Float32Array(n)
    for (let i = 0; i < n; i++) {
        envioL[i] = pad.L[i] * 0.6 + arpegio.L[i] * 0.5 + bateria.L[i] * 0.08
        envioR[i] = pad.R[i] * 0.6 + arpegio.R[i] * 0.5 + bateria.R[i] * 0.08
    }
    const revL = reverb(envioL, { tamano: 1.0 })
    const revR = reverb(envioR, { tamano: 1.07 })
    for (let i = 0; i < n; i++) {
        const l = pad.L[i] + bajo.L[i] + arpegio.L[i] + bateria.L[i] + revL[i] * 0.55
        const r = pad.R[i] + bajo.R[i] + arpegio.R[i] + bateria.R[i] + revR[i] * 0.55
        // Saturación suave de cinta
        L[i] = Math.tanh(l * 1.2) / 1.2
        R[i] = Math.tanh(r * 1.2) / 1.2
    }
    fundidos(L, R, 1.5, 3.5)
    const nivel = normalizar(L, R, { picoDb: -1, rmsObjetivoDb: -16 })
    escribirWav('musica.wav', { L, R })
    return { duracion, ...nivel }
}

// ---------------------------------------------------------------------------
// Efectos
// ---------------------------------------------------------------------------

function whoosh() {
    const d = 1.1
    const s = estereo(d)
    const azar = prng(11)
    const bp = biquad('bp')
    const lp = biquad('lp')
    lp.ajustar(160, 0.7)
    for (let n = 0; n < s.n; n++) {
        const t = n / s.n
        // Barrido del centro: sube hasta el 55 % y luego baja.
        const f = t < 0.55 ? 250 * Math.pow(2800 / 250, t / 0.55) : 2800 * Math.pow(600 / 2800, (t - 0.55) / 0.45)
        if (n % 16 === 0) bp.ajustar(f, 1.3)
        const r = azar() * 2 - 1
        const env = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 2)
        const v = bp.procesar(r) * env * 1.6 + lp.procesar(r) * env * 0.5
        const pan = 0.2 + 0.6 * t
        s.L[n] = v * (1 - pan)
        s.R[n] = v * pan
    }
    normalizar(s.L, s.R, { picoDb: -3 })
    escribirWav('whoosh.wav', s)
}

function clic() {
    const s = estereo(0.09)
    const azar = prng(5)
    const hp = biquad('hp')
    hp.ajustar(3000, 0.7)
    for (let n = 0; n < s.n; n++) {
        const t = n / SR
        const tono = Math.sin(2 * Math.PI * 1700 * t) * Math.exp(-t * 260) * 0.6
        const cuerpo = Math.sin(2 * Math.PI * 520 * t) * Math.exp(-t * 120) * 0.35
        const tick = hp.procesar(azar() * 2 - 1) * Math.exp(-t * 900) * 0.4
        s.L[n] = s.R[n] = tono + cuerpo + tick
    }
    normalizar(s.L, s.R, { picoDb: -6 })
    escribirWav('clic.wav', s)
}

function confirmacion() {
    const s = estereo(1.3)
    const notas = [
        { f: midiAHz(81), t0: 0 }, // A5
        { f: midiAHz(88), t0: 0.11 }, // E6
    ]
    for (const { f, t0 } of notas) {
        const i0 = Math.round(t0 * SR)
        for (let j = 0; i0 + j < s.n; j++) {
            const t = j / SR
            const env = Math.min(1, t / 0.004) * Math.exp(-t * 5.5)
            const v =
                (Math.sin(2 * Math.PI * f * t) +
                    0.35 * Math.sin(2 * Math.PI * 2 * f * t) * Math.exp(-t * 4) +
                    0.12 * Math.sin(2 * Math.PI * 3.01 * f * t) * Math.exp(-t * 9)) *
                env *
                0.4
            s.L[i0 + j] += v * (t0 === 0 ? 0.6 : 0.4)
            s.R[i0 + j] += v * (t0 === 0 ? 0.4 : 0.6)
        }
    }
    delayPingPong(s.L, s.R, 0.16, 0.3, 0.3)
    normalizar(s.L, s.R, { picoDb: -3 })
    escribirWav('confirmacion.wav', s)
}

function corte() {
    const s = estereo(1.0)
    const lp = biquad('lp')
    let fase = 0
    let faseSub = 0
    for (let n = 0; n < s.n; n++) {
        const t = n / SR
        const f = 330 * Math.pow(55 / 330, Math.min(1, t / 0.75))
        const dt = f / SR
        fase = (fase + dt) % 1
        faseSub = (faseSub + dt / 2) % 1
        if (n % 16 === 0) lp.ajustar(2200 * Math.pow(200 / 2200, Math.min(1, t / 0.8)), 2)
        const env = Math.min(1, t / 0.01) * Math.exp(-t * 2.8)
        const v = lp.procesar(sierra(fase, dt)) * 0.6 + Math.sin(2 * Math.PI * faseSub) * 0.4
        s.L[n] = s.R[n] = v * env
    }
    normalizar(s.L, s.R, { picoDb: -3 })
    escribirWav('corte.wav', s)
}

function neon() {
    const d = 2.6
    const s = estereo(d)
    const azar = prng(60)
    const bp = biquad('bp')
    bp.ajustar(1400, 0.9)
    const hp = biquad('hp')
    hp.ajustar(2500, 0.7)
    let fase = 0
    // Compuertas del chisporroteo: tramos de 25-60 ms encendidos o apagados.
    const tramos = []
    for (let t = 0; t < 0.55; ) {
        const largo = 0.025 + azar() * 0.035
        tramos.push({ desde: t, hasta: t + largo, on: azar() < 0.35 + t })
        t += largo
    }
    const compuerta = (t) => {
        if (t >= 0.55) return 1
        const tramo = tramos.find((x) => t >= x.desde && t < x.hasta)
        return tramo && tramo.on ? 1 : 0.05
    }
    let suavizada = 0
    for (let n = 0; n < s.n; n++) {
        const t = n / SR
        const dt = 120 / SR
        fase = (fase + dt) % 1
        // Zumbido de 120 Hz (tubo a 60 Hz) con armónicos, saturado.
        const zumbido = Math.tanh(sierra(fase, dt) * 2.2)
        const brillo = bp.procesar(zumbido)
        const hum = Math.sin(2 * Math.PI * 60 * t) * 0.5 + Math.sin(2 * Math.PI * 120 * t) * 0.3
        const objetivo = compuerta(t)
        suavizada += (objetivo - suavizada) * 0.02
        // Chispas: impulsos de ruido agudo durante el encendido.
        const chispa = t < 0.6 && azar() < 0.0025 ? 1 : 0
        const chispas = hp.procesar(chispa ? (azar() * 2 - 1) * 4 : 0) * 0.6
        const nivelZumbido = t < 0.55 ? 0.9 : 0.9 * Math.exp(-(t - 0.55) * 1.6) + 0.12
        const final = t > d - 0.6 ? Math.max(0, (d - t) / 0.6) : 1
        const v = (brillo * 0.55 * nivelZumbido + hum * 0.35 * Math.min(1, t / 0.1)) * suavizada * final + chispas
        s.L[n] = v
        s.R[n] = v * 0.92
    }
    normalizar(s.L, s.R, { picoDb: -2 })
    escribirWav('neon.wav', s)
}

const inicio = Date.now()
const m = musica()
whoosh()
clic()
confirmacion()
corte()
neon()
console.log(
    `audio listo en ${((Date.now() - inicio) / 1000).toFixed(1)} s · música ${m.duracion.toFixed(1)} s, ` +
        `pico ${m.picoDb.toFixed(1)} dBFS, RMS ${m.rmsDb.toFixed(1)} dBFS · ${DIR}`
)
