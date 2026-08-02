---
name: claude-in-chrome
description: Control the user's local Chrome when the task requires existing tabs, authenticated sessions, OAuth, or visible browser interaction.
allowed-tools:
  - mcp__plugin_chrome_claude-in-chrome__tabs_context_mcp
  - mcp__plugin_chrome_claude-in-chrome__tabs_create_mcp
  - mcp__plugin_chrome_claude-in-chrome__navigate
  - mcp__plugin_chrome_claude-in-chrome__read_page
  - mcp__plugin_chrome_claude-in-chrome__find
  - mcp__plugin_chrome_claude-in-chrome__form_input
  - mcp__plugin_chrome_claude-in-chrome__computer
  - mcp__plugin_chrome_claude-in-chrome__javascript_tool
  - mcp__plugin_chrome_claude-in-chrome__get_page_text
  - mcp__plugin_chrome_claude-in-chrome__update_plan
  - mcp__plugin_chrome_claude-in-chrome__resize_window
user-invocable: true
---

# Claude in Chrome

Use this Skill only for the user's local Chrome through the chrome Plugin and
its extension. It is appropriate when the task depends on an existing signed-in
session, an OAuth flow, current tabs, or visible browser interaction.

At the start of each browser task, call `tabs_context_mcp`. Never reuse a tab ID
from another session. Reuse an existing tab only when the user explicitly asks
to work in it; otherwise create a fresh tab. Refresh tab context after a tab is
closed, navigation invalidates it, or a tool reports an unknown tab.

Each tab includes a stable `profileId` and user-defined `profileName`. When more
than one Chrome profile is connected, copy the exact `profileId` into every
subsequent browser tool call, including tab creation. Never infer an account
from a tab ID, choose the first profile, or fall back to another profile when
the selected one disconnects. Ask the user when the requested account cannot
be matched unambiguously.

The extension grants site access. `update_plan` can report the domains a task
expects to use, but it does not grant permission and must not be treated as an
authorization bypass. Respect every permission response from the extension.

Avoid actions that trigger JavaScript alerts, confirmations, prompts, or other
modal dialogs because they can block the extension. If a dialog is already
blocking the page, ask the user to dismiss it manually.

Stay within the requested browser task. Stop and explain the failure after two
or three unsuccessful attempts, no extension response, repeated timeouts, or
unresponsive page elements. Do not keep retrying or explore unrelated pages.

Only use the eleven tools declared in `allowed-tools`. The plugin does not
provide GIF creation, image upload, console or network inspection, shortcut
execution, or `computer.zoom`.
