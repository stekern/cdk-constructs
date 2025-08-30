#!/usr/bin/env node
const utils = require("../dist/src/utils.js")
const [, , cloudAssemblyDir, snapshotDir] = process.argv
if (!cloudAssemblyDir || !snapshotDir) {
  console.error("Usage: generate-snapshots <cloud-assembly-dir> <snapshot-dir>")
  process.exit(1)
}
utils.sanitizeCloudAssembly(cloudAssemblyDir, snapshotDir)
