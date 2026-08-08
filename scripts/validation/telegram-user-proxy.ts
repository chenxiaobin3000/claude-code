#!/usr/bin/env bun
import { createServer, connect, type Socket } from 'node:net'
import { PromisedNetSockets } from '../../plugins/telegram-user/node_modules/telegram/extensions/PromisedNetSockets.js'
import { createGramJsClient } from '../../plugins/telegram-user/src/client.js'
import {
  classifyTelegramUserTransportError,
  createTelegramUserTransport,
  redactTelegramUserProxySecret,
} from '../../plugins/telegram-user/src/transport.js'
import { assert, assertEqual } from './assertions.js'

function assertThrows(operation: () => unknown, includes: string): void {
  try {
    operation()
  } catch (error) {
    assert(error instanceof Error && error.message.includes(includes), `expected error containing ${includes}`)
    return
  }
  throw new Error(`expected error containing ${includes}`)
}

function socketReader(socket: Socket): (count: number) => Promise<Buffer> {
  let buffered = Buffer.alloc(0)
  const waiters: Array<() => void> = []
  socket.on('data', chunk => {
    buffered = Buffer.concat([buffered, chunk])
    waiters.splice(0).forEach(resolve => resolve())
  })
  return async count => {
    while (buffered.length < count) await new Promise<void>(resolve => waiters.push(resolve))
    const result = buffered.subarray(0, count)
    buffered = buffered.subarray(count)
    return result
  }
}

let targetConnections = 0
const openSockets = new Set<Socket>()
const target = createServer(socket => {
  openSockets.add(socket)
  socket.on('close', () => openSockets.delete(socket))
  targetConnections++
  socket.on('data', data => socket.write(data))
})
await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve))
const targetAddress = target.address()
if (!targetAddress || typeof targetAddress === 'string') throw new Error('SOCKS target fixture failed')

let proxyConnections = 0
let proxyAuthentications = 0
const proxy = createServer(socket => {
  openSockets.add(socket)
  socket.on('close', () => openSockets.delete(socket))
  void (async () => {
    proxyConnections++
    const read = socketReader(socket)
    const greeting = await read(2)
    assertEqual(greeting[0], 5, 'SOCKS version')
    const methods = await read(greeting[1] ?? 0)
    assert(methods.includes(2), 'SOCKS username/password method offered')
    socket.write(Buffer.from([5, 2]))
    const authHeader = await read(2)
    const username = (await read(authHeader[1] ?? 0)).toString()
    const passwordLength = (await read(1))[0] ?? 0
    const password = (await read(passwordLength)).toString()
    assertEqual(username, 'fixture-user', 'SOCKS username')
    assertEqual(password, 'fixture-pass', 'SOCKS password')
    proxyAuthentications++
    socket.write(Buffer.from([1, 0]))

    const request = await read(4)
    assertEqual(request[0], 5, 'SOCKS request version')
    assertEqual(request[1], 1, 'SOCKS CONNECT command')
    let host: string
    if (request[3] === 1) host = [...await read(4)].join('.')
    else if (request[3] === 3) host = (await read((await read(1))[0] ?? 0)).toString()
    else throw new Error(`unsupported fixture address type ${request[3]}`)
    const portBytes = await read(2)
    const port = portBytes.readUInt16BE(0)
    const upstream = connect(port, host, () => {
      socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
  })().catch(() => socket.destroy())
})
await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
const proxyAddress = proxy.address()
if (!proxyAddress || typeof proxyAddress === 'string') throw new Error('SOCKS proxy fixture failed')

try {
  assertEqual(createTelegramUserTransport().proxyMode, 'direct', 'direct mode')
  assertThrows(() => createTelegramUserTransport('http://127.0.0.1:8080'), 'not supported')
  assertThrows(() => createTelegramUserTransport('socks5://127.0.0.1:1080/?secret=yes'), 'query parameters')
  assert(!redactTelegramUserProxySecret('socks5://fixture-user:fixture-pass@example.test').includes('fixture-pass'), 'proxy password redacted')
  assertEqual(classifyTelegramUserTransportError(new Error('connection timeout')), 'timeout', 'SOCKS timeout classified')

  const proxyUrl = `socks5://fixture-user:fixture-pass@127.0.0.1:${proxyAddress.port}`
  const transport = createTelegramUserTransport(proxyUrl)
  assertEqual(transport.proxyMode, 'socks5', 'SOCKS5 mode')
  assert(!transport.proxyDisplay.includes('fixture-user'), 'display omits credentials')

  const first = new PromisedNetSockets(transport.proxy)
  await first.connect(targetAddress.port, '127.0.0.1')
  first.write(Buffer.from('through-socks'))
  assertEqual((await first.readExactly(13)).toString(), 'through-socks', 'SOCKS tunnel bytes')
  await first.close()
  assertEqual(proxyAuthentications, 1, 'SOCKS authentication used')
  assertEqual(targetConnections, 1, 'target reached through proxy')

  const credentials = { apiId: 12345, apiHash: '0123456789abcdef0123456789abcdef' }
  const accountOne = createGramJsClient(credentials, '', proxyUrl) as unknown as { _proxy?: { ip: string; port: number } }
  const accountTwo = createGramJsClient(credentials, '', proxyUrl) as unknown as { _proxy?: { ip: string; port: number } }
  assertEqual(accountOne._proxy?.port, proxyAddress.port, 'first account proxy bound')
  assertEqual(accountTwo._proxy?.port, proxyAddress.port, 'second account proxy bound')

  const beforeFailure = targetConnections
  let failed = false
  const unavailable = new PromisedNetSockets(createTelegramUserTransport('socks5://127.0.0.1:1').proxy)
  try {
    await unavailable.connect(targetAddress.port, '127.0.0.1')
  } catch {
    failed = true
  } finally {
    await unavailable.close().catch(() => undefined)
  }
  assert(failed, 'unavailable SOCKS proxy fails')
  assertEqual(targetConnections, beforeFailure, 'SOCKS failure never falls back to direct target')
  assertEqual(proxyConnections, 1, 'only successful SOCKS connection reached proxy fixture')
} finally {
  for (const socket of openSockets) socket.destroy()
  await Promise.all([
    new Promise<void>(resolve => target.close(() => resolve())),
    new Promise<void>(resolve => proxy.close(() => resolve())),
  ])
}
console.log('[telegram-user-proxy] PASS')
