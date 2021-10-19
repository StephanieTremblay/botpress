import { confirmDialog, lang, toast } from 'botpress/shared'
import { action, observable, runInAction } from 'mobx'
import path from 'path'

import { EditableFile, FilePermissions, FilesDS, FileType } from '../../../backend/typings'
import { KeyPosition, ActionPositionType, FileFilters, KeyStates } from '../typings'
import { FILENAME_REGEX } from '../utils'
import { baseHook, httpAction, legacyAction } from '../utils/templates'

import CodeEditorApi from './api'
import { EditorStore } from './editor'

/** Includes the partial definitions of all classes */
export type StoreDef = Partial<RootStore> & Partial<FilePermissions> & Partial<EditorStore>

interface DuplicateOption {
  forCurrentBot?: boolean
  keepSameName?: boolean
}

class RootStore {
  public api: CodeEditorApi
  public editor: EditorStore

  @observable
  public permissions: FilePermissions

  public typings: { [fileName: string]: string } = {}

  @observable
  public files: FilesDS

  @observable
  public filters: FileFilters

  @observable
  public fileFilter: string

  @observable
  public keyStates: KeyStates

  constructor({ bp }) {
    this.api = new CodeEditorApi(bp.axios)
    this.editor = new EditorStore(this)
    // Object required for the observer to be useful.
    this.filters = {
      filename: ''
    }
    this.keyStates = {
      action: KeyPosition.UP,
      shift: KeyPosition.UP
    }
  }

  @action.bound
  async initialize(): Promise<void> {
    try {
      await this.fetchPermissions()
      await this.fetchFiles()
      await this.fetchTypings()
    } catch (err) {
      console.error('Error while fetching data', err)
    }
  }

  @action.bound
  async fetchPermissions() {
    const permissions = await this.api.fetchPermissions()
    runInAction('-> setEditorConfig', () => {
      this.permissions = permissions
    })
  }

  @action.bound
  async fetchFiles() {
    const files = await this.api.fetchFiles(this.editor.isAdvanced)
    runInAction('-> setFiles', () => {
      this.files = files
    })
  }

  @action.bound
  async fetchTypings() {
    const typings = await this.api.fetchTypings()
    runInAction('-> setTypings', () => {
      this.typings = typings
    })

    return this.typings
  }

  @action.bound
  setFiles(messages: FilesDS) {
    this.files = messages
  }

  @action.bound
  setFilenameFilter(filter: string) {
    this.filters.filename = filter
  }

  @action.bound
  async createFilePrompt(type: FileType, isGlobal?: boolean, hookType?: string) {
    let name = window.prompt(lang.tr('module.code-editor.store.chooseName', { type }))
    if (!name) {
      return
    }

    if (!FILENAME_REGEX.test(name)) {
      alert(lang.tr('module.code-editor.store.invalidFilename'))
      return
    }

    name = name.endsWith('.js') ? name : name + '.js'

    let content
    switch (type) {
      case 'action_legacy':
        content = legacyAction
        break
      case 'action_http':
        content = httpAction
        break
      default:
        content = baseHook
        break
    }

    await this.editor.openFile({
      name,
      location: name,
      content,
      type,
      hookType,
      botId: isGlobal ? undefined : window.BOT_ID
    })
  }

  @action.bound
  createNewAction() {
    // This is called by the code editor & the shortcut, so it's the default create
    return this.createFilePrompt('action_http', false)
  }

  @action.bound
  updateKeyActionState(key: 'action' | 'shift', actionState: ActionPositionType) {
    this.keyStates[key] = actionState
  }

  @action.bound
  async deleteFile(file: EditableFile): Promise<void> {
    if (
      await confirmDialog(lang.tr('module.code-editor.store.confirmDeleteFile', { file: file.name }), {
        acceptLabel: lang.tr('delete')
      })
    ) {
      if (await this.api.deleteFile(file)) {
        this.editor.closeFile(file)
        toast.success(lang.tr('module.code-editor.store.fileDeleted'))
        await this.fetchFiles()
      }
    }
  }

  @action.bound
  async disableFile(file: EditableFile): Promise<void> {
    const newName = file.name.charAt(0) !== '.' ? '.' + file.name : file.name
    if (await this.api.renameFile(file, newName)) {
      this.editor.closeFile(file)
      toast.success(lang.tr('module.code-editor.store.fileDisabled'))
      await this.fetchFiles()
    }
  }

  @action.bound
  async enableFile(file: EditableFile): Promise<void> {
    const newName = file.name.charAt(0) === '.' ? file.name.substr(1) : file.name

    if (await this.api.renameFile(file, newName)) {
      this.editor.closeFile(file)
      toast.success(lang.tr('module.code-editor.store.fileEnabled'))
      await this.fetchFiles()
    }
  }

  @action.bound
  async renameFile(file: EditableFile, newName: string) {
    if (await this.api.renameFile(file, newName)) {
      toast.success(lang.tr('module.code-editor.store.fileRenamed'))
      await this.fetchFiles()
    }
  }

  getOriginalFolderName(folderName: string): string {
    return folderName === 'Data' ? '/' : folderName
  }

  @action.bound
  async bulkCutPasteFiles(files: EditableFile[], folderName: string) {
    folderName = this.getOriginalFolderName(folderName)
    const promises = files.map(file => this.api.renameFile(file, `${folderName}/${file.name}`))

    try {
      await Promise.all(promises)
    } catch (err) {
      console.error('Error while renaming files', err)
      toast.failure(lang.tr('module.code-editor.store.fileMovedError'))
    }

    toast.success('Succes: Update message!')
    await this.fetchFiles()
  }

  @action.bound
  async bulkCopyPasteFiles(files: EditableFile[], folderName: string) {
    folderName = this.getOriginalFolderName(folderName)

    const promises = files.map(async (file: EditableFile) => {
      const fileLocation = `${folderName}/${file.name}`
      const fileExt = path.extname(fileLocation)

      const duplicate = {
        ...file,
        content: file.content || (await this.api.readFile(file)),
        location: fileLocation.replace(fileExt, '_copy' + fileExt)
      }

      return this.api.saveFile(duplicate)
    })

    try {
      await Promise.all(promises)
    } catch (err) {
      console.error('Bulk copy error: ', err)
      toast.failure(lang.tr('module.code-editor.store.fileMovedError'))

      await this.fetchFiles()
      return
    }

    toast.success('Succes: Update message!')
    await this.fetchFiles()
  }

  @action.bound
  async duplicateFile(file: EditableFile, { keepSameName, forCurrentBot }: DuplicateOption = {}) {
    const fileExt = path.extname(file.location)

    const duplicate = {
      ...file,
      content: file.content || (await this.api.readFile(file)),
      location: keepSameName ? file.location : file.location.replace(fileExt, '_copy' + fileExt)
    }

    if (forCurrentBot) {
      duplicate.botId = window.BOT_ID
    }

    if (await this.api.fileExists(duplicate)) {
      toast.failure(lang.tr('module.code-editor.store.alreadyExists'))
      return
    }

    if (await this.api.saveFile(duplicate)) {
      toast.success(lang.tr('module.code-editor.store.fileDuplicated'))
      await this.fetchFiles()
    }
  }

  @action.bound
  async uploadFile(data: FormData) {
    if (await this.api.uploadFile(data)) {
      toast.success(lang.tr('module.code-editor.store.fileUploaded'))
      await this.fetchFiles()
    }
  }
}

export { RootStore }
