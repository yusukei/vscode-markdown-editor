import * as vscode from 'vscode'
import * as NodePath from 'path'
const KeyVditorOptions = 'vditor.options'

function debug(...args: any[]) {
  console.log(...args)
}

function showError(msg: string) {
  vscode.window.showErrorMessage(`[markdown-editor] ${msg}`)
}

/**
 * Sanitize filename to prevent path traversal attacks
 */
function sanitizeFilename(filename: string): string {
  // Remove any path separators and parent directory references
  return filename
    .replace(/^\.+/, '') // Remove leading dots
    .replace(/[/\\]/g, '_') // Replace path separators
    .replace(/\.\./g, '_') // Replace parent directory references
    .replace(/[^\w\-_.]/g, '_') // Replace other unsafe characters
}

/**
 * Validate that a path is within allowed directory
 */
function isPathWithinDirectory(childPath: string, parentPath: string): boolean {
  const relative = NodePath.relative(parentPath, childPath)
  return !relative.startsWith('..') && !NodePath.isAbsolute(relative)
}

/**
 * Sanitize CSS to prevent XSS attacks
 */
function sanitizeCSS(css: string): string {
  if (!css) return ''
  // Remove potentially dangerous CSS features
  return css
    .replace(/<\s*\/?\s*style[^>]*>/gi, '') // Remove style tags
    .replace(/<\s*\/?\s*script[^>]*>/gi, '') // Remove script tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/expression\s*\(/gi, '') // Remove CSS expressions
    .replace(/@import/gi, '') // Remove @import
    .replace(/<!--/g, '')
    .replace(/-->/g, '')
}

export function activate(context: vscode.ExtensionContext) {
  // Register custom editor provider
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'markdown-editor',
      new MarkdownEditorProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  )

  // Register command for opening from command palette or context menu
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'markdown-editor.openEditor',
      (uri?: vscode.Uri, ...args) => {
        debug('command', uri, args)
        if (uri) {
          vscode.commands.executeCommand('vscode.openWith', uri, 'markdown-editor')
        } else {
          EditorPanel.createOrShow(context, uri)
        }
      }
    )
  )

  context.globalState.setKeysForSync([KeyVditorOptions])
}

/**
 * Provider for markdown custom editor
 */
class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Create an EditorPanel instance to handle this editor
    new EditorPanel(
      this.context,
      webviewPanel,
      this.context.extensionUri,
      document,
      document.uri
    )
  }
}

/**
 * Manages cat coding webview panels
 */
class EditorPanel {
  /**
   * Track the currently panel. Only allow a single panel to exist at a time.
   */
  public static currentPanel: EditorPanel | undefined

  public static readonly viewType = 'markdown-editor'

  private _disposables: vscode.Disposable[] = []

  public static async createOrShow(
    context: vscode.ExtensionContext,
    uri?: vscode.Uri
  ) {
    const { extensionUri } = context
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined
    if (EditorPanel.currentPanel && uri !== EditorPanel.currentPanel?._uri) {
      EditorPanel.currentPanel.dispose()
    }
    // If we already have a panel, show it.
    if (EditorPanel.currentPanel) {
      EditorPanel.currentPanel._panel.reveal(column)
      return
    }
    if (!vscode.window.activeTextEditor && !uri) {
      showError(`Did not open markdown file!`)
      return
    }
    let doc: undefined | vscode.TextDocument
    // from context menu : 从当前打开的 textEditor 中寻找 是否有当前 markdown 的 editor, 有的话则绑定 document
    if (uri) {
      // 从右键打开文件，先打开文档然后开启自动同步，不然没法保存文件和同步到已经打开的document
      doc = await vscode.workspace.openTextDocument(uri)
    } else {
      doc = vscode.window.activeTextEditor?.document
      // from command mode
      if (doc && doc.languageId !== 'markdown') {
        showError(
          `Current file language is not markdown, got ${doc.languageId}`
        )
        return
      }
    }

    if (!doc) {
      showError(`Cannot find markdown file!`)
      return
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      EditorPanel.viewType,
      'markdown-editor',
      column || vscode.ViewColumn.One,
      EditorPanel.getWebviewOptions(uri, extensionUri)
    )

    EditorPanel.currentPanel = new EditorPanel(
      context,
      panel,
      extensionUri,
      doc,
      uri
    )
  }

  static getWebviewOptions(
    uri?: vscode.Uri,
    extensionUri?: vscode.Uri
  ): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    const localResourceRoots: vscode.Uri[] = []

    // Add extension resources
    if (extensionUri) {
      localResourceRoots.push(extensionUri)
    }

