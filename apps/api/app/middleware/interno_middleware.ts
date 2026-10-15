import { createHash, timingSafeEqual } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import env from '#start/env'
import { NoAutenticado } from '#shared/errores'

function digest(valor: string): Buffer {
    return createHash('sha256').update(valor).digest()
}

/**
 * Endpoints `/api/v1/internal/*` (servicio aaa, coa): `Authorization: Bearer <INTERNAL_TOKEN>`.
 */
export default class InternoMiddleware {
    handle(ctx: HttpContext, next: NextFn) {
        const header = ctx.request.header('authorization') ?? ''
        const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
        if (!token || !timingSafeEqual(digest(token), digest(env.get('INTERNAL_TOKEN')))) {
            throw new NoAutenticado('Se requiere el token interno')
        }
        return next()
    }
}
