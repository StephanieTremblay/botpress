import { runtime } from '@botpress/runtime'
import * as sdk from 'botpress/sdk'
import { container } from 'core/app/inversify/app.inversify'
import { TYPES } from 'core/app/types'
import { BotService } from 'core/bots'
import { GhostService } from 'core/bpfs'
import { CMSService, renderRecursive, RenderService } from 'core/cms'
import * as renderEnums from 'core/cms/enums'
import { ConfigProvider } from 'core/config'
import Database from 'core/database'
import { WellKnownFlags } from 'core/dialog'
import * as dialogEnums from 'core/dialog/enums'
import { SessionIdFactory } from 'core/dialog/sessions'
import { JobService } from 'core/distributed'
import { EventEngine, Event } from 'core/events'
import { KeyValueStore } from 'core/kvs'
import { LoggerProvider } from 'core/logger'
import * as logEnums from 'core/logger/enums'
import { MediaServiceProvider } from 'core/media'
import { ModuleLoader } from 'core/modules'
import { RealtimeService, RealTimePayload } from 'core/realtime'
import { getMessageSignature } from 'core/security'
import { HookService } from 'core/user-code'
import { WorkspaceService } from 'core/users'
import { inject, injectable } from 'inversify'
import Knex from 'knex'
import _ from 'lodash'
import { Memoize } from 'lodash-decorators'

import { HTTPServer } from './server'

const http = (httpServer: HTTPServer) => (identity: string): typeof sdk.http => {
  return {
    createShortLink(name: string, destination: string, params?: any): void {
      httpServer.createShortLink(name, destination, params)
    },
    deleteShortLink(name: string): void {
      httpServer.deleteShortLink(name)
    },
    createRouterForBot(routerName: string, options?: sdk.RouterOptions): any & sdk.http.RouterExtension {
      const defaultRouterOptions = { checkAuthentication: true, enableJsonBodyParser: true }
      return httpServer.createRouterForBot(routerName, identity, options || defaultRouterOptions)
    },
    deleteRouterForBot: httpServer.deleteRouterForBot.bind(httpServer),
    getAxiosConfigForBot: httpServer.getAxiosConfigForBot.bind(httpServer),
    extractExternalToken: httpServer.extractExternalToken.bind(httpServer),
    decodeExternalToken: httpServer.decodeExternalToken.bind(httpServer),
    needPermission: httpServer.needPermission.bind(httpServer),
    hasPermission: httpServer.hasPermission.bind(httpServer)
  }
}

const event = (eventEngine: EventEngine): typeof sdk.events => {
  return {
    registerMiddleware: eventEngine.register.bind(eventEngine),
    removeMiddleware: eventEngine.removeMiddleware.bind(eventEngine),
    sendEvent: eventEngine.sendEvent.bind(eventEngine),
    replyToEvent: (eventDestination: sdk.IO.EventDestination, payloads: any[], incomingEventId?: string) =>
      runtime.events.replyToEvent(eventDestination, payloads, incomingEventId),
    isIncomingQueueEmpty: (event: sdk.IO.IncomingEvent) => runtime.events.isIncomingQueueEmpty(event),
    findEvents: (fields: Partial<sdk.IO.StoredEvent>, searchParams?: sdk.EventSearchParams) =>
      runtime.events.findEvents(fields, searchParams),
    updateEvent: (id: string, fields: Partial<sdk.IO.StoredEvent>) => runtime.events.updateEvent(id, fields),
    saveUserFeedback: (incomingEventId: string, target: string, feedback: number, type?: string) =>
      runtime.events.saveUserFeedback(incomingEventId, target, feedback, type)
  }
}

const dialog = (): typeof sdk.dialog => {
  return {
    createId: SessionIdFactory.createIdFromEvent.bind(SessionIdFactory),
    deleteSession: (sessionId: string, botId: string) => runtime.dialog.deleteSession(sessionId, botId),
    processEvent: (sessionId: string, event: sdk.IO.IncomingEvent) => runtime.dialog.processEvent(sessionId, event),
    jumpTo: (sessionId: string, event: sdk.IO.IncomingEvent, flowName: string, nodeName?: string) =>
      runtime.dialog.jumpTo(sessionId, event, flowName, nodeName)
  }
}

const config = (moduleLoader: ModuleLoader, configProvider: ConfigProvider): typeof sdk.config => {
  return {
    getModuleConfig: moduleLoader.configReader.getGlobal.bind(moduleLoader.configReader),
    getModuleConfigForBot: moduleLoader.configReader.getForBot.bind(moduleLoader.configReader),
    getBotpressConfig: configProvider.getBotpressConfig.bind(configProvider),
    mergeBotConfig: configProvider.mergeBotConfig.bind(configProvider)
  }
}

const bots = (botService: BotService): typeof sdk.bots => {
  return {
    getAllBots: botService.getBots.bind(botService),
    getBotById: botService.findBotById.bind(botService),
    exportBot: botService.exportBot.bind(botService),
    importBot: botService.importBot.bind(botService),
    listBotRevisions: botService.listRevisions.bind(botService),
    createBotRevision: botService.createRevision.bind(botService),
    rollbackBotToRevision: botService.rollback.bind(botService)
  }
}

