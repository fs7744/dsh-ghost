/** 由 harness-contract/gen-remotes.mjs 生成，勿手改。 */
/* eslint-disable */

export interface RemoteMap {
  "account/cancelSignIn": { args: { "attemptId": unknown }; value: unknown }
  "account/getBalance": { args: { "client": unknown }; value: unknown }
  "account/getNotificationContent": { args: { "id": unknown; "client": unknown }; value: unknown }
  "account/getNotifications": { args: { "client": unknown }; value: unknown }
  "account/getProfile": { args: { "client": unknown }; value: unknown }
  "account/getState": { args: {  }; value: unknown }
  "account/hasRunningAccountTasks": { args: {  }; value: unknown }
  "account/reportNotificationEvent": { args: { "id": unknown; "event": unknown; "client": unknown }; value: unknown }
  "account/signOut": { args: { "client": unknown }; value: unknown }
  "account/startSignIn": { args: { "client": unknown; "callbackOrigin": unknown; "loginSource": unknown }; value: unknown }
  "account/watch": { args: {  }; value: unknown }
  "account/watchExpiry": { args: {  }; value: unknown }
  "actionCards/act": { args: { "agentId": unknown; "callId": unknown; "verb": unknown; "payload": unknown }; value: unknown }
  "agentPresets/list": { args: {  }; value: unknown }
  "agentPresets/read": { args: { "agentPreset": unknown }; value: unknown }
  "agentPresets/select": { args: { "agentId": unknown; "agentPreset": unknown }; value: unknown }
  "agentTeams/setEnabled": { args: { "agentId": unknown; "enabled": unknown }; value: unknown }
  "commands/execute": { args: { "agentId": unknown; "line": unknown; "submittedAttachments": unknown }; value: unknown }
  "commands/list": { args: { "agentId": unknown }; value: unknown }
  "cotTranslation/limits": { args: {  }; value: unknown }
  "cotTranslation/translate": { args: { "request": unknown }; value: unknown }
  "credentials/describe": { args: { "refs": unknown }; value: unknown }
  "credentials/set": { args: { "ref": unknown; "value": unknown }; value: unknown }
  "credentials/unset": { args: { "ref": unknown }; value: unknown }
  "cuaAccess/applicationIcons": { args: {  }; value: unknown }
  "cuaAccess/applications": { args: {  }; value: unknown }
  "cuaAccess/enablePersistentPtc": { args: {  }; value: unknown }
  "cuaAccess/openSettings": { args: { "permission": unknown; "locale": unknown }; value: unknown }
  "cuaAccess/ptcConfiguration": { args: {  }; value: unknown }
  "cuaAccess/requestPermission": { args: { "permission": unknown; "locale": unknown }; value: unknown }
  "cuaAccess/retryApproval": { args: { "id": unknown }; value: unknown }
  "cuaAccess/revoke": { args: { "id": unknown }; value: unknown }
  "cuaAccess/systemStatus": { args: {  }; value: unknown }
  "deepseekChatImport/limits": { args: {  }; value: unknown }
  "directoryPicker/createDirectory": { args: { "path": unknown; "name": unknown }; value: unknown }
  "directoryPicker/list": { args: { "path": unknown }; value: unknown }
  "directoryPicker/pick": { args: {  }; value: unknown }
  "dynamicCordisRunner/getClientCode": { args: { "agentId": unknown; "pluginId": unknown; "pluginRunId": unknown }; value: unknown }
  "dynamicCordisRunner/inventory": { args: {  }; value: unknown }
  "dynamicCordisRunner/invoke": { args: { "pluginId": unknown; "pluginRunId": unknown; "method": unknown; "args": unknown }; value: unknown }
  "dynamicCordisRunner/reportClientGuardFailure": { args: { "agentId": unknown; "pluginId": unknown; "pluginRunId": unknown; "failure": unknown }; value: unknown }
  "dynamicCordisRunner/reportRenderFailure": { args: { "agentId": unknown; "pluginId": unknown; "pluginRunId": unknown; "failure": unknown }; value: unknown }
  "dynamicCordisRunner/resolveInspectQuery": { args: { "agentId": unknown; "requestId": unknown; "resolution": unknown }; value: unknown }
  "dynamicCordisRunner/resolveRequestRun": { args: { "requestId": unknown; "resolution": unknown }; value: unknown }
  "dynamicCordisRunner/runHostHalf": { args: { "agentId": unknown; "pluginId": unknown; "packageId": unknown; "mode": unknown; "requestId": unknown; "approveFutureVersions": unknown }; value: unknown }
  "dynamicCordisRunner/settleUserRun": { args: { "agentId": unknown; "pluginId": unknown; "resolution": unknown }; value: unknown }
  "dynamicCordisRunner/stopFromPanel": { args: { "agentId": unknown; "pluginId": unknown }; value: unknown }
  "dynamicCordisRunner/syncInspectManifest": { args: { "providers": unknown }; value: unknown }
  "dynamicCordisRunner/undefineFromPanel": { args: { "agentId": unknown; "pluginId": unknown }; value: unknown }
  "fileReferences/list": { args: { "agentId": unknown; "query": unknown }; value: unknown }
  "fileUploads/upload": { args: { "agentId": unknown; "request": unknown }; value: unknown }
  "forgePanel/branches": { args: { "sessionId": unknown }; value: unknown }
  "forgePanel/cancelWorktree": { args: { "sessionId": unknown }; value: unknown }
  "forgePanel/changeRequestChecks": { args: { "sessionId": unknown; "url": unknown; "headSha": unknown }; value: unknown }
  "forgePanel/changeRequestCommits": { args: { "sessionId": unknown; "url": unknown }; value: unknown }
  "forgePanel/changeRequestDiff": { args: { "sessionId": unknown; "url": unknown; "commits": unknown }; value: unknown }
  "forgePanel/changeRequestReview": { args: { "sessionId": unknown; "url": unknown; "headSha": unknown; "fresh": unknown }; value: unknown }
  "forgePanel/changeRequestReviewWrite": { args: { "sessionId": unknown; "url": unknown; "write": unknown }; value: unknown }
  "forgePanel/changeRequestStates": { args: {  }; value: unknown }
  "forgePanel/changeRequestText": { args: { "sessionId": unknown; "url": unknown; "commit": unknown; "path": unknown }; value: unknown }
  "forgePanel/changeRequestViewed": { args: { "sessionId": unknown; "url": unknown; "headSha": unknown }; value: unknown }
  "forgePanel/continueInProject": { args: { "sessionId": unknown }; value: unknown }
  "forgePanel/diffBases": { args: { "sessionId": unknown; "query": unknown }; value: unknown }
  "forgePanel/dismiss": { args: { "sessionId": unknown; "url": unknown }; value: unknown }
  "forgePanel/follow": { args: { "sessionId": unknown }; value: unknown }
  "forgePanel/localCommits": { args: { "sessionId": unknown; "base": unknown }; value: unknown }
  "forgePanel/localDiff": { args: { "sessionId": unknown; "scope": unknown }; value: unknown }
  "forgePanel/localText": { args: { "sessionId": unknown; "scope": unknown; "path": unknown }; value: unknown }
  "forgePanel/markReady": { args: { "sessionId": unknown; "url": unknown }; value: unknown }
  "forgePanel/merge": { args: { "sessionId": unknown; "url": unknown; "method": unknown; "headSha": unknown }; value: unknown }
  "forgePanel/refresh": { args: { "sessionId": unknown }; value: unknown }
  "forgePanel/requestReviews": { args: { "sessionId": unknown; "url": unknown; "reviewers": unknown }; value: unknown }
  "forgePanel/requestWorktree": { args: { "sessionId": unknown; "from": unknown }; value: unknown }
  "forgePanel/rerunChecks": { args: { "sessionId": unknown; "url": unknown; "request": unknown }; value: unknown }
  "forgePanel/restoreWorktree": { args: { "sessionId": unknown }; value: unknown }
  "forgePanel/retryWorktree": { args: { "sessionId": unknown }; value: unknown }
  "forgePanel/reviewerCandidates": { args: { "sessionId": unknown; "url": unknown; "query": unknown }; value: unknown }
  "forgePanel/setFileViewed": { args: { "sessionId": unknown; "url": unknown; "request": unknown }; value: unknown }
  "forgePanel/stopCreation": { args: { "sessionId": unknown }; value: unknown }
  "forgePanel/submitReview": { args: { "sessionId": unknown; "url": unknown; "request": unknown }; value: unknown }
  "forgePanel/track": { args: { "sessionId": unknown; "url": unknown }; value: unknown }
  "forgePanel/updateBranch": { args: { "sessionId": unknown; "url": unknown; "method": unknown; "headSha": unknown }; value: unknown }
  "forgePanel/worktreeCleanup": { args: { "sessionId": unknown; "revision": unknown }; value: unknown }
  "goals/clear": { args: { "agentId": unknown; "ref": unknown }; value: unknown }
  "goals/complete": { args: { "agentId": unknown; "ref": unknown }; value: unknown }
  "goals/create": { args: { "agentId": unknown; "request": unknown }; value: unknown }
  "goals/edit": { args: { "agentId": unknown; "ref": unknown; "request": unknown }; value: unknown }
  "goals/get": { args: { "agentId": unknown }; value: unknown }
  "goals/pause": { args: { "agentId": unknown; "ref": unknown }; value: unknown }
  "goals/resume": { args: { "agentId": unknown; "ref": unknown }; value: unknown }
  "job/follow": { args: { "request": unknown }; value: unknown }
  "job/kill": { args: { "request": unknown }; value: unknown }
  "job/list": { args: { "request": unknown }; value: unknown }
  "liveshareShares/addSessions": { args: { "request": unknown }; value: unknown }
  "liveshareShares/audit": { args: { "request": unknown }; value: unknown }
  "liveshareShares/capabilities": { args: {  }; value: unknown }
  "liveshareShares/create": { args: { "request": unknown }; value: unknown }
  "liveshareShares/identity": { args: { "request": unknown }; value: unknown }
  "liveshareShares/list": { args: {  }; value: unknown }
  "liveshareShares/relay": { args: {  }; value: unknown }
  "liveshareShares/setCapabilities": { args: { "request": unknown }; value: unknown }
  "liveshareShares/setRelay": { args: { "request": unknown }; value: unknown }
  "liveshareShares/stop": { args: { "request": unknown }; value: unknown }
  "liveshareShares/testPublish": { args: { "request": unknown }; value: unknown }
  "liveshareShares/testRelay": { args: {  }; value: unknown }
  "liveshareShares/updatePermissions": { args: { "request": unknown }; value: unknown }
  "llm/discoverModels": { args: { "settingsNs": unknown; "request": unknown }; value: unknown }
  "llm/listConfigurableProviders": { args: {  }; value: unknown }
  "llm/listProviders": { args: {  }; value: unknown }
  "mcpManager/probe": { args: { "name": unknown }; value: unknown }
  "mcpManager/restart": { args: { "name": unknown }; value: unknown }
  "mcpManager/watch": { args: {  }; value: unknown }
  "messageFeedback/delete": { args: { "request": unknown }; value: unknown }
  "messageFeedback/list": { args: { "request": unknown }; value: unknown }
  "messageFeedback/put": { args: { "request": unknown }; value: unknown }
  "officeKit/generation": { args: {  }; value: unknown }
  "officeKit/render": { args: { "workspaceFileScopeId": unknown; "path": unknown; "priority": unknown }; value: unknown }
  "permissionPresets/catalog": { args: {  }; value: unknown }
  "pluginInventory/list": { args: {  }; value: unknown }
  "pluginManager/cancelInstall": { args: { "requestId": unknown }; value: unknown }
  "pluginManager/inspect": { args: { "spec": unknown; "options": unknown }; value: unknown }
  "pluginManager/installBundle": { args: { "spec": unknown; "options": unknown }; value: unknown }
  "pluginManager/listBundles": { args: {  }; value: unknown }
  "pluginManager/listPlugins": { args: {  }; value: unknown }
  "pluginManager/listVersionExemptions": { args: {  }; value: unknown }
  "pluginManager/listVersions": { args: { "name": unknown; "options": unknown }; value: unknown }
  "pluginManager/readBundleDetail": { args: { "name": unknown; "language": unknown; "options": unknown }; value: unknown }
  "pluginManager/registries": { args: {  }; value: unknown }
  "pluginManager/removeBundle": { args: { "name": unknown }; value: unknown }
  "pluginManager/setBundleEnabled": { args: { "name": unknown; "enabled": unknown }; value: unknown }
  "pluginManager/setPluginEnabled": { args: { "id": unknown; "enabled": unknown }; value: unknown }
  "pluginManager/setVersionExemption": { args: { "packageVersion": unknown; "runtimeVersion": unknown; "enabled": unknown; "acceptRisk": unknown }; value: unknown }
  "pluginManager/updateBundle": { args: { "name": unknown; "version": unknown; "options": unknown }; value: unknown }
  "pluginManager/waitForInstall": { args: { "requestId": unknown }; value: unknown }
  "pluginMarket/listIndexes": { args: {  }; value: unknown }
  "pluginMarket/readEntryDetail": { args: { "url": unknown; "name": unknown; "version": unknown; "language": unknown; "options": unknown }; value: unknown }
  "pluginMarket/search": { args: { "url": unknown; "query": unknown }; value: unknown }
  "pluginMarket/setIndexes": { args: { "urls": unknown }; value: unknown }
  "pluginRecommendations/describe": { args: { "agentId": unknown; "callId": unknown }; value: unknown }
  "pluginRegistryProbe/fastest": { args: {  }; value: unknown }
  "productAnalytics/enabled": { args: {  }; value: unknown }
  "productAnalytics/report": { args: { "event": unknown }; value: unknown }
  "productAnalytics/watchPolicy": { args: {  }; value: unknown }
  "remoteAccess/follow": { args: {  }; value: unknown }
  "schedule/catalog": { args: {  }; value: unknown }
  "schedule/create": { args: { "request": unknown }; value: unknown }
  "schedule/deleteInactive": { args: {  }; value: unknown }
  "schedule/deliveryLimits": { args: {  }; value: unknown }
  "schedule/edit": { args: { "request": unknown }; value: unknown }
  "schedule/history": { args: { "request": unknown }; value: unknown }
  "schedule/list": { args: { "request": unknown }; value: unknown }
  "schedule/run": { args: { "request": unknown }; value: unknown }
  "schedule/view": { args: { "request": unknown }; value: unknown }
  "session/attachment": { args: { "request": unknown }; value: unknown }
  "session/canOpenWorkspacePath": { args: {  }; value: unknown }
  "session/cancel": { args: { "request": unknown }; value: unknown }
  "session/control": { args: {  }; value: unknown }
  "session/create": { args: { "request": unknown }; value: unknown }
  "session/events": { args: { "request": unknown }; value: unknown }
  "session/follow": { args: { "request": unknown }; value: unknown }
  "session/fork": { args: { "request": unknown }; value: unknown }
  "session/initializeDefaultModel": { args: {  }; value: unknown }
  "session/list": { args: { "_request": unknown }; value: unknown }
  "session/modelCatalog": { args: {  }; value: unknown }
  "session/observeEvent": { args: { "request": unknown }; value: unknown }
  "session/observeProjections": { args: { "request": unknown }; value: unknown }
  "session/observeState": { args: { "request": unknown }; value: unknown }
  "session/openWorkspacePath": { args: { "request": unknown }; value: unknown }
  "session/page": { args: { "request": unknown }; value: unknown }
  "session/projections": { args: { "request": unknown }; value: unknown }
  "session/prompt": { args: { "request": unknown }; value: unknown }
  "session/rename": { args: { "request": unknown }; value: unknown }
  "session/search": { args: { "request": unknown }; value: unknown }
  "session/selectModel": { args: { "request": unknown }; value: unknown }
  "session/state": { args: { "request": unknown }; value: unknown }
  "session/updateQueue": { args: { "request": unknown }; value: unknown }
  "session/wait": { args: { "request": unknown }; value: unknown }
  "session/workspacePathApplications": { args: { "request": unknown }; value: unknown }
  "sessionFeedback/record": { args: { "request": unknown }; value: unknown }
  "sessionReferenceResolver/candidates": { args: { "agentId": unknown; "query": unknown }; value: unknown }
  "settings/describe": { args: {  }; value: unknown }
  "settings/mutate": { args: { "ns": unknown; "ops": unknown; "expectedRevision": unknown }; value: unknown }
  "settings/openSettingsDocument": { args: {  }; value: unknown }
  "settings/replace": { args: { "ns": unknown; "section": unknown; "expectedRevision": unknown }; value: unknown }
  "settings/update": { args: { "ns": unknown; "patch": unknown; "expectedRevision": unknown }; value: unknown }
  "skills/list": { args: { "request": unknown }; value: unknown }
  "speech/cancelPreparation": { args: { "providerId": unknown }; value: unknown }
  "speech/catalog": { args: {  }; value: unknown }
  "speech/configure": { args: { "patch": unknown }; value: unknown }
  "speech/follow": { args: {  }; value: unknown }
  "speech/prepare": { args: { "providerId": unknown; "options": unknown }; value: unknown }
  "speech/transcribe": { args: { "request": unknown }; value: unknown }
  "subagents/interruptByUser": { args: { "childSessionId": unknown }; value: unknown }
  "subagents/prompt": { args: { "request": unknown }; value: unknown }
  "terminal/attach": { args: { "agentId": unknown; "id": unknown }; value: unknown }
  "terminal/close": { args: { "agentId": unknown; "id": unknown }; value: unknown }
  "terminal/create": { args: { "agentId": unknown; "request": unknown }; value: unknown }
  "terminal/environment": { args: { "agentId": unknown }; value: unknown }
  "terminal/list": { args: { "sessionId": unknown }; value: unknown }
  "terminal/rename": { args: { "agentId": unknown; "id": unknown; "title": unknown }; value: unknown }
  "terminal/retain": { args: { "sessionId": unknown; "id": unknown }; value: unknown }
  "terminal/shells": { args: { "agentId": unknown }; value: unknown }
  "terminal/watch": { args: { "sessionId": unknown }; value: unknown }
  "toolResults/watch": { args: { "request": unknown }; value: unknown }
  "userQuestions/answer": { args: { "agentId": unknown; "callId": unknown; "answer": unknown }; value: unknown }
  "userQuestions/attachWait": { args: { "agentId": unknown; "callId": unknown }; value: unknown }
  "web/listProviders": { args: {  }; value: unknown }
  "workspace/archiveSession": { args: { "request": unknown }; value: unknown }
  "workspace/create": { args: { "request": unknown }; value: unknown }
  "workspace/delete": { args: { "request": unknown }; value: unknown }
  "workspace/follow": { args: {  }; value: unknown }
  "workspace/initializeDefault": { args: {  }; value: unknown }
  "workspace/insertBefore": { args: { "request": unknown }; value: unknown }
  "workspace/insertSessionBefore": { args: { "request": unknown }; value: unknown }
  "workspace/pinSession": { args: { "request": unknown }; value: unknown }
  "workspace/rename": { args: { "request": unknown }; value: unknown }
  "workspace/unarchiveSession": { args: { "request": unknown }; value: unknown }
  "workspace/unpinSession": { args: { "request": unknown }; value: unknown }
  "workspaceFiles/changes": { args: { "workspaceFileScopeId": unknown; "path": unknown }; value: unknown }
  "workspaceFiles/list": { args: { "workspaceFileScopeId": unknown; "path": unknown }; value: unknown }
  "workspaceFiles/read": { args: { "workspaceFileScopeId": unknown; "path": unknown; "range": unknown }; value: unknown }
  "workspaceFiles/readBytes": { args: { "workspaceFileScopeId": unknown; "path": unknown; "options": unknown }; value: unknown }
  "workspaceFiles/search": { args: { "workspaceFileScopeId": unknown; "request": unknown }; value: unknown }
  "workspaceFiles/stat": { args: { "workspaceFileScopeId": unknown; "path": unknown }; value: unknown }
}

export type RemoteEndpoint = keyof RemoteMap
