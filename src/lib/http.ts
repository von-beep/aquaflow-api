import type { Request, Response } from 'express'

export function stationId(req: Request): string {
  const id = req.auth?.stationId
  if (!id) throw new Error('Missing stationId on authenticated request')
  return id
}

export function sendError(
  res: Response,
  status: number,
  error: string,
  message: string,
): void {
  res.status(status).json({ error, message })
}

export function notFound(res: Response, entity = 'Resource'): void {
  sendError(res, 404, 'not_found', `${entity} not found`)
}

export function badRequest(res: Response, message: string): void {
  sendError(res, 400, 'validation_error', message)
}
