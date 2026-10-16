import { test } from '@japa/runner'
import { nombreCampo } from '#shared/nombres_campo'
import { MASCARA, enmascarar, esCampoSensible } from '#shared/enmascarar'

test.group('Auditoría · nombres de campo (unitarias)', () => {
    test('las claves snake_case o de una palabra quedan igual, con sus dígitos', ({ assert }) => {
        for (const clave of [
            'ipv4',
            'prefijo_enlace_v6',
            'prefijo_delegado_v6',
            'ipv6_modo',
            'ipv6_duid',
            'pass_ppp',
            'estado',
            'excepcion_facturas_para_cortar',
            'red_ipv4_id',
        ]) {
            assert.equal(nombreCampo(clave), clave)
        }
    })

    test('camelCase y PascalCase se convierten sin separar dígitos', ({ assert }) => {
        assert.equal(nombreCampo('prefijoEnlaceV6'), 'prefijo_enlace_v6')
        assert.equal(nombreCampo('prefijoDelegadoV6'), 'prefijo_delegado_v6')
        assert.equal(nombreCampo('redIpv4Id'), 'red_ipv4_id')
        assert.equal(nombreCampo('ipv6Modo'), 'ipv6_modo')
        assert.equal(nombreCampo('passPpp'), 'pass_ppp')
        assert.equal(nombreCampo('userPpp'), 'user_ppp')
        assert.equal(nombreCampo('apiPassword'), 'api_password')
        assert.equal(nombreCampo('APIPassword'), 'api_password')
        assert.equal(nombreCampo('PlanId'), 'plan_id')
        assert.equal(nombreCampo('createdAt'), 'created_at')
    })

    test('esCampoSensible reconoce snake_case, camelCase y sufijos', ({ assert }) => {
        for (const campo of [
            'pass_ppp',
            'passPpp',
            'api_password',
            'apiPassword',
            'radius_secret',
            'radiusSecret',
            'token',
            'api_token',
            'tokenHash',
            'token_hash',
            'password',
            'contrasena',
            'api_key',
            'llave_privada',
            'token2',
            'radius_secret_v2',
        ]) {
            assert.isTrue(esCampoSensible(campo), campo)
        }
        for (const campo of [
            'ipv4',
            'prefijo_enlace_v6',
            'user_ppp',
            'nombre',
            'clave_ppp_cambiada',
            'hashtag',
        ]) {
            assert.isFalse(esCampoSensible(campo), campo)
        }
    })

    test('enmascarar oculta los sensibles en cualquier nivel', ({ assert }) => {
        assert.deepEqual(
            enmascarar({
                passPpp: 'x',
                ipv4: '100.64.0.2',
                router: { api_password: 'y', radiusSecret: 'z' },
            }),
            {
                passPpp: MASCARA,
                ipv4: '100.64.0.2',
                router: { api_password: MASCARA, radiusSecret: MASCARA },
            },
        )
    })
})
