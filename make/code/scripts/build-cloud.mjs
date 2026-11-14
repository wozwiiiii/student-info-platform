/**
 * 云函数构建：esbuild 将 TS 源码（含 shared/）打包为各云函数根目录 index.js
 * wx-server-sdk 为 external（云端安装依赖）
 * 用法：node scripts/build-cloud.mjs
 */
import { build } from 'esbuild'
import { readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fnRoot = join(root, 'cloudfunctions')
const functions = readdirSync(fnRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(fnRoot, d.name, 'src', 'index.ts')))
  .map((d) => d.name)

for (const name of functions) {
  await build({
    entryPoints: [join(fnRoot, name, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: join(fnRoot, name, 'index.js'),
    external: ['wx-server-sdk'],
    logLevel: 'info'
  })
}
console.log(`built: ${functions.join(', ')}`)
