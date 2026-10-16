import { test } from '@japa/runner'
import {
    formatoKbps,
    garantizadoKbps,
    leerVelocidad,
    limitesPadrePlan,
    rateLimitServicio,
    validarVelocidad,
    velocidadEfectiva,
    VELOCIDAD_POR_DEFECTO,
    type VelocidadPlan,
} from '#network/velocidad'

/**
 * `app/network/velocidad.ts`: función pura del `Mikrotik-Rate-Limit` y de los padres por plan
 * (`.claude/integration/contratos/velocidad.md`). Sin base de datos.
 */

function plan(extra: Partial<VelocidadPlan> = {}): VelocidadPlan {
    return {
        bajada_kbps: 20000,
        subida_kbps: 5000,
        bajada_limitada_kbps: 2048,
        subida_limitada_kbps: 1024,
        ...VELOCIDAD_POR_DEFECTO,
        ...extra,
    }
}

test.group('Velocidad · formato', () => {
    test('k y M: múltiplos de 1000 en M, el resto en k, 0 sin unidad', ({ assert }) => {
        assert.equal(formatoKbps(0), '0')
        assert.equal(formatoKbps(1), '1k')
        assert.equal(formatoKbps(999), '999k')
        assert.equal(formatoKbps(1000), '1M')
        assert.equal(formatoKbps(1500), '1500k')
        assert.equal(formatoKbps(20000), '20M')
        assert.equal(formatoKbps(20480), '20480k')
        assert.equal(formatoKbps(1_000_000), '1000M')
    })

    test('rechaza valores no enteros o negativos', ({ assert }) => {
        assert.throws(() => formatoKbps(-1), /inválida/)
        assert.throws(() => formatoKbps(1.5), /inválida/)
        assert.throws(() => formatoKbps(Number.NaN), /inválida/)
    })
})

test.group('Velocidad · rateLimitServicio', () => {
    test('plan sin campos nuevos: misma velocidad que antes y limit-at = MIR (reuso 1)', ({ assert }) => {
        assert.equal(rateLimitServicio(plan(), 'activo'), '5M/20M 0/0 0/0 0/0 8 5M/20M')
    })

    test('reuso 1:4 sin garantizado: limit-at = MIR / 4', ({ assert }) => {
        assert.equal(rateLimitServicio(plan({ reuso: 4 }), 'activo'), '5M/20M 0/0 0/0 0/0 8 1250k/5M')
    })

    test('redondeo hacia abajo del limit-at: 20000 / 3 = 6666k, 5000 / 3 = 1666k', ({ assert }) => {
        assert.equal(rateLimitServicio(plan({ reuso: 3 }), 'activo'), '5M/20M 0/0 0/0 0/0 8 1666k/6666k')
    })

    test('garantizado explícito con decimales en aritmética entera', ({ assert }) => {
        // 20000 × 33.33 % = 6666 (no 6665 por error de punto flotante)
        assert.equal(garantizadoKbps(20000, { reuso: 3, garantizado_pct: 33.33 }), 6666)
        assert.equal(garantizadoKbps(5000, { reuso: 1, garantizado_pct: 50 }), 2500)
        assert.equal(garantizadoKbps(1, { reuso: 1, garantizado_pct: 50 }), 0)
        assert.equal(
            rateLimitServicio(plan({ garantizado_pct: 25 }), 'activo'),
            '5M/20M 0/0 0/0 0/0 8 1250k/5M',
        )
    })

    test('ráfaga completa: umbral 75 % y 16 s por defecto, prioridad del plan', ({ assert }) => {
        const p = plan({ rafaga_bajada_kbps: 30000, rafaga_subida_kbps: 8000, prioridad: 2, reuso: 2 })
        assert.equal(rateLimitServicio(p, 'activo'), '5M/20M 8M/30M 3750k/15M 16/16 2 2500k/10M')
    })

    test('ráfaga solo en bajada: la subida lleva 0 en ráfaga, umbral y tiempo', ({ assert }) => {
        const p = plan({ rafaga_bajada_kbps: 25000, rafaga_umbral_pct: 80, rafaga_segundos: 8 })
        assert.equal(rateLimitServicio(p, 'activo'), '5M/20M 0/25M 0/16M 0/8 8 5M/20M')
    })

    test('umbral con redondeo hacia abajo: 1500 × 75 % = 1125, 1001 × 75 % = 750', ({ assert }) => {
        const p = plan({
            subida_kbps: 1001,
            bajada_kbps: 1500,
            rafaga_subida_kbps: 2000,
            rafaga_bajada_kbps: 3000,
        })
        assert.equal(rateLimitServicio(p, 'activo'), '1001k/1500k 2M/3M 750k/1125k 16/16 8 1001k/1500k')
    })

    test('limitado: velocidad limitada sin ráfaga, misma prioridad y mismo % garantizado', ({ assert }) => {
        const p = plan({ rafaga_bajada_kbps: 30000, rafaga_subida_kbps: 8000, prioridad: 3, reuso: 2 })
        assert.equal(rateLimitServicio(p, 'limitado'), '1024k/2048k 0/0 0/0 0/0 3 512k/1024k')
    })

    test('suspendido y retirado usan la velocidad limitada (aaa los corta por su cuenta)', ({ assert }) => {
        assert.equal(rateLimitServicio(plan(), 'suspendido'), rateLimitServicio(plan(), 'limitado'))
        assert.equal(rateLimitServicio(plan(), 'retirado'), rateLimitServicio(plan(), 'limitado'))
    })

    test('rate_limit_override del router reemplaza solo la de estado activo', ({ assert }) => {
        const p = plan({ rate_limit_override: '6M/24M 8M/30M 5M/20M 10/10' })
        assert.equal(rateLimitServicio(p, 'activo'), '6M/24M 8M/30M 5M/20M 10/10')
        assert.equal(rateLimitServicio(p, 'limitado'), '1024k/2048k 0/0 0/0 0/0 8 1024k/2048k')
    })
})

