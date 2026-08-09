#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const fixtureRoot = join(import.meta.dir, 'fixtures', 'chrome-dom')

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
    },
  })
}

function oversizedNodePage(): string {
  return `<!doctype html><html><head><title>Node Limit</title></head><body><main id="too-many">${Array.from(
    { length: 5_100 },
    (_, index) => `<div>节点 ${index + 1}</div>`,
  ).join('')}</main><section id="small-recovery">恢复成功</section></body></html>`
}

function oversizedBytePage(): string {
  const text = '高精度验收内容'.repeat(80)
  return `<!doctype html><html><head><title>Byte Limit</title></head><body><main id="too-large">${Array.from(
    { length: 1_500 },
    (_, index) => `<p>${index + 1}:${text}</p>`,
  ).join('')}</main><section id="small-recovery">恢复成功</section></body></html>`
}

async function primaryRoute(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname
  if (pathname === '/' || pathname === '/index.html') {
    return htmlResponse(await readFile(join(fixtureRoot, 'index.html'), 'utf8'))
  }
  if (pathname === '/same-origin-frame.html') {
    return htmlResponse(
      await readFile(join(fixtureRoot, 'same-origin-frame.html'), 'utf8'),
    )
  }
  if (pathname === '/too-many.html') return htmlResponse(oversizedNodePage())
  if (pathname === '/too-large.html') return htmlResponse(oversizedBytePage())
  return new Response('Not found', { status: 404 })
}

async function crossOriginRoute(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname
  if (pathname === '/cross-origin-frame.html') {
    return htmlResponse(
      await readFile(join(fixtureRoot, 'cross-origin-frame.html'), 'utf8'),
    )
  }
  return new Response('Not found', { status: 404 })
}

const primary = Bun.serve({
  hostname: '127.0.0.1',
  port: 18_080,
  fetch: primaryRoute,
})
const crossOrigin = Bun.serve({
  hostname: '127.0.0.1',
  port: 18_081,
  fetch: crossOriginRoute,
})

console.log(
  `[chrome-dom-fixture] READY ${primary.url}index.html cross-origin=${crossOrigin.url}`,
)

async function close(): Promise<void> {
  await Promise.all([primary.stop(), crossOrigin.stop()])
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
