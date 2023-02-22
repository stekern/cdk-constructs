import { createSlackPayload } from "./slack-forwarder"
import { pushEvent, rule } from "./mocks"

test("slack payload snapshot", () => {
  const payload = createSlackPayload(rule, pushEvent)
  expect(payload).toMatchSnapshot()
})
