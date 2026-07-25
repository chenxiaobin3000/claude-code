import { isFullFileRead, type FileState } from '../../src/utils/fileStateCache.js'
import { assertEqual } from './assertions.js'

function state(
  offset: FileState['offset'],
  limit: FileState['limit'],
  isPartialView?: boolean,
): Pick<FileState, 'offset' | 'limit' | 'isPartialView'> {
  return { offset, limit, isPartialView }
}

const cases: Array<{
  name: string
  value: Pick<FileState, 'offset' | 'limit' | 'isPartialView'> | undefined
  expected: boolean
}> = [
  {
    name: 'Read default offset is a complete read',
    value: state(1, undefined),
    expected: true,
  },
  {
    name: 'post-Write or post-Edit state is complete',
    value: state(undefined, undefined),
    expected: true,
  },
  {
    name: 'later offset is partial',
    value: state(2, undefined),
    expected: false,
  },
  {
    name: 'limited read is partial',
    value: state(1, 100),
    expected: false,
  },
  {
    name: 'injected partial view is partial',
    value: state(undefined, undefined, true),
    expected: false,
  },
  { name: 'missing state is not complete', value: undefined, expected: false },
]

for (const testCase of cases) {
  assertEqual(
    isFullFileRead(testCase.value),
    testCase.expected,
    testCase.name,
  )
}

console.log('[file-read-state] PASS')
