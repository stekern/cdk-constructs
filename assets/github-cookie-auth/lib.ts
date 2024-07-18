import { createSign, randomFillSync, timingSafeEqual } from "crypto"
import * as https from "https"
import { ServiceException } from "@smithy/smithy-client"

export const getUrlWithEncodedQueryParams = (
  url: string,
  queryParams: { [key: string]: string },
) => {
  const encodedQueryParams = Object.entries(queryParams)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("&")
  return `${url}${encodedQueryParams ? "?" + encodedQueryParams : ""}`
}

export const getCookieValue = (cookieHeader: string, cookieName: string) =>
  `; ${cookieHeader}`.split(`; ${cookieName}=`).pop()!.split(";")[0] ||
  undefined

export const generateRandomString = (n: number, allowedCharacters: string) => {
  return Array.from(randomFillSync(new Uint32Array(n)))
    .map(
      (randomNumber) =>
        allowedCharacters[randomNumber % allowedCharacters.length],
    )
    .join("")
}

export const httpRequest = (
  params: https.RequestOptions,
  payload?: string,
): Promise<Record<string, unknown> | Record<string, unknown>[] | undefined> => {
  return new Promise(function (resolve, reject) {
    const req = https.request(params, function (res) {
      if (res.statusCode! < 200 || res.statusCode! >= 300) {
        return reject(
          new Error(`Received non - 200 status code ${res.statusCode!} `),
        )
      }
      let body = ""
      res.on("data", function (chunk) {
        body += chunk
      })
      res.on("end", function () {
        let result
        try {
          result = JSON.parse(body) as Record<string, string>
        } catch (e) {
          reject(new Error("Failed to deserialize response as JSON"))
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

export const timingSafeStringComparison = (a: string, b: string) => {
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
  } catch {
    // Catch errors that may arise from trying to create buffer
    // from non-strings
    return false
  }
}

/**
 * Return a signed JSON Web Token (JWT) using the RS256 algorithm
 */
export const sign = (
  /**
   * The payload to sign
   */
  payload: Record<string, unknown>,
  /**
   * An RSA private key to use when signing
   */
  secretKey: string,
) => {
  const encodedHeader = Buffer.from(
    JSON.stringify({ typ: "JWT", alg: "RS256" }),
  ).toString("base64url")
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  )
  const sig = createSign("RSA-SHA256")
  sig.write(`${encodedHeader}.${encodedPayload}`)
  sig.end()
  const signature = sig.sign(secretKey, "base64url")
  const jwt = `${encodedHeader}.${encodedPayload}.${signature}`
  return jwt
}

/**
 * Check if an error is an AWS error or not
 */
export const isAWSError = (arg: unknown): arg is ServiceException => {
  return (
    arg !== null &&
    typeof arg === "object" &&
    typeof (arg as Record<string, unknown>).code === "string" &&
    typeof (arg as Record<string, unknown>).message === "string"
  )
}
