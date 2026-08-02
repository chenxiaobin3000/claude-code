const REF_ATTRIBUTE = 'data-claude-code-ref'
const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',')
let nextRefId = 1

function visible(element) {
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    rect.width > 0 &&
    rect.height > 0
  )
}

function ensureRef(element) {
  let ref = element.getAttribute(REF_ATTRIBUTE)
  if (!ref) {
    ref = `ref_${nextRefId++}`
    element.setAttribute(REF_ATTRIBUTE, ref)
  }
  return ref
}

function labelFor(element) {
  return (
    element.getAttribute('aria-label') ||
    element.getAttribute('placeholder') ||
    element.getAttribute('title') ||
    element.innerText ||
    element.value ||
    ''
  )
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 240)
}

function describe(element) {
  const rect = element.getBoundingClientRect()
  return {
    ref: ensureRef(element),
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role') || undefined,
    label: labelFor(element),
    type: element.getAttribute('type') || undefined,
    href: element instanceof HTMLAnchorElement ? element.href : undefined,
    visible: visible(element),
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  }
}

function readPage(args) {
  const root = args.ref_id
    ? document.querySelector(`[${REF_ATTRIBUTE}="${CSS.escape(args.ref_id)}"]`)
    : document.body
  if (!root) throw new Error(`Element reference not found: ${args.ref_id}`)
  const selector = args.filter === 'interactive' ? INTERACTIVE_SELECTOR : '*'
  const max = Math.max(1, Math.min(Number(args.max_chars || 50000), 100000))
  const items = Array.from(root.querySelectorAll(selector))
    .filter(element => args.filter !== 'interactive' || visible(element))
    .slice(0, 1500)
    .map(element => describe(element))
  const output = JSON.stringify({
    title: document.title,
    url: location.href,
    elements: items,
  })
  if (output.length > max) {
    throw new Error(
      `Page representation is ${output.length} characters; reduce scope or max depth (limit ${max}).`,
    )
  }
  return output
}

function findElements(args) {
  const query = String(args.query || '')
    .trim()
    .toLowerCase()
  if (!query) throw new Error('Find query is empty.')
  const terms = query.split(/\s+/).filter(term => term.length > 1)
  const matches = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))
    .filter(visible)
    .map(element => ({ element, description: describe(element) }))
    .filter(({ description }) => {
      const haystack =
        `${description.tag} ${description.role || ''} ${description.type || ''} ${description.label}`.toLowerCase()
      return terms.every(term => haystack.includes(term))
    })
    .slice(0, 20)
    .map(({ description }) => description)
  return JSON.stringify({ query, matches })
}

function elementByRef(ref) {
  const element = document.querySelector(
    `[${REF_ATTRIBUTE}="${CSS.escape(String(ref))}"]`,
  )
  if (!element)
    throw new Error(
      `Element reference not found: ${ref}. Run read_page or find again.`,
    )
  return element
}

function setNativeValue(element, value) {
  if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    element.checked = Boolean(value)
  } else if (element instanceof HTMLSelectElement) {
    const option = Array.from(element.options).find(
      item => item.value === String(value) || item.text === String(value),
    )
    element.value = option ? option.value : String(value)
  } else if ('value' in element) {
    element.value = String(value)
  } else if (element.isContentEditable) {
    element.textContent = String(value)
  } else {
    throw new Error('Referenced element is not an editable form control.')
  }
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function modifiersFromText(text) {
  const values = String(text || '')
    .toLowerCase()
    .split('+')
  return {
    ctrlKey: values.includes('ctrl'),
    shiftKey: values.includes('shift'),
    altKey: values.includes('alt'),
    metaKey:
      values.includes('cmd') ||
      values.includes('meta') ||
      values.includes('win'),
  }
}

function targetFor(args) {
  if (args.ref) return elementByRef(args.ref)
  const [x, y] = args.coordinate || []
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw new Error('A valid coordinate or element ref is required.')
  const element = document.elementFromPoint(x, y)
  if (!element) throw new Error(`No element found at coordinate ${x}, ${y}.`)
  return element
}

function runComputer(args) {
  const action = args.action
  if (action === 'scroll_to') {
    const element = elementByRef(args.ref)
    element.scrollIntoView({
      block: 'center',
      inline: 'center',
      behavior: 'instant',
    })
    return { ok: true }
  }
  if (action === 'scroll') {
    const amount = Math.max(1, Number(args.scroll_amount || 3)) * 160
    const delta = {
      up: [0, -amount],
      down: [0, amount],
      left: [-amount, 0],
      right: [amount, 0],
    }[args.scroll_direction]
    if (!delta) throw new Error('Invalid scroll direction.')
    window.scrollBy({ left: delta[0], top: delta[1], behavior: 'instant' })
    return { ok: true, scrollX, scrollY }
  }
  if (action === 'type') {
    const element = document.activeElement
    if (!element) throw new Error('No active element to type into.')
    setNativeValue(element, args.text || '')
    return { ok: true }
  }
  if (action === 'key') {
    const target = document.activeElement || document.body
    const sequences = String(args.text || '')
      .split(/\s+/)
      .filter(Boolean)
    const repeat = Math.max(1, Math.min(Number(args.repeat || 1), 100))
    for (let count = 0; count < repeat; count++) {
      for (const sequence of sequences) {
        const parts = sequence.split('+')
        const key = parts.at(-1)
        const modifiers = modifiersFromText(parts.slice(0, -1).join('+'))
        target.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            code: key,
            bubbles: true,
            ...modifiers,
          }),
        )
        target.dispatchEvent(
          new KeyboardEvent('keyup', {
            key,
            code: key,
            bubbles: true,
            ...modifiers,
          }),
        )
      }
    }
    return { ok: true }
  }
  const element = targetFor(args)
  if (action === 'hover') {
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    return { ok: true }
  }
  if (action === 'left_click_drag') {
    const [startX, startY] = args.start_coordinate || []
    const [endX, endY] = args.coordinate || []
    const start = document.elementFromPoint(startX, startY)
    if (!start) throw new Error('No element found at drag start coordinate.')
    start.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        clientX: startX,
        clientY: startY,
        buttons: 1,
      }),
    )
    element.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: endX,
        clientY: endY,
        buttons: 1,
      }),
    )
    element.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        clientX: endX,
        clientY: endY,
      }),
    )
    return { ok: true }
  }
  const eventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    ...modifiersFromText(args.modifiers),
  }
  if (action === 'right_click') {
    element.dispatchEvent(
      new MouseEvent('contextmenu', { ...eventInit, button: 2 }),
    )
  } else {
    if (typeof element.focus === 'function') {
      element.focus({ preventScroll: true })
    }
    const count =
      action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1
    for (let i = 0; i < count; i++) element.click()
    if (count === 2)
      element.dispatchEvent(new MouseEvent('dblclick', eventInit))
  }
  return { ok: true, element: labelFor(element) }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'page_tool') return
  try {
    let result
    if (message.action === 'read_page') result = readPage(message.args)
    else if (message.action === 'find') result = findElements(message.args)
    else if (message.action === 'form_input') {
      setNativeValue(elementByRef(message.args.ref), message.args.value)
      result = { ok: true }
    } else if (message.action === 'get_page_text') {
      const article = document.querySelector('article, main, [role="main"]')
      result = (article?.innerText || document.body?.innerText || '').slice(
        0,
        100000,
      )
    } else if (message.action === 'computer') result = runComputer(message.args)
    else throw new Error(`Unsupported page action: ${message.action}`)
    sendResponse({ ok: true, result })
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
