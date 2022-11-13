import { expect, it } from "vitest"
import { createSlackPayload } from "./slack-forwarder"
import { pushEvent, rule } from "./mocks"

it("slack payload snapshot", () => {
  const payload = createSlackPayload(rule, pushEvent)
  expect(payload).toMatchSnapshot()
})
