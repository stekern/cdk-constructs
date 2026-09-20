import { describe, expect, test } from "@jest/globals"
import type * as lambdaTypes from "aws-lambda"
import { InMemoryCache, InMemorySecretStore } from "./adapters"
import { AuthorizeRequest } from "./core"
import { makeHandler } from "./index"
import { getBase64EncodedCredentialsFromHeader, validate } from "./lib"

describe("integration tests", () => {
  test("correct credentials should succeed", async () => {
    const secret = {
      username: "hello",
      password: "world",
    }
    const cache = new InMemoryCache()
    const secretStore = new InMemorySecretStore(JSON.stringify(secret))
    const manager = new AuthorizeRequest(secretStore, cache)
    const res = await manager.handle({
      authorizationHeader: `Basic ${Buffer.from(`${secret.username}:${secret.password}`).toString("base64")}`,
    })
    expect(res).toEqual(true)
  })
  test("cache should be updated", async () => {
    const secret = {
      username: "hello",
      password: "world",
    }
    const cache = new InMemoryCache()
    const secretStore = new InMemorySecretStore(JSON.stringify(secret))
    const manager = new AuthorizeRequest(secretStore, cache)
    const _res = await manager.handle({
      authorizationHeader: `Basic ${Buffer.from(`${secret.username}:${secret.password}`).toString("base64")}`,
    })
    const cachedSecret = cache.get("credentials")
    expect(cachedSecret).toEqual(JSON.stringify(secret))
  })
  test("invalid credentials should fail", async () => {
    const secret = {
      username: "hello",
      password: "world",
    }
    const cache = new InMemoryCache()
    const secretStore = new InMemorySecretStore(JSON.stringify(secret))
    const manager = new AuthorizeRequest(secretStore, cache)
    const res = await manager.handle({
      authorizationHeader: `Basic ${Buffer.from(
        `${secret.username}1:${secret.password}`,
      ).toString("base64")}`,
    })
    expect(res).toEqual(false)
  })
  test("invalid secret should fail", async () => {
    const secret = {
      username: "hello",
      password: "world",
    }
    const cache = new InMemoryCache()
    const secretStore = new InMemorySecretStore()
    const manager = new AuthorizeRequest(secretStore, cache)
    const res = await manager.handle({
      authorizationHeader: `Basic ${Buffer.from(
        `${secret.username}1:${secret.password}`,
      ).toString("base64")}`,
    })
    expect(res).toEqual(false)
  })

  test("handler uses the injected secret store", async () => {
    const secret = { username: "hello", password: "world" }
    const request = {
      clientIp: "127.0.0.1",
      headers: {
        authorization: [
          {
            key: "Authorization",
            value: `Basic ${Buffer.from(`${secret.username}:${secret.password}`).toString("base64")}`,
          },
        ],
      },
      method: "GET",
      querystring: "",
      uri: "/",
    }
    const handler = makeHandler(new InMemorySecretStore(JSON.stringify(secret)))

    const response = await handler(
      {
        Records: [{ cf: { request } }],
      } as unknown as lambdaTypes.CloudFrontRequestEvent,
      {} as lambdaTypes.Context,
      () => undefined,
    )

    expect(response).toEqual(request)
  })
})

describe("test utility for runtime object validation", () => {
  test("validation should succeed", () => {
    const validated = validate(
      {
        username: "hello",
        password: "world",
      },
      { username: "String", password: "String" },
    )
    expect(validated).toEqual(true)
  })
  test("validation should fail for wrong type", () => {
    const validated = validate({ hello: 123 }, { hello: "String" })
    expect(validated).toEqual(false)
  })
})

describe("test basic auth header value extraction", () => {
  test("should handle different cases for auth scheme", () => {
    const username = "hello"
    const password = "world"
    const encodedCredentials = Buffer.from(`${username}:${password}`).toString(
      "base64",
    )
    expect(
      getBase64EncodedCredentialsFromHeader(`basic ${encodedCredentials}`),
    ).toEqual(encodedCredentials)
    expect(
      getBase64EncodedCredentialsFromHeader(`Basic ${encodedCredentials}`),
    ).toEqual(encodedCredentials)
    expect(
      getBase64EncodedCredentialsFromHeader(`BaSiC ${encodedCredentials}`),
    ).toEqual(encodedCredentials)
  })
  test("should fail to get credentials from invalid header", () => {
    expect(getBase64EncodedCredentialsFromHeader("hello world")).toBeNull()
  })
})
