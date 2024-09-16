import * as fs from "fs"
import { Application, DeclarationReflection, ReflectionKind } from "typedoc"

async function generateConstructDocs(readmePath: string) {
  // Initialize TypeDoc
  const app = await Application.bootstrap({
    entryPoints: ["src"],
    logLevel: "Warn",
  })
  const project = await app.convert()
  if (project) {
    let constructs: { name: string; description: string; filename: string }[] =
      []
    project.children?.forEach((declaration) => {
      if (
        declaration instanceof DeclarationReflection &&
        declaration.kind === ReflectionKind.Class &&
        declaration.extendedTypes?.some(
          (type) => type.toString() === "Construct",
        )
      ) {
        let description = ""
        if (declaration.comment?.summary) {
          description = declaration.comment.summary
            .map((c) => c.text)
            .join("")
            .trim()
        }
        const filename = declaration.sources?.at(0)?.fileName
        if (!filename) {
          throw new Error(
            `Failed to find a source file associated with declaration: ${declaration.toString()}`,
          )
        }
        constructs.push({ name: declaration.name, description, filename })
      }
    })

    let constructDocs = "## Constructs\n\n"
    constructs.forEach((construct) => {
      constructDocs += `### [\`${construct.name}\`](${construct.filename})\n\n${construct.description}\n\n`
    })

    const readmeContent = constructDocs

    const readme = fs.readFileSync(readmePath, "utf-8")
    const updatedReadme = readme.replace(
      /(<!-- CONSTRUCT_DOCUMENTATION_START -->)[\s\S]*?(<!-- CONSTRUCT_DOCUMENTATION_END -->)/,
      `$1\n${readmeContent}\n$2`,
    )
    console.log(updatedReadme + "\n")
  }
}

const readmePath = process.argv[2]
if (!readmePath) {
  console.error(
    "Please provide the path to the README file as a command line argument.",
  )
  process.exit(1)
}

generateConstructDocs(readmePath).catch(console.error)