const users = (): typeof sdk.users => {
  return {
    getOrCreateUser: (channel: string, userId: string, botId?: string) =>
      runtime.users.getOrCreateUser(channel, userId, botId),
    updateAttributes: (channel: string, userId: string, attributes: string) =>
      runtime.users.updateAttributes(channel, userId, attributes),
    getAttributes: (channel: string, userId: string) => runtime.users.getAttributes(channel, userId),
    setAttributes: (channel: string, userId: string, attributes: string) =>
      runtime.users.setAttributes(channel, userId, attributes),
    getAllUsers: (paging?: sdk.Paging) => runtime.users.getAllUsers(paging),
    getUserCount: () => runtime.users.getUserCount()
  }
}

const kvs = (kvs: KeyValueStore): typeof sdk.kvs => {
  return {
    forBot: kvs.forBot.bind(kvs),
    global: kvs.global.bind(kvs),
    get: kvs.get.bind(kvs),
    set: kvs.set.bind(kvs),
    getStorageWithExpiry: kvs.getStorageWithExpiry.bind(kvs),
    setStorageWithExpiry: kvs.setStorageWithExpiry.bind(kvs),
    removeStorageKeysStartingWith: kvs.removeStorageKeysStartingWith.bind(kvs),
    getConversationStorageKey: kvs.getConversationStorageKey.bind(kvs),
    getUserStorageKey: kvs.getUserStorageKey.bind(kvs),
    getGlobalStorageKey: kvs.getGlobalStorageKey.bind(kvs)
  }
}

const security = (): typeof sdk.security => {
  return {
    getMessageSignature
  }
}

const ghost = (ghostService: GhostService): typeof sdk.ghost => {
  return {
    forBot: ghostService.forBot.bind(ghostService),
    forBots: ghostService.bots.bind(ghostService),
    forGlobal: ghostService.global.bind(ghostService),
    forRoot: ghostService.root.bind(ghostService)
  }
}

const cms = (cmsService: CMSService, mediaServiceProvider: MediaServiceProvider): typeof sdk.cms => {
  return {
    getContentElement: cmsService.getContentElement.bind(cmsService),
    getContentElements: cmsService.getContentElements.bind(cmsService),
    listContentElements: cmsService.listContentElements.bind(cmsService),
    deleteContentElements: cmsService.deleteContentElements.bind(cmsService),
    getAllContentTypes(botId: string): Promise<any[]> {
      return cmsService.getAllContentTypes(botId)
    },
    renderElement(contentId: string, args: any, eventDestination: sdk.IO.EventDestination): Promise<any> {
      return cmsService.renderElement(contentId, args, eventDestination)
    },
    createOrUpdateContentElement: cmsService.createOrUpdateContentElement.bind(cmsService),
    async saveFile(botId: string, fileName: string, content: Buffer): Promise<string> {
      return mediaServiceProvider
        .forBot(botId)
        .saveFile(fileName, content)
        .then(({ fileName }) => fileName)
    },
    async readFile(botId, fileName): Promise<Buffer> {
      return mediaServiceProvider.forBot(botId).readFile(fileName)
    },
    getFilePath(botId: string, fileName: string): string {
      return mediaServiceProvider.forBot(botId).getPublicURL(fileName)
    },
    renderTemplate(templateItem: sdk.cms.TemplateItem, context): sdk.cms.TemplateItem {
      return renderRecursive(templateItem, context)
    }
  }
}

const workspaces = (workspaceService: WorkspaceService): typeof sdk.workspaces => {
  return {
    getBotWorkspaceId: workspaceService.getBotWorkspaceId.bind(workspaceService),
    getWorkspaceRollout: workspaceService.getWorkspaceRollout.bind(workspaceService),
    addUserToWorkspace: workspaceService.addUserToWorkspace.bind(workspaceService),
    consumeInviteCode: workspaceService.consumeInviteCode.bind(workspaceService),
    getWorkspaceUsers: workspaceService.getWorkspaceUsers.bind(workspaceService)
  }
}

const distributed = (jobService: JobService): typeof sdk.distributed => {
  return {
    broadcast: jobService.broadcast.bind(jobService),
    acquireLock: jobService.acquireLock.bind(jobService),
    clearLock: jobService.clearLock.bind(jobService)
  }
}

const experimental = (hookService: HookService, renderService: RenderService): typeof sdk.experimental => {
  return {
    disableHook: hookService.disableHook.bind(hookService),
    enableHook: hookService.enableHook.bind(hookService),
    render: render(renderService)
  }
}

