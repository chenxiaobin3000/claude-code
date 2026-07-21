#!/usr/bin/env bun

import { generateSettingsJSONSchema } from '../src/utils/settings/schemaOutput.js'

process.stdout.write(`${generateSettingsJSONSchema()}\n`)

