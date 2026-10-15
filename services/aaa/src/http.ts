import type { ServerResponse } from 'node:http'

/** Responde JSON con el código indicado. */
export function enviarJson(res: ServerResponse, status: number, cuerpo: unknown): void {
    const json = JSON.stringify(cuerpo)
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(json),
    })
    res.end(json)
}

/** Error en formato RFC 9457 (application/problem+json). */
export function enviarProblema(res: ServerResponse, status: number, title: string, detail?: string): void {
    const json = JSON.stringify({ type: 'about:blank', title, status, ...(detail ? { detail } : {}) })
    res.writeHead(status, {
        'content-type': 'application/problem+json; charset=utf-8',
        'content-length': Buffer.byteLength(json),
    })
    res.end(json)
}
