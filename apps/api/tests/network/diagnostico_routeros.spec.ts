import { test } from '@japa/runner'
import { comandosCertificado, diagnosticarErrorRouterOS } from '#network/diagnostico_routeros'
import {
    RouterOSCredenciales,
    RouterOSInalcanzable,
    RouterOSRespuesta,
    RouterOSSolicitud,
} from '#network/routeros/errores'

/** Errores reales del cliente REST (mensaje `GET host/rest/...: <error de Node>`). */
const tls = (texto: string, codigo: string) =>
    new RouterOSInalcanzable(`GET 172.31.250.54/rest/system/resource: ${texto}`, codigo)

const ALERTA_40 =
    'write EPROTO 40F7B1E5A27F0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake ' +
    'failure:../deps/openssl/openssl/ssl/record/rec_layer_s3.c:1605:SSL alert number 40'

test.group('Diagnóstico de errores de RouterOS', () => {
    test('handshake failure (alerta 40): www-ssl sin certificado, con los comandos para crearlo', ({
        assert,
    }) => {
        const d = diagnosticarErrorRouterOS(tls(ALERTA_40, 'EPROTO'), '172.31.250.54:443')
        assert.equal(d.motivo, 'sin_certificado')
        assert.include(d.detalle, 'no tiene certificado en www-ssl')
        assert.include(d.detalle, '/certificate sign argos-ca')
        assert.include(d.detalle, '/certificate sign argosisp-api ca=argos-ca')
        assert.include(d.detalle, 'subject-alt-name=IP:172.31.250.54')
        assert.include(d.detalle, '/ip service set www-ssl certificate=argosisp-api')
        assert.notInclude(d.detalle, 'ssl3_read_bytes')
        assert.include(d.error_tecnico, 'SSL alert number 40')
        assert.include(comandosCertificado('router.lab'), 'subject-alt-name=DNS:router.lab')
    })

    test('autofirmado o emisor desconocido: certificado no confiable (desactivar verificación o pegar la CA)', ({
        assert,
    }) => {
        for (const [texto, codigo] of [
            ['self-signed certificate', 'DEPTH_ZERO_SELF_SIGNED_CERT'],
            ['unable to verify the first certificate', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'],
            ['unable to get local issuer certificate', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'],
            ['self signed certificate in certificate chain', 'SELF_SIGNED_CERT_IN_CHAIN'],
        ]) {
            const d = diagnosticarErrorRouterOS(tls(texto!, codigo!))
            assert.equal(d.motivo, 'certificado_no_confiable', texto)
            assert.include(d.detalle, 'no es de confianza')
            assert.include(d.detalle, '/certificate export-certificate argos-ca')
            assert.notInclude(d.detalle, texto!)
        }
    })

    test('ECONNREFUSED o timeout: www-ssl apagado o bloqueado por firewall', ({ assert }) => {
        for (const error of [
            tls('connect ECONNREFUSED 172.31.250.54:443', 'ECONNREFUSED'),
            tls('sin respuesta en 5000 ms', 'ETIMEDOUT'),
        ]) {
            const d = diagnosticarErrorRouterOS(error)
            assert.equal(d.motivo, 'puerto_cerrado')
            assert.include(d.detalle, 'www-ssl está apagado o un firewall lo bloquea')
            assert.notInclude(d.detalle, 'ECONNREFUSED')
        }
    })

    test('wrong version number: HTTPS contra un puerto HTTP', ({ assert }) => {
        const d = diagnosticarErrorRouterOS(
            tls('write EPROTO ...:SSL routines:ssl3_get_record:wrong version number:...', 'EPROTO'),
        )
        assert.equal(d.motivo, 'protocolo')
        assert.include(d.detalle, 'HTTPS a un puerto HTTP')
        assert.notInclude(d.detalle, 'ssl3_get_record')
    })

    test('401 y «not allowed»: credenciales o políticas api/rest-api del grupo', ({ assert }) => {
        const d401 = diagnosticarErrorRouterOS(new RouterOSCredenciales(401))
        assert.equal(d401.motivo, 'credenciales')
        assert.include(d401.detalle, 'rest-api')
        const prohibido = diagnosticarErrorRouterOS(new RouterOSCredenciales(403, 'not allowed'))
        assert.equal(prohibido.motivo, 'politicas')
        assert.include(prohibido.detalle, 'policy=read,write,api,rest-api')
        // «not allowed» llega también como 400 de RouterOS
        assert.equal(
            diagnosticarErrorRouterOS(new RouterOSSolicitud(400, 'Bad Request', 'not allowed')).motivo,
            'politicas',
        )
    })

    test('otros: respuesta inesperada y router inalcanzable, nunca con el texto crudo', ({ assert }) => {
        assert.equal(diagnosticarErrorRouterOS(new RouterOSRespuesta('no es JSON', 200)).motivo, 'respuesta')
        const d = diagnosticarErrorRouterOS(tls('connect EHOSTUNREACH 172.31.250.54:443', 'EHOSTUNREACH'))
        assert.equal(d.motivo, 'no_responde')
        assert.notInclude(d.detalle, 'EHOSTUNREACH')
        assert.include(d.error_tecnico, 'EHOSTUNREACH')
    })
})
