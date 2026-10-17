import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { redis } from '#shared/redis'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'

/**
 * Semana 3, tarea 6: límite de `POST /auth/login` por IP y por usuario (`app/core/auth/limite_login.ts`).
 * `.env.test` lo apaga; cada prueba lo enciende con un prefijo propio en Redis.
 */

const PROBLEM_JSON = 'application/problem+json; charset=utf-8'
const VARIABLES = [
    'LOGIN_LIMITE_IP',
    'LOGIN_LIMITE_USUARIO',
    'LOGIN_LIMITE_VENTANA_S',
    'LOGIN_LIMITE_PREFIJO',
]

function encender(valores: Record<string, string>) {
    const previos = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
    Object.assign(process.env, { LOGIN_LIMITE_PREFIJO: `prueba-login-${randomUUID()}`, ...valores })
    return () => {
        for (const [v, valor] of Object.entries(previos)) {
            if (valor === undefined) delete process.env[v]
            else process.env[v] = valor
        }
    }
}

async function crearUsuarioLogin() {
    const password = 'clave-de-prueba'
    const { usuario } = await usuarioConRoles(['lectura'], password)
    return { email: usuario.email as string, password }
}

const login = (client: any, email: string, password: string) =>
    client.post('/api/v1/auth/login').json({ email, password })

test.group('Auth · límite de intentos de login', (group) => {
    let apagar: (() => void) | null = null
    group.each.teardown(() => {
        apagar?.()
        apagar = null
    })

    test('por usuario: tras 3 fallidos, 429 con Retry-After aunque la contraseña sea correcta', async ({
        client,
        assert,
    }) => {
        apagar = encender({ LOGIN_LIMITE_IP: '0', LOGIN_LIMITE_USUARIO: '3', LOGIN_LIMITE_VENTANA_S: '120' })
        const { email, password } = await crearUsuarioLogin()
        for (let i = 0; i < 3; i++) await estado(login(client, email, 'incorrecta'), 401)

        const bloqueado = await estado(login(client, email.toUpperCase(), password), 429)
        assert.equal(bloqueado.header('content-type'), PROBLEM_JSON)
        assert.containsSubset(bloqueado.body(), {
            status: 429,
            title: 'Demasiados intentos de inicio de sesión',
        })
        assert.match(bloqueado.body().type, /demasiados_intentos/)
        const espera = Number(bloqueado.header('retry-after'))
        assert.isAbove(espera, 0)
        assert.isAtMost(espera, 120)

        // otra cuenta no se ve afectada
        const otra = await crearUsuarioLogin()
        await estado(login(client, otra.email, otra.password), 200)
    })

    test('por usuario: un login correcto reinicia la cuenta de fallidos', async ({ client }) => {
        apagar = encender({ LOGIN_LIMITE_IP: '0', LOGIN_LIMITE_USUARIO: '3' })
        const { email, password } = await crearUsuarioLogin()
        await estado(login(client, email, 'x1'), 401)
        await estado(login(client, email, 'x2'), 401)
        await estado(login(client, email, password), 200)
        await estado(login(client, email, 'x3'), 401)
        await estado(login(client, email, 'x4'), 401)
        await estado(login(client, email, password), 200)
    })

    test('por IP: cuenta todos los intentos (correctos y fallidos) y responde 429 al pasarse', async ({
        client,
        assert,
    }) => {
        apagar = encender({ LOGIN_LIMITE_IP: '4', LOGIN_LIMITE_USUARIO: '0' })
        const { email, password } = await crearUsuarioLogin()
        const primero = await estado(login(client, email, password), 200)
        assert.equal(primero.header('ratelimit-limit'), '4')
        assert.equal(primero.header('ratelimit-remaining'), '3')
        await estado(login(client, unico('nadie') + '@x.local', 'y'), 401)
        await estado(login(client, email, password), 200)
        await estado(login(client, email, password), 200)
        const r = await estado(login(client, email, password), 429)
        assert.isAbove(Number(r.header('retry-after')), 0)
        assert.include(r.body().detail, 'conexión')
    })

    test('por IP: un cuerpo inválido (422) también consume el cupo, antes de validar', async ({
        client,
        assert,
    }) => {
        apagar = encender({ LOGIN_LIMITE_IP: '3', LOGIN_LIMITE_USUARIO: '0' })
        const { email, password } = await crearUsuarioLogin()
        const invalido = await estado(client.post('/api/v1/auth/login').json({ email: 'no-es-correo' }), 422)
        assert.equal(invalido.header('ratelimit-remaining'), '2')
        await estado(client.post('/api/v1/auth/sesion').json({ password: 'sin correo' }), 422)
        // una sola cuenta por petición: el gancho y el handler no la cuentan dos veces
        const valido = await estado(login(client, email, password), 200)
        assert.equal(valido.header('ratelimit-remaining'), '0')
        const r = await estado(client.post('/api/v1/auth/login').json({}), 429)
        assert.match(r.body().type, /demasiados_intentos/)
    })

    test('si Redis no responde, el login sigue', async ({ client }) => {
        apagar = encender({ LOGIN_LIMITE_IP: '1', LOGIN_LIMITE_USUARIO: '1' })
        const { email, password } = await crearUsuarioLogin()
        const conexion = redis()
        const original = conexion.eval.bind(conexion)
        conexion.eval = (async () => {
            throw new Error('Redis caído (simulado)')
        }) as any
        try {
            await estado(login(client, email, password), 200)
            await estado(login(client, email, password), 200)
        } finally {
            conexion.eval = original
        }
    })
})
