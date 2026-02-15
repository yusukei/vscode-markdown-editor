import { saveVditorOptions } from './utils'

let _isSourceMode = false
let _previousMode: string = 'ir'

export function isSourceMode() {
  return _isSourceMode
}

export function enterSourceMode() {
  if (_isSourceMode) return

  // Save current mode before switching
  _previousMode = vditor.vditor.currentMode

  _isSourceMode = true

  // Switch to SV mode internally
  const md = vditor.getValue()
  vditor.vditor.lute.SetVditorIR(false)
  vditor.vditor.lute.SetVditorWYSIWYG(false)
  vditor.vditor.lute.SetVditorSV(true)
  vditor.vditor.currentMode = 'sv'

  // Hide other editing areas
  vditor.vditor.ir.element.parentElement.style.display = 'none'
  vditor.vditor.wysiwyg.element.parentElement.style.display = 'none'
  vditor.vditor.sv.element.style.display = 'block'

  // Hide preview pane
  vditor.vditor.preview.element.style.display = 'none'

  // Set SV content
  vditor.setValue(md, true)

  // Add source mode class for CSS styling
  document.getElementById('app').classList.add('vditor-source-mode')

  // Update toolbar button state
  updateSourceButton(true)

  saveVditorOptions()
}

export function exitSourceMode(targetMode?: string) {
  if (!_isSourceMode) return

  _isSourceMode = false

  // Remove source mode class
  document.getElementById('app').classList.remove('vditor-source-mode')

  // Update toolbar button state
  updateSourceButton(false)

  // Switch to target mode or previous mode
  const mode = targetMode || _previousMode || 'ir'
  const md = vditor.getValue()

  if (mode === 'ir') {
    vditor.vditor.lute.SetVditorIR(true)
    vditor.vditor.lute.SetVditorWYSIWYG(false)
    vditor.vditor.lute.SetVditorSV(false)
    vditor.vditor.currentMode = 'ir'
    vditor.vditor.sv.element.style.display = 'none'
    vditor.vditor.wysiwyg.element.parentElement.style.display = 'none'
    vditor.vditor.ir.element.parentElement.style.display = 'block'
  } else if (mode === 'wysiwyg') {
    vditor.vditor.lute.SetVditorIR(false)
    vditor.vditor.lute.SetVditorWYSIWYG(true)
    vditor.vditor.lute.SetVditorSV(false)
    vditor.vditor.currentMode = 'wysiwyg'
    vditor.vditor.sv.element.style.display = 'none'
    vditor.vditor.ir.element.parentElement.style.display = 'none'
    vditor.vditor.wysiwyg.element.parentElement.style.display = 'block'
  } else {
    // sv mode - restore with preview
    vditor.vditor.lute.SetVditorIR(false)
    vditor.vditor.lute.SetVditorWYSIWYG(false)
    vditor.vditor.lute.SetVditorSV(true)
    vditor.vditor.currentMode = 'sv'
    vditor.vditor.sv.element.style.display = 'block'
    vditor.vditor.ir.element.parentElement.style.display = 'none'
    vditor.vditor.wysiwyg.element.parentElement.style.display = 'none'
    if (vditor.vditor.options.preview.mode === 'both') {
      vditor.vditor.preview.element.style.display = 'block'
    }
  }

  vditor.setValue(md, true)
  saveVditorOptions()
}

export function toggleSourceMode() {
  if (_isSourceMode) {
    exitSourceMode()
  } else {
    enterSourceMode()
  }
}

function updateSourceButton(active: boolean) {
  const btn = document.querySelector('.vditor-toolbar [data-type="source-mode"]') as HTMLElement
  if (btn) {
    if (active) {
      btn.classList.add('vditor-menu--current')
    } else {
      btn.classList.remove('vditor-menu--current')
    }
  }
}

/**
 * Hook into vditor's edit-mode buttons to exit source mode when user picks another mode.
 */
export function hookEditModeButtons() {
  const editModeEl = document.querySelector('.vditor-toolbar [data-type="edit-mode"]')
  if (!editModeEl) return

  editModeEl.querySelectorAll('button[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (_isSourceMode) {
        _isSourceMode = false
        document.getElementById('app').classList.remove('vditor-source-mode')
        updateSourceButton(false)
      }
    })
  })
}

/**
 * Restore source mode state after vditor re-initialization.
 */
export function restoreSourceMode(options: any) {
  _isSourceMode = false
  if (options && options.sourceMode) {
    // Delay to ensure vditor is fully initialized
    setTimeout(() => {
      enterSourceMode()
    }, 100)
  }
}
