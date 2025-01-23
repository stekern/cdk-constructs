import { describe, expect, test } from "@jest/globals"
import { pushEvent, rule } from "./mocks"
import { createSlackPayload } from "./slack-forwarder"

test("slack payload snapshot", () => {
  const payload = createSlackPayload(rule, pushEvent)
  expect(payload).toMatchSnapshot()
})
