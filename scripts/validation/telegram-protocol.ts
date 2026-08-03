#!/usr/bin/env bun
import { extractTelegramAttachments, isTelegramMessageRelevant, toTelegramInbound } from '../../plugins/telegram/src/client.js'
import { classifyTelegramError, splitTelegramText, telegramRetryAfter } from '../../plugins/telegram/src/protocol.js'
import { assert, assertEqual } from './assertions.js'

const bot = { id: 99, username: 'helper_bot' }
const base = { message_id: 7, chat: { id: -10, type: 'supergroup' }, from: { id: 1, first_name: 'A' } }
assert(isTelegramMessageRelevant({ ...base, chat: { id: 1, type: 'private' } }, bot), 'private message accepted')
assert(isTelegramMessageRelevant({ ...base, text: '@helper_bot hi', entities: [{ type: 'mention', offset: 0, length: 11 }] }, bot), 'mention accepted')
assert(isTelegramMessageRelevant({ ...base, text: '/run@helper_bot', entities: [{ type: 'bot_command', offset: 0, length: 15 }] }, bot), 'addressed command accepted')
assert(isTelegramMessageRelevant({ ...base, reply_to_message: { message_id: 2, from: { id: 99 } } }, bot), 'reply to bot accepted')
assert(!isTelegramMessageRelevant({ ...base, text: 'hello everyone' }, bot), 'unaddressed group text rejected')
assert(!isTelegramMessageRelevant({ ...base, text: '/run', entities: [{ type: 'bot_command', offset: 0, length: 4 }] }, bot), 'unscoped group command rejected')
const attachments = extractTelegramAttachments({ ...base, photo: [{ file_id: 'small', file_size: 1 }, { file_id: 'large', file_size: 2 }], document: { file_id: 'doc', file_name: 'x.txt', file_size: 3 } })
assertEqual(attachments[0]?.fileId, 'large', 'largest Telegram photo selected')
assertEqual(attachments[1]?.kind, 'document', 'Telegram document extracted')
const inbound = toTelegramInbound('alpha', 123, { ...base, message_thread_id: 42, caption: 'caption', voice: { file_id: 'voice', file_size: 4 } })
assertEqual(inbound?.topicId, 42, 'Telegram topic preserved')
assertEqual(inbound?.text, 'caption', 'Telegram caption preserved')
assertEqual(splitTelegramText('😀'.repeat(4097)).length, 2, 'Unicode text split without surrogate damage')
assertEqual([...splitTelegramText('😀'.repeat(4097))[0]!].length, 4096, 'Telegram character limit')
assertEqual(telegramRetryAfter({ error_code: 429, parameters: { retry_after: 2 } }), 2000, '429 retry_after')
assertEqual(classifyTelegramError({ error_code: 409 }), 'conflict', '409 conflict classification')
assertEqual(classifyTelegramError({ name: 'HttpError' }), 'network', 'network classification')
console.log('[telegram-protocol] PASS')