    // Only allow access to workspace folders
    if (uri) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)
      if (workspaceFolder) {
        localResourceRoots.push(workspaceFolder.uri)
      }
    }

    // Add all workspace folders
    if (vscode.workspace.workspaceFolders) {
      localResourceRoots.push(
        ...vscode.workspace.workspaceFolders.map((folder) => folder.uri)
      )
    }

    return {
      // Enable javascript in the webview
      enableScripts: true,
      localResourceRoots,
      retainContextWhenHidden: true,
      enableCommandUris: true,
    }
  }
  private get _fsPath() {
    return this._uri.fsPath
  }

  static get config() {
    return vscode.workspace.getConfiguration('markdown-editor')
  }

  public constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    public _document: vscode.TextDocument, // 当前有 markdown 编辑器
    public _uri = _document.uri // 从资源管理器打开，只有 uri 没有 _document
  ) {
    // Set webview options for custom editor
    const options = EditorPanel.getWebviewOptions(this._uri, this._extensionUri)
    this._panel.webview.options = options

    // Set the webview's initial html content
    this._init()

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)
    let textEditTimer: NodeJS.Timeout | void
    // close EditorPanel when vsc editor is close
    vscode.workspace.onDidCloseTextDocument((e) => {
      if (e.fileName === this._fsPath) {
        this.dispose()
      }
    }, this._disposables)
    // update EditorPanel when vsc editor changes
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.fileName !== this._document.fileName) {
        return
      }
      // 当 webview panel 激活时不将由 webview编辑导致的 vsc 编辑器更新同步回 webview
      // don't change webview panel when webview panel is focus
      if (this._panel.active) {
        return
      }
      textEditTimer && clearTimeout(textEditTimer)
      textEditTimer = setTimeout(() => {
        this._update()
        this._updateEditTitle()
      }, 300)
    }, this._disposables)
    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        debug('msg from webview review', message, this._panel.active)

        const syncToEditor = async () => {
          debug('sync to editor', this._document, this._uri)
          if (this._document) {
            const edit = new vscode.WorkspaceEdit()
            edit.replace(
              this._document.uri,
              new vscode.Range(0, 0, this._document.lineCount, 0),
              message.content
            )
            await vscode.workspace.applyEdit(edit)
          } else if (this._uri) {
            await vscode.workspace.fs.writeFile(this._uri, message.content)
          } else {
            showError(`Cannot find original file to save!`)
          }
        }
        switch (message.command) {
          case 'ready':
            this._update({
              type: 'init',
              options: {
                useVscodeThemeColor: EditorPanel.config.get<boolean>(
                  'useVscodeThemeColor'
                ),
                ...this._context.globalState.get(KeyVditorOptions),
              },
              theme:
                vscode.window.activeColorTheme.kind ===
                vscode.ColorThemeKind.Dark
                  ? 'dark'
                  : 'light',
            })
            break
          case 'save-options':
            this._context.globalState.update(KeyVditorOptions, message.options)
            break
          case 'info':
            vscode.window.showInformationMessage(message.content)
            break
          case 'error':
            showError(message.content)
            break
          case 'edit': {
            // 只有当 webview 处于编辑状态时才同步到 vsc 编辑器，避免重复刷新
            if (this._panel.active) {
              await syncToEditor()
              this._updateEditTitle()
            }
            break
          }
          case 'reset-config': {
            await this._context.globalState.update(KeyVditorOptions, {})
            break
          }
          case 'save': {
            await syncToEditor()
            await this._document.save()
            this._updateEditTitle()
            break
          }
          case 'upload': {
            const assetsFolder = EditorPanel.getAssetsFolder(this._uri)

            // Validate that assets folder is within workspace
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(this._uri)
            if (!workspaceFolder) {
              showError('Cannot upload files: No workspace folder found')
              break
            }

            if (!isPathWithinDirectory(assetsFolder, workspaceFolder.uri.fsPath)) {
              showError(`Invalid image folder: Path is outside workspace`)
              break
            }

            try {
              await vscode.workspace.fs.createDirectory(
                vscode.Uri.file(assetsFolder)
              )
            } catch (error) {
              console.error(error)
              showError(`Invalid image folder: ${assetsFolder}`)
              break
            }

            const uploadedFiles: string[] = []

            for (const f of message.files) {
              // Sanitize filename to prevent path traversal
              const sanitizedName = sanitizeFilename(f.name)
              if (!sanitizedName) {
                showError(`Invalid filename: ${f.name}`)
                continue
              }

              const targetPath = NodePath.join(assetsFolder, sanitizedName)

              // Double-check the final path is still within workspace
              if (!isPathWithinDirectory(targetPath, workspaceFolder.uri.fsPath)) {
                showError(`Invalid file path: ${sanitizedName}`)
                continue
              }

              try {
                const content = Buffer.from(f.base64, 'base64')
                await vscode.workspace.fs.writeFile(
                  vscode.Uri.file(targetPath),
                  content
                )
                uploadedFiles.push(sanitizedName)
              } catch (error) {
                console.error(error)
                showError(`Failed to upload file: ${sanitizedName}`)
              }
            }

            const files = uploadedFiles.map((filename) =>
              NodePath.relative(
                NodePath.dirname(this._fsPath),
                NodePath.join(assetsFolder, filename)
              ).replace(/\\/g, '/')
            )
            this._panel.webview.postMessage({
              command: 'uploaded',
              files,
            })
            break
          }
          case 'open-link': {
            let url = message.href
            // Case-insensitive check for http/https protocols
            if (!/^https?:\/\//i.test(url)) {
              // For local paths, validate they are within workspace
              const resolvedPath = NodePath.resolve(this._fsPath, '..', url)
              const workspaceFolder = vscode.workspace.getWorkspaceFolder(this._uri)

              if (workspaceFolder && !isPathWithinDirectory(resolvedPath, workspaceFolder.uri.fsPath)) {
                showError(`Cannot open file outside workspace: ${url}`)
                break
              }

              url = resolvedPath
            }
            vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(url))
            break
          }
        }
      },
      null,
      this._disposables
    )
  }

  static getAssetsFolder(uri: vscode.Uri) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)
    const imageSaveFolder = (
      EditorPanel.config.get<string>('imageSaveFolder') || 'assets'
    )
      .replace(
        '${projectRoot}',
        workspaceFolder?.uri.fsPath || ''
      )
      .replace('${file}', uri.fsPath)
      .replace(
        '${fileBasenameNoExtension}',
        NodePath.basename(uri.fsPath, NodePath.extname(uri.fsPath))
      )
      .replace('${dir}', NodePath.dirname(uri.fsPath))

    const assetsFolder = NodePath.resolve(
      NodePath.dirname(uri.fsPath),
      imageSaveFolder
    )

    // Validate that the resolved path is within workspace
    // If not within workspace, fall back to 'assets' folder next to the markdown file
    if (workspaceFolder && !isPathWithinDirectory(assetsFolder, workspaceFolder.uri.fsPath)) {
      debug(`Warning: Configured image folder '${imageSaveFolder}' is outside workspace. Using default 'assets' folder.`)
      return NodePath.resolve(NodePath.dirname(uri.fsPath), 'assets')
    }

    return assetsFolder
  }

  public dispose() {
    EditorPanel.currentPanel = undefined

    // Clean up our resources
    this._panel.dispose()

    while (this._disposables.length) {
      const x = this._disposables.pop()
      if (x) {
        x.dispose()
      }
    }
  }

  private _init() {
    const webview = this._panel.webview

    this._panel.webview.html = this._getHtmlForWebview(webview)
    this._panel.title = NodePath.basename(this._fsPath)
  }
  private _isEdit = false
  private _updateEditTitle() {
    const isEdit = this._document.isDirty
    if (isEdit !== this._isEdit) {
      this._isEdit = isEdit
      this._panel.title = `${isEdit ? `[edit]` : ''}${NodePath.basename(
        this._fsPath
      )}`
    }
  }

  // private fileToWebviewUri = (f: string) => {
  //   return this._panel.webview.asWebviewUri(vscode.Uri.file(f)).toString()
  // }

  private async _update(
    props: {
      type?: 'init' | 'update'
      options?: any
      theme?: 'dark' | 'light'
    } = { options: void 0 }
  ) {
    const md = this._document
      ? this._document.getText()
      : (await vscode.workspace.fs.readFile(this._uri)).toString()
    // const dir = NodePath.dirname(this._document.fileName)
    this._panel.webview.postMessage({
      command: 'update',
      content: md,
      ...props,
    })
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const toUri = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, f))
    const baseHref =
      NodePath.dirname(
        webview.asWebviewUri(vscode.Uri.file(this._fsPath)).toString()
      ) + '/'
    const toMediaPath = (f: string) => `media/dist/${f}`
    const JsFiles = ['main.js'].map(toMediaPath).map(toUri)
    const CssFiles = ['main.css'].map(toMediaPath).map(toUri)

    return (
      `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<base href="${baseHref}" />


				${CssFiles.map((f) => `<link href="${f}" rel="stylesheet">`).join('\n')}

				<title>markdown editor</title>
        <style>` +
      sanitizeCSS(EditorPanel.config.get<string>('customCss') || '') +
      `</style>
			</head>
			<body>
				<div id="app"></div>


				${JsFiles.map((f) => `<script src="${f}"></script>`).join('\n')}
			</body>
			</html>`
    )
  }
}
