import fs from 'fs'
import path from 'path'
import { rimrafSync } from 'rimraf'

function deleteSourceMapsInDir(dir) {
  if (!fs.existsSync(dir)) return
  rimrafSync(path.join(dir, '*.js.map'), { glob: true })
}

// Repo root is the working directory for npm scripts.
const distMainPath = path.join(process.cwd(), 'release', 'app', 'dist', 'main')
const distRendererPath = path.join(process.cwd(), 'release', 'app', 'dist', 'renderer')

deleteSourceMapsInDir(distMainPath)
deleteSourceMapsInDir(distRendererPath)


