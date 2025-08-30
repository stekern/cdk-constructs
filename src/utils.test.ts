import { describe, expect, it } from "@jest/globals"
import {
  matchesPattern,
  sanitize,
  DISCARD,
  shouldProcessFile,
  shouldProcessDirectory,
  Rule,
  sanitizeCloudAssembly,
} from "./utils"

describe("utils pattern matching", () => {
  describe("matchesPattern", () => {
    it("matches exact patterns", () => {
      expect(matchesPattern("a.b.c", ["a", "b", "c"])).toBe(true)
      expect(matchesPattern("a.b.c", ["a", "b", "d"])).toBe(false)
      expect(matchesPattern("a.b.c", ["a", "b"])).toBe(false)
    })

    it("matches wildcard patterns", () => {
      expect(matchesPattern("a.*.c", ["a", "anything", "c"])).toBe(true)
      expect(matchesPattern("*.b.c", ["anything", "b", "c"])).toBe(true)
      expect(matchesPattern("a.*.c", ["a", "b", "d"])).toBe(false)
    })

    it("matches patterns with dots in keys", () => {
      expect(matchesPattern("a.*", ["a", "b.c"])).toBe(true)
      expect(
        matchesPattern("Resources.*", ["Resources", "My.Lambda.Function"]),
      ).toBe(true)
    })

    it("matches recursive patterns", () => {
      expect(matchesPattern("**.trace", ["a", "b", "c", "trace"])).toBe(true)
      expect(matchesPattern("**.trace", ["trace"])).toBe(true)
      expect(matchesPattern("**.trace", ["a", "trace"])).toBe(true)
      expect(matchesPattern("**.trace", ["a", "b", "notrace"])).toBe(false)
    })
  })

  describe("sanitize function", () => {
    it("applies simple transformations", () => {
      const rules: Rule[] = [
        {
          description: "test rule",
          key: "a.b",
          transform: () => "replaced",
        },
      ]

      const input = { a: { b: "original" } }
      const result = sanitize(input, "test.json", rules)

      // @ts-expect-error
      expect(result.a.b).toBe("replaced")
    })

    it("discards values with DISCARD symbol", () => {
      const rules: Rule[] = [
        {
          description: "discard rule",
          key: "a.remove",
          transform: () => DISCARD,
        },
      ]

      const input = { a: { keep: "value", remove: "unwanted" } }
      const result = sanitize(input, "test.json", rules)

      // @ts-expect-error
      expect(result.a.keep).toBe("value")
      // @ts-expect-error
      expect(result.a).not.toHaveProperty("remove")
    })

    it("chains multiple matching rules", () => {
      const rules: Rule[] = [
        {
          description: "first rule",
          key: "a.*",
          transform: (v) => `${v}-first`,
        },
        {
          description: "second rule",
          key: "a.b",
          transform: (v) => `${v}-second`,
        },
      ]

      const input = { a: { b: "original" } }
      const result = sanitize(input, "test.json", rules)

      // @ts-expect-error
      expect(result.a.b).toBe("original-first-second")
    })

    it("handles nested objects", () => {
      const rules: Rule[] = [
        {
          description: "nested rule",
          key: "level1.level2.target",
          transform: () => "found",
        },
      ]

      const input = {
        level1: {
          level2: {
            target: "original",
            other: "unchanged",
          },
        },
      }

      const result = sanitize(input, "test.json", rules)

      // @ts-expect-error
      expect(result.level1.level2.target).toBe("found")
      // @ts-expect-error
      expect(result.level1.level2.other).toBe("unchanged")
    })

    it("handles arrays", () => {
      const rules: Rule[] = [
        {
          description: "array rule",
          key: "items.*.value",
          transform: () => "transformed",
        },
      ]

      const input = {
        items: [
          { value: "a", other: "keep1" },
          { value: "b", other: "keep2" },
        ],
      }

      const result = sanitize(input, "test.json", rules)

      // @ts-expect-error
      expect(result.items[0].value).toBe("transformed")
      // @ts-expect-error
      expect(result.items[1].value).toBe("transformed")
      // @ts-expect-error
      expect(result.items[0].other).toBe("keep1")
      // @ts-expect-error
      expect(result.items[1].other).toBe("keep2")
    })

    it("provides context to transform functions", () => {
      const rules: Rule[] = [
        {
          description: "context rule",
          key: "Resources.*.Properties",
          transform: (_, ctx) => {
            return `processed-${ctx.path[1]}`
          },
        },
      ]

      const input = {
        Resources: {
          MyResource: {
            Properties: { original: "value" },
          },
        },
      }

      const result = sanitize(input, "test.json", rules)

      // @ts-expect-error
      expect(result.Resources.MyResource.Properties).toBe(
        "processed-MyResource",
      )
    })

    it("handles recursive patterns", () => {
      const rules = [
        {
          description: "recursive rule",
          key: "**.target",
          transform: () => "found-deep",
        },
      ]

      const input = {
        level1: {
          level2: {
            level3: {
              target: "deep-value",
            },
          },
        },
        target: "shallow-value",
      }

      const result = sanitize(input, "test.json", rules)

      // @ts-expect-error
      expect(result.level1.level2.level3.target).toBe("found-deep")
      // @ts-expect-error
      expect(result.target).toBe("found-deep")
    })

    it("returns empty object when everything is discarded", () => {
      const rules: Rule[] = [
        {
          description: "discard all",
          key: "*",
          transform: () => DISCARD,
        },
      ]

      const input = { a: "value", b: "another" }
      const result = sanitize(input, "test.json", rules)

      expect(result).toEqual({})
    })

    it("preserves undefined vs null distinction", () => {
      const rules: Rule[] = [
        {
          description: "undefined rule",
          key: "transform",
          transform: () => undefined, // Explicitly return undefined
        },
      ]

      const input = { keep: null, transform: "original" }
      const result = sanitize(input, "test.json", rules)

      // @ts-expect-error
      expect(result.keep).toBe(null)
      // @ts-expect-error
      expect(result.transform).toBe("original") // undefined means "no change"
    })
  })

  describe("helper functions", () => {
    describe("shouldProcessFile", () => {
      it("processes manifest.json", () => {
        expect(shouldProcessFile("manifest.json")).toBe(true)
      })

      it("processes template files", () => {
        expect(shouldProcessFile("stack.template.json")).toBe(true)
        expect(shouldProcessFile("nested.template.json")).toBe(true)
      })

      it("processes template config files", () => {
        expect(shouldProcessFile("stack.template.json.config.json")).toBe(true)
      })

      it("skips other files", () => {
        expect(shouldProcessFile("package.json")).toBe(false)
        expect(shouldProcessFile("README.md")).toBe(false)
        expect(shouldProcessFile("data.json")).toBe(false)
        expect(shouldProcessFile("template.json")).toBe(false) // Missing .template
      })
    })

    describe("shouldProcessDirectory", () => {
      it("processes normal directories", () => {
        expect(shouldProcessDirectory("src")).toBe(true)
        expect(shouldProcessDirectory("nested")).toBe(true)
        expect(shouldProcessDirectory("MyStack")).toBe(true)
      })

      it("skips asset directories", () => {
        expect(
          shouldProcessDirectory(
            "asset.ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
          ),
        ).toBe(false)
      })

      it("processes directories that look like assets but aren't", () => {
        expect(shouldProcessDirectory("asset.short")).toBe(true) // Too short
        expect(
          shouldProcessDirectory(
            "asset.a1b2c3d4e5f6789012345678901234567890123456789012345678901234G",
          ),
        ).toBe(true) // Non-hex char
        expect(
          shouldProcessDirectory(
            "notasset.a1b2c3d4e5f6789012345678901234567890123456789012345678901234",
          ),
        ).toBe(true) // Wrong prefix
      })
    })
  })
})