test.group('Velocidad · limitesPadrePlan', () => {
    test('1:4 de 20 Mbps con 4 activos comparten 20 Mbps; limit-at = CIR × activos', ({ assert }) => {
        const p = plan({ reuso: 4 })
        assert.deepEqual(limitesPadrePlan(p, 4), {
            max_limit: '5M/20M',
            limit_at: '5M/20M',
            prioridad: 8,
            max_limit_kbps: { subida: 5000, bajada: 20000 },
            limit_at_kbps: { subida: 5000, bajada: 20000 },
        })
    })

    test('max-limit hacia arriba y limit-at hacia abajo: Σ hijos ≤ padre', ({ assert }) => {
        const p = plan({ reuso: 3 })
        const l = limitesPadrePlan(p, 5)
        assert.deepEqual(l.max_limit_kbps, { subida: 8334, bajada: 33334 })
        assert.deepEqual(l.limit_at_kbps, { subida: 8330, bajada: 33330 })
        assert.isAtMost(l.limit_at_kbps.bajada, l.max_limit_kbps.bajada)
        assert.equal(l.max_limit, '8334k/33334k')
    })

    test('reuso 1: el padre es la suma de los MIR', ({ assert }) => {
        assert.equal(limitesPadrePlan(plan(), 3).max_limit, '15M/60M')
        assert.equal(limitesPadrePlan(plan(), 3).limit_at, '15M/60M')
    })

    test('0 activos se calcula como 1 (max-limit 0 sería "sin límite" en RouterOS)', ({ assert }) => {
        assert.equal(limitesPadrePlan(plan({ reuso: 4 }), 0).max_limit, '1250k/5M')
        assert.throws(() => limitesPadrePlan(plan(), -1), /activos/)
        assert.throws(() => limitesPadrePlan(plan(), 1.5), /activos/)
    })

    test('lleva la prioridad del plan', ({ assert }) => {
        assert.equal(limitesPadrePlan(plan({ prioridad: 1 }), 2).prioridad, 1)
    })
})

test.group('Velocidad · excepciones y validación', () => {
    test('velocidadEfectiva: null o ausente hereda del plan', ({ assert }) => {
        const efectiva = velocidadEfectiva(plan({ reuso: 4, prioridad: 8 }), {
            reuso: null,
            prioridad: 2,
            rafaga_bajada_kbps: 40000,
        })
        assert.equal(efectiva.reuso, 4)
        assert.equal(efectiva.prioridad, 2)
        assert.equal(efectiva.rafaga_bajada_kbps, 40000)
        assert.deepEqual(velocidadEfectiva(plan(), null), plan())
    })

    test('leerVelocidad convierte numeric y aplica los defectos del contrato', ({ assert }) => {
        const v = leerVelocidad({
            bajada_kbps: 20000,
            subida_kbps: 5000,
            bajada_limitada_kbps: 0,
            subida_limitada_kbps: 0,
            garantizado_pct: '33.33',
            rate_limit_override: '',
        })
        assert.equal(v.garantizado_pct, 33.33)
        assert.equal(v.reuso, 1)
        assert.equal(v.rafaga_umbral_pct, 75)
        assert.equal(v.rafaga_segundos, 16)
        assert.equal(v.prioridad, 8)
        assert.isNull(v.rate_limit_override)
    })

    test('coherente: sin errores', ({ assert }) => {
        assert.deepEqual(validarVelocidad(plan()), [])
        assert.deepEqual(
            validarVelocidad(plan({ reuso: 4, garantizado_pct: 25, rafaga_bajada_kbps: 20001 })),
            [],
        )
    })

    test('CIR ≤ MIR / reuso, ráfaga > MIR, umbral < 100 %, rangos', ({ assert }) => {
        const campos = (p: VelocidadPlan) => validarVelocidad(p).map((e) => e.field)
        assert.deepEqual(campos(plan({ garantizado_pct: 101 })), ['garantizado_pct'])
        assert.deepEqual(campos(plan({ reuso: 4, garantizado_pct: 25.01 })), ['garantizado_pct'])
        assert.deepEqual(campos(plan({ rafaga_bajada_kbps: 20000 })), ['rafaga_bajada_kbps'])
        assert.deepEqual(campos(plan({ rafaga_subida_kbps: 4000 })), ['rafaga_subida_kbps'])
        assert.deepEqual(campos(plan({ rafaga_bajada_kbps: 30000, rafaga_umbral_pct: 100 })), [
            'rafaga_umbral_pct',
        ])
        // sin ráfaga, el umbral no importa
        assert.deepEqual(campos(plan({ rafaga_umbral_pct: 100 })), [])
        assert.deepEqual(campos(plan({ prioridad: 0 })), ['prioridad'])
        assert.deepEqual(campos(plan({ prioridad: 9 })), ['prioridad'])
        assert.deepEqual(campos(plan({ reuso: 65 })), ['reuso'])
        assert.deepEqual(campos(plan({ reuso: 0 })), ['reuso'])
        assert.deepEqual(campos(plan({ rafaga_bajada_kbps: 30000, rafaga_segundos: 0 })), ['rafaga_segundos'])
    })
})
