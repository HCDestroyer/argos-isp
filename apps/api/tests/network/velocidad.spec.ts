import { test } from '@japa/runner'
import {
    formatoKbps,
    garantizadoKbps,
    leerVelocidad,
    hijo,
    hijosDelPlan,
    limitesPadrePlan,
    mayorHijos,
    rateLimitServicio,
    SIN_HIJOS,
    sumarHijos,
    topePadre,
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
    /** Plan del PM (5 nov): 20/10 Mbps, 1:4, con o sin ráfaga 30/15. */
    const pm = (rafaga: boolean) =>
        plan({
            bajada_kbps: 20000,
            subida_kbps: 10000,
            reuso: 4,
            rafaga_bajada_kbps: rafaga ? 30000 : null,
            rafaga_subida_kbps: rafaga ? 15000 : null,
        })

    test('1 hijo con reuso 1:4: el padre deja pasar su plan completo (antes MIR/4)', ({ assert }) => {
        const l = limitesPadrePlan(pm(false), 1)
        assert.equal(l.max_limit, '10M/20M')
        assert.equal(l.limit_at, '2500k/5M')
    })

    test('N hijos con reuso 4: ceil(Σ MIR / 4), nunca bajo un MIR ni sobre Σ MIR', ({ assert }) => {
        assert.equal(limitesPadrePlan(pm(false), 2).max_limit, '10M/20M')
        assert.equal(limitesPadrePlan(pm(false), 2).limit_at, '5M/10M')
        assert.equal(limitesPadrePlan(pm(false), 4).max_limit, '10M/20M')
        assert.equal(limitesPadrePlan(pm(false), 8).max_limit, '20M/40M')
        assert.equal(limitesPadrePlan(pm(false), 8).limit_at, '20M/40M')
        const p = plan({ reuso: 4 })
        assert.deepEqual(limitesPadrePlan(p, 4), {
            max_limit: '5M/20M',
            limit_at: '5M/20M',
            prioridad: 8,
            max_limit_kbps: { subida: 5000, bajada: 20000 },
            limit_at_kbps: { subida: 5000, bajada: 20000 },
        })
    })

    test('max-limit hacia arriba y limit-at hacia abajo: Σ limit-at ≤ padre', ({ assert }) => {
        const p = plan({ reuso: 3 })
        const l = limitesPadrePlan(p, 5)
        assert.deepEqual(l.max_limit_kbps, { subida: 8334, bajada: 33334 })
        assert.deepEqual(l.limit_at_kbps, { subida: 8330, bajada: 33330 })
        assert.isAtMost(l.limit_at_kbps.bajada, l.max_limit_kbps.bajada)
        assert.equal(l.max_limit, '8334k/33334k')
    })

    test('reuso 1: el padre es la suma de los MIR (1 hijo = su plan)', ({ assert }) => {
        assert.equal(limitesPadrePlan(plan(), 3).max_limit, '15M/60M')
        assert.equal(limitesPadrePlan(plan(), 3).limit_at, '15M/60M')
        assert.equal(limitesPadrePlan(plan(), 1).max_limit, '5M/20M')
    })

    test('ráfaga: el padre nunca corta la ráfaga de un hijo; el agregado sigue en Σ MIR', ({ assert }) => {
        // 1 hijo: clamp(5M, 30M, max(20M, 30M)) = 30M
        assert.equal(limitesPadrePlan(pm(true), 1).max_limit, '15M/30M')
        // 2 hijos: clamp(10M, 30M, 40M) = 30M
        assert.equal(limitesPadrePlan(pm(true), 2).max_limit, '15M/30M')
        // 8 hijos: clamp(40M, 30M, 160M) = 40M
        assert.equal(limitesPadrePlan(pm(true), 8).max_limit, '20M/40M')
        // con reuso 1 y 2 hijos: Σ MIR (40M) ya cubre la ráfaga de uno (30M)
        assert.equal(limitesPadrePlan({ ...pm(true), reuso: 1 }, 2).max_limit, '20M/40M')
        // la ráfaga no cambia la garantía
        assert.equal(limitesPadrePlan(pm(true), 1).limit_at, '2500k/5M')
    })

    test('limitados cuentan con la velocidad limitada y sin ráfaga', ({ assert }) => {
        // 6 activos (20M/5M) + 4 limitados (2048k/1024k), 1:4
        const l = limitesPadrePlan(plan({ reuso: 4 }), { activos: 6, limitados: 4 })
        assert.deepEqual(l.max_limit_kbps, { subida: 8524, bajada: 32048 })
        assert.deepEqual(l.limit_at_kbps, { subida: 8524, bajada: 32048 })
        // solo limitados, aunque el plan tenga ráfaga: pico = velocidad limitada
        const solo = limitesPadrePlan(plan({ rafaga_bajada_kbps: 40000 }), { activos: 0, limitados: 2 })
        assert.equal(solo.max_limit, '2048k/4096k')
        assert.equal(solo.limit_at, '2048k/4096k')
    })

    test('un suspendido no es hijo: suspender uno de 4 baja el padre como si no estuviera', ({ assert }) => {
        const p = plan({ reuso: 1 })
        assert.equal(limitesPadrePlan(p, { activos: 3, limitados: 0 }).max_limit, '15M/60M')
        assert.deepEqual(hijosDelPlan(p, { activos: 3 }), hijosDelPlan(p, { activos: 3, limitados: 0 }))
    })

    test('0 hijos: max-limit = un hijo del plan (0 sería "sin límite" en RouterOS), limit-at 0', ({
        assert,
    }) => {
        assert.equal(limitesPadrePlan(plan({ reuso: 4 }), 0).max_limit, '5M/20M')
        assert.equal(limitesPadrePlan(plan({ reuso: 4 }), 0).limit_at, '0/0')
        assert.equal(limitesPadrePlan(pm(true), 0).max_limit, '15M/30M')
        assert.throws(() => limitesPadrePlan(plan(), -1), /activos/)
        assert.throws(() => limitesPadrePlan(plan(), 1.5), /activos/)
        assert.throws(() => limitesPadrePlan(plan(), { activos: 1, limitados: -1 }), /limitados/)
    })

    test('topePadre: lo que el router tiene colgando también es hijo (mayorHijos)', ({ assert }) => {
        const p = plan({ reuso: 1 })
        // la base dice 1 sesión; el router ya tiene 2 colas dinámicas (accounting en camino)
        const leidas = sumarHijos(
            hijo({ subida: 5000, bajada: 20000 }, null, { subida: 5000, bajada: 20000 }),
            hijo({ subida: 5000, bajada: 20000 }, null, { subida: 5000, bajada: 20000 }),
        )
        const suma = mayorHijos(hijosDelPlan(p, { activos: 1 }), leidas)
        assert.deepEqual(topePadre(suma, 1), { subida: 10000, bajada: 40000 })
        assert.deepEqual(topePadre(SIN_HIJOS, 4), { subida: 0, bajada: 0 })
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