const render = (renderService: RenderService): typeof sdk.experimental.render => {
  return {
    text: renderService.renderText.bind(renderService),
    image: renderService.renderImage.bind(renderService),
    audio: renderService.renderAudio.bind(renderService),
    video: renderService.renderVideo.bind(renderService),
    location: renderService.renderLocation.bind(renderService),
    card: renderService.renderCard.bind(renderService),
    carousel: renderService.renderCarousel.bind(renderService),
    choice: renderService.renderChoice.bind(renderService),
    buttonSay: renderService.renderButtonSay.bind(renderService),
    buttonUrl: renderService.renderButtonUrl.bind(renderService),
    buttonPostback: renderService.renderButtonPostback.bind(renderService),
    option: renderService.renderOption.bind(renderService),
    translate: renderService.renderTranslated.bind(renderService),
    template: renderService.renderTemplate.bind(renderService),
    pipeline: renderService.getPipeline.bind(renderService)
  }
}

/**
 * Socket.IO API to emit payloads to front-end clients
 */
const realtime = (realtimeService: RealtimeService): typeof sdk.realtime => ({
  sendPayload: realtimeService.sendToSocket.bind(realtimeService),
  getVisitorIdFromGuestSocketId: realtimeService.getVisitorIdFromSocketId.bind(realtimeService)
})

@injectable()
export class BotpressAPIProvider {
  http: (owner: string) => typeof sdk.http
  events: typeof sdk.events
  dialog: typeof sdk.dialog
  config: typeof sdk.config
  realtime: typeof sdk.realtime
  database: Knex & sdk.KnexExtension
  users: typeof sdk.users
  kvs: typeof sdk.kvs
  bots: typeof sdk.bots
  ghost: typeof sdk.ghost
  cms: typeof sdk.cms
  experimental: typeof sdk.experimental
  security: typeof sdk.security
  workspaces: typeof sdk.workspaces
  distributed: typeof sdk.distributed

  constructor(
    @inject(TYPES.Database) db: Database,
    @inject(TYPES.EventEngine) eventEngine: EventEngine,
    @inject(TYPES.ModuleLoader) moduleLoader: ModuleLoader,
    @inject(TYPES.LoggerProvider) private loggerProvider: LoggerProvider,
    @inject(TYPES.HTTPServer) httpServer: HTTPServer,
    @inject(TYPES.RealtimeService) realtimeService: RealtimeService,
    @inject(TYPES.KeyValueStore) keyValueStore: KeyValueStore,
    @inject(TYPES.BotService) botService: BotService,
    @inject(TYPES.GhostService) ghostService: GhostService,
    @inject(TYPES.CMSService) cmsService: CMSService,
    @inject(TYPES.ConfigProvider) configProvider: ConfigProvider,
    @inject(TYPES.MediaServiceProvider) mediaServiceProvider: MediaServiceProvider,
    @inject(TYPES.HookService) hookService: HookService,
    @inject(TYPES.WorkspaceService) workspaceService: WorkspaceService,
    @inject(TYPES.JobService) jobService: JobService,
    @inject(TYPES.RenderService) renderService: RenderService
  ) {
    this.http = http(httpServer)
    this.events = event(eventEngine)
    this.dialog = dialog()
    this.config = config(moduleLoader, configProvider)
    this.realtime = realtime(realtimeService)
    this.database = db.knex
    this.users = users()
    this.kvs = kvs(keyValueStore)
    this.bots = bots(botService)
    this.ghost = ghost(ghostService)
    this.cms = cms(cmsService, mediaServiceProvider)
    this.experimental = experimental(hookService, renderService)
    this.security = security()
    this.workspaces = workspaces(workspaceService)
    this.distributed = distributed(jobService)
  }

  @Memoize()
  async create(loggerName: string, owner: string): Promise<typeof sdk> {
    return {
      version: '',
      RealTimePayload,
      LoggerLevel: logEnums.LoggerLevel,
      LogLevel: logEnums.LogLevel,
      NodeActionType: dialogEnums.NodeActionType,
      IO: {
        Event,
        WellKnownFlags
      },
      dialog: this.dialog,
      events: this.events,
      http: this.http(owner),
      logger: await this.loggerProvider(loggerName),
      config: this.config,
      database: this.database,
      users: this.users,
      realtime: this.realtime,
      kvs: this.kvs,
      ghost: this.ghost,
      bots: this.bots,
      cms: this.cms,
      security: this.security,
      experimental: this.experimental,
      workspaces: this.workspaces,
      distributed: this.distributed,
      ButtonAction: renderEnums.ButtonAction
    }
  }
}

export function createForModule(moduleId: string): Promise<typeof sdk> {
  // return Promise.resolve(<typeof sdk>{})
  return container.get<BotpressAPIProvider>(TYPES.BotpressAPIProvider).create(`Mod[${moduleId}]`, `module.${moduleId}`)
}

export function createForGlobalHooks(): Promise<typeof sdk> {
  // return Promise.resolve(<typeof sdk>{})
  return container.get<BotpressAPIProvider>(TYPES.BotpressAPIProvider).create('Hooks', 'hooks')
}

export function createForBotpress(): Promise<typeof sdk> {
  return container.get<BotpressAPIProvider>(TYPES.BotpressAPIProvider).create('Botpress', 'botpress')
}

export function createForAction(): Promise<typeof sdk> {
  return container.get<BotpressAPIProvider>(TYPES.BotpressAPIProvider).create('Actions', 'actions')
}
