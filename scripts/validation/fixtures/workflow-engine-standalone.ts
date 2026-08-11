#!/usr/bin/env bun

import * as workflow from '../../../packages/workflow-engine/src/index.js'
import { executeWorkflowFixture } from './workflow-engine-runtime.js'

const runsDir = process.argv[3]
if (!runsDir) throw new Error('workflow fixture requires a runs directory')
console.log(JSON.stringify(await executeWorkflowFixture(workflow, runsDir)))
