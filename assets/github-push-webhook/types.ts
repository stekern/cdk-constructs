import * as octokitWebhooksTypes from "@octokit/webhooks-types"

export type DbPushEvent = {
  PK: string
  SK: string
  schemaVersion: string
  branch: string
  isDefaultBranch: boolean
  payload: octokitWebhooksTypes.PushEvent
}

export type ForwardingRule = {
  owner: string
  repo: string
  channel: string
}
