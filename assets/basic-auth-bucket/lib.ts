import { timingSafeEqual } from "crypto"

export const getBase64EncodedCredentialsFromHeader = (header: string) => {
  const [authScheme, base64Payload, ...rest] = header.split(" ")
  if (authScheme.toLowerCase() === "basic") {
    return base64Payload
  }
  return null
}

/**
 * Compare two strings without leaking timing information.
 */
const timingSafeStringComparison = (a: string, b: string) => {
  try {
    const buffers = {
      a: Buffer.from(a, "utf8"),
      b: Buffer.from(b, "utf8"),
    }
    if (a.length !== b.length) {
      timingSafeEqual(buffers.a, buffers.a)
      return false
    }
    return timingSafeEqual(buffers.a, buffers.b)
  } catch {
    return false
  }
}

export const verifyBasicAuthCredentials = (
  username: string,
  password: string,
  base64EncodedCredentials: string,
) => {
  if (!username || !password || !base64EncodedCredentials) {
    return false
  }
  const authScheme = "basic"
  const clientAuthHeader = `${authScheme} ${base64EncodedCredentials}`
  const allowedAuthHeader =
    `${authScheme} ` + Buffer.from(`${username}:${password}`).toString("base64")
  return timingSafeStringComparison(allowedAuthHeader, clientAuthHeader)
}

/**
 * Utility function for validating existence and type of
 * JSON primitive types in an object.
 */
export const validate = (
  /**
   * The object to validate against a schema.
   */
  obj: unknown,
  /**
   * The schema to use.
   */
  schema: { [key: string]: "String" | "Number" | "Boolean" | "Null" },
) => {
  if (obj && !Array.isArray(obj) && typeof obj === "object") {
    return Object.entries(schema).every(([key, val]) => {
      return (
        key in obj &&
        Object.prototype.toString.call(obj[key as keyof unknown]) ===
          `[object ${val}]`
      )
    })
  }
  return false
}

export const getParsedSecretString = (secret: unknown) => {
  let parsed
  try {
    parsed = secret ? (JSON.parse(secret as string) as unknown) : null
  } catch {
    return null
  }
  if (
    !validate(parsed, {
      username: "String",
      password: "String",
    })
  ) {
    return null
  }
  return parsed as {
    username: string
    password: string
  }
}
