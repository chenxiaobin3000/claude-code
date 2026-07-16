import { Command, type Option } from '@commander-js/extra-typings'

function optionSortKey(option: Option): string {
  return (
    option.long?.replace(/^--/, '') ?? option.short?.replace(/^-/, '') ?? ''
  )
}

export function createSortedHelpConfig(): {
  sortSubcommands: true
  sortOptions: true
} {
  return Object.assign({ sortSubcommands: true, sortOptions: true } as const, {
    compareOptions: (left: Option, right: Option) =>
      optionSortKey(left).localeCompare(optionSortKey(right)),
  })
}

export function createProgram(): Command {
  return new Command()
    .configureHelp(createSortedHelpConfig())
    .enablePositionalOptions()
}
