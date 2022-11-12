import { DbPushEvent, ForwardingRule } from "./types"
import { URL } from "url"
import * as https from "https"
import { DynamoDBStreamEvent } from "aws-lambda"
import DynamoDB from "aws-sdk/clients/dynamodb"

type SlackPayload = {
  channel?: string
  icon_emoji: string
  username: string
  text: string
  blocks: {
    type: string
    text?: {
      type: string
      text: string
    }
    fields?: {
      type: string
      text: string
    }[]
    elements?: {
      type: string
      text: string
    }[]
  }[]
  attachments?: {
    footer?: string
    text: string
    mrkdwn_in?: string[]
  }[]
}

const httpRequest = (
  params: https.RequestOptions,
  payload?: string,
  parseJson?: boolean,
): Promise<Record<string, unknown> | string | undefined> => {
  return new Promise(function (resolve, reject) {
    const req = https.request(params, function (res) {
      if (res.statusCode! < 200 || res.statusCode! >= 300) {
        return reject(
          new Error(`Received non-200 status code ${res.statusCode!}`),
        )
      }
      let body = ""
      res.on("data", function (chunk) {
        body += chunk
      })
      res.on("end", function () {
        let result
        if (parseJson) {
          try {
            result = JSON.parse(body) as Record<string, unknown>
          } catch (e) {
            reject(new Error("Failed to deserialize response as JSON"))
          }
        }
        resolve(result)
      })
    })
    req.on("error", function (err) {
      reject(err)
    })
    if (payload) {
      req.write(payload)
    }
    req.end()
  })
}

const createSlackPayload = (
  rule: ForwardingRule,
  pushEvent: DbPushEvent,
): SlackPayload => {
  return {
    channel: rule.channel,
    icon_emoji: ":twisted_rightwards_arrows:",
    username: "GitHub Integration",
    text: `Commit(s) pushed to repository ${pushEvent.payload.repository.full_name}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<${pushEvent.payload.compare}|${
            pushEvent.payload.commits.length
          } new commit${
            pushEvent.payload.commits.length > 1 ? "s" : ""
          }> pushed to <${pushEvent.payload.repository.html_url}/tree/${
            pushEvent.branch
          }|\`${pushEvent.branch}\`> by <${
            pushEvent.payload.sender.html_url
          }|\`${pushEvent.payload.sender.login}\`>`,
        },
      },
    ],
    attachments: [
      {
        footer: `<${pushEvent.payload.repository.html_url}|${pushEvent.payload.repository.full_name}>`,
        mrkdwn_in: ["text"],
        text: pushEvent.payload.commits
          .map(
            (commit) =>
              `<${commit.url}|\`${commit.id.substring(0, 8)}\`> - ${
                // Split at newline to avoid showing potentially long commit description
                commit.message.split(/\n/)[0]
              }`,
          )
          .join("\n"),
      },
    ],
  }
}

export const handler = async (event: DynamoDBStreamEvent) => {
  console.log(JSON.stringify(event, null, 2))
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL
    ? new URL(process.env.SLACK_WEBHOOK_URL)
    : undefined
  const forwardingRules = (
    process.env.FORWARDING_RULES ? JSON.parse(process.env.FORWARDING_RULES) : []
  ) as ForwardingRule[]

  if (!slackWebhookUrl) {
    throw Error("Missing required environment variable")
  }
  if (forwardingRules.length === 0) {
    console.log("No Slack forwarding rules set up")
  }
  const pushEvents = event.Records.filter((r) => r.dynamodb?.NewImage).map(
    (r) => DynamoDB.Converter.unmarshall(r.dynamodb!.NewImage!) as DbPushEvent,
  )
  const payloads = forwardingRules.flatMap((forwardingRule) => {
    const matchingPushEvents = pushEvents.filter(
      (e) =>
        e.payload.repository.full_name ===
        `${forwardingRule.owner}/${forwardingRule.repo}`,
    )
    return matchingPushEvents.map((pushEvent) =>
      createSlackPayload(forwardingRule, pushEvent),
    )
  })
  const options: https.RequestOptions = {
    hostname: slackWebhookUrl.hostname,
    port: slackWebhookUrl.port,
    path: slackWebhookUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  }
  await Promise.all(
    payloads.map((p) => httpRequest(options, JSON.stringify(p))),
  )
}
