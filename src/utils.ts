import * as fs from "node:fs"
import * as path from "node:path"

type JsonPrimitive = string | number | boolean | null
type JsonArray = JsonValue[]
type JsonObject = { [key: string]: JsonValue }
type JsonValue = JsonPrimitive | JsonArray | JsonObject

/** Symbol returned by transform functions to completely remove a property */
export const DISCARD = Symbol("DISCARD")
enum ReplacementValue {
  DEFAULT = "<snapshot-value>",
  SHA_256 = "<snapshot-sha256>",
}

interface TransformationContext {
  path: string[]
  fileName: string
  parent?: JsonValue
  root: JsonValue
}

/** Transformation rule for sanitizing JSON content */
export interface Rule {
  /** Human-readable description of what this rule does */
  description: string
  /** Dot-separated pattern to match (supports * and ** wildcards) */
  key: string
  /** Transform function - return DISCARD to remove, undefined for no change */
  transform: (
    value: JsonValue,
    ctx: TransformationContext,
  ) => JsonValue | typeof DISCARD | undefined
}

const defaultRules: Rule[] = [
  {
    description: "Replace hash in Lambda code with placeholder",
    key: "Resources.*.Properties.Code.S3Key",
    transform: (value, ctx) => {
      const resourceName = ctx.path[1]
      const resource = ((ctx.root as JsonObject)?.Resources as JsonObject)?.[
        resourceName
      ] as JsonObject

      if (
        resource?.Type === "AWS::Lambda::Function" &&
        typeof value === "string" &&
        /[a-fA-F0-9]{64}/.test(value)
      ) {
        return value.replace(/[a-fA-F0-9]{64}/, ReplacementValue.SHA_256)
      }
    },
  },
  {
    description: "Remove CDK warning stack traces from manifest",
    key: "artifacts.*.metadata.*.*.trace",
    transform: (_, ctx) => {
      const parent = ctx.parent as JsonObject
      if (
        ctx.fileName === "manifest.json" &&
        parent?.type === "aws:cdk:warning"
      ) {
        return DISCARD
      }
    },
  },
  {
    description: "Replace manifest template URL hashes with placeholder",
    key: "artifacts.*.properties.stackTemplateAssetObjectUrl",
    transform: (value, ctx) => {
      if (
        ctx.fileName === "manifest.json" &&
        typeof value === "string" &&
        /[a-fA-F0-9]{64}/.test(value)
      ) {
        return value.replace(/[a-fA-F0-9]{64}/, ReplacementValue.SHA_256)
      }
    },
  },
  {
    description: "Replace CDK asset paths with placeholder",
    key: "**.aws:asset:path",
    transform: () => ReplacementValue.DEFAULT,
  },
  {
    description: "Remove CDK analytics metadata in template",
    key: "Resources.*.Properties.Analytics",
    transform: (_, ctx) => {
      const resourceName = ctx.path[1]
      const resource = ((ctx.root as JsonObject)?.Resources as JsonObject)?.[
        resourceName
      ] as JsonObject
      if (resource?.Type === "AWS::CDK::Metadata") {
        return ReplacementValue.DEFAULT
      }
    },
  },
]

/**
 * Checks if a dot-separated pattern matches a path array.
 * Supports * wildcard and ** recursive matching.
 */
export function matchesPattern(pattern: string, path: string[]): boolean {
  const patternParts = pattern.split(".")

  if (pattern.startsWith("**")) {
    // ** matches any depth - just check the last part
    return path[path.length - 1] === patternParts[patternParts.length - 1]
  }

  if (patternParts.length !== path.length) {
    return false
  }

  return patternParts.every((part, i) => part === "*" || part === path[i])
}

/**
 * Applies transformation rules to JSON content recursively.
 * Multiple matching rules are chained together.
 */
export function sanitize(
  content: JsonValue,
  fileName: string,
  rules: Rule[],
): JsonValue {
  function visit(
    value: JsonValue,
    path: string[],
    parent?: JsonValue,
  ): JsonValue | undefined {
    const ctx: TransformationContext = { path, fileName, parent, root: content }

    // Apply matching rules - chain multiple transformations
    for (const rule of rules) {
      if (matchesPattern(rule.key, path)) {
        const result = rule.transform(value, ctx)
        if (result === DISCARD) return
        if (result !== undefined) {
          // biome-ignore lint:
          value = result
        }
      }
    }

    // Recurse
    if (Array.isArray(value)) {
      return value
        .map((item, i) => visit(item, [...path, i.toString()], value))
        .filter((x) => x !== undefined)
    }

    if (typeof value === "object" && value !== null) {
      const result: Record<string, JsonValue> = {}
      for (const [key, val] of Object.entries(value)) {
        const processed = visit(val, [...path, key], value)
        if (processed !== undefined) result[key] = processed
      }
      return result
    }

    return value
  }

  // We return an empty object if everything is discarded
  return visit(content, []) || {}
}

/**
 * Sanitizes CDK cloud assembly by applying transformation rules to JSON files.
 * Recursively processes directories, skipping asset folders.
 */
export function sanitizeCloudAssembly(
  sourceDir: string,
  targetDir: string,
  rules = defaultRules,
): void {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory '${sourceDir}' does not exist`)
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const directoryContents = fs.readdirSync(sourceDir, { withFileTypes: true })
  for (const entry of directoryContents) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)

    if (entry.isDirectory() && shouldProcessDirectory(entry.name)) {
      // Recursively process subdirectories, skip asset directories
      sanitizeCloudAssembly(sourcePath, targetPath)
    } else if (entry.isFile() && shouldProcessFile(entry.name)) {
      // Process JSON files
      const content = JSON.parse(fs.readFileSync(sourcePath, "utf-8"))
      const sanitized = sanitize(content, entry.name, rules)
      fs.writeFileSync(targetPath, JSON.stringify(sanitized, null, 2))
    }
  }
}

/** Returns true if file should be processed (manifest.json, *.template.json, etc.) */
export function shouldProcessFile(fileName: string): boolean {
  return (
    fileName === "manifest.json" ||
    fileName.endsWith(".template.json") ||
    fileName.endsWith(".template.json.config.json")
  )
}

/** Returns true if directory should be processed (skips asset.* and .cache dirs) */
export function shouldProcessDirectory(directoryName: string): boolean {
  return (
    !directoryName.match(/^asset\.[a-fA-F0-9]{64}$/) &&
    directoryName !== ".cache"
  )
}
