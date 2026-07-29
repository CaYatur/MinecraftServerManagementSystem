#!/usr/bin/env node
/**
 * Build the MSMS Bridge plugin jar with nothing but a JDK and Node.
 *
 * Deliberately not Maven or Gradle. The whole plugin is three small source
 * files with no runtime dependencies, and requiring a second build system to
 * produce a 6 KB jar would make it something most contributors cannot build.
 * Compile dependencies are fetched once into `bridge/.deps/` and cached.
 *
 *   node bridge/build.mjs            build the jar
 *   node bridge/build.mjs --selftest build, then verify the wire format
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync, copyFileSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEPS = join(HERE, '.deps')
const OUT = join(HERE, 'build')
const CLASSES = join(OUT, 'classes')

/**
 * Paper's API is compiled against Adventure, and javac needs those class files
 * on the classpath even though the plugin never names them itself.
 */
const DEPENDENCIES = [
  {
    name: 'paper-api.jar',
    url:
      'https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/' +
      '1.21.4-R0.1-SNAPSHOT/paper-api-1.21.4-R0.1-20250925.065901-231.jar'
  },
  { name: 'adventure-api.jar', url: mvn('net/kyori', 'adventure-api', '4.17.0') },
  { name: 'adventure-key.jar', url: mvn('net/kyori', 'adventure-key', '4.17.0') },
  { name: 'examination-api.jar', url: mvn('net/kyori', 'examination-api', '1.3.0') }
]

function mvn(group, artifact, version) {
  return `https://repo1.maven.org/maven2/${group}/${artifact}/${version}/${artifact}-${version}.jar`
}

async function fetchDeps() {
  mkdirSync(DEPS, { recursive: true })
  for (const d of DEPENDENCIES) {
    const dest = join(DEPS, d.name)
    if (existsSync(dest)) continue
    process.stdout.write(`fetching ${d.name}… `)
    const r = await fetch(d.url)
    if (!r.ok) throw new Error(`${d.name}: HTTP ${r.status}`)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length === 0) throw new Error(`${d.name}: empty download`)
    writeFileSync(dest, buf)
    console.log(`${buf.length} bytes`)
  }
}

const sep = process.platform === 'win32' ? ';' : ':'
const cp = () => DEPENDENCIES.map((d) => join(DEPS, d.name)).join(sep)
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

const SRC = join(HERE, 'src', 'main', 'java', 'dev', 'cayadev', 'msms', 'bridge')
const RES = join(HERE, 'src', 'main', 'resources')

async function build({ selftest }) {
  await fetchDeps()
  rmSync(CLASSES, { recursive: true, force: true })
  mkdirSync(CLASSES, { recursive: true })

  const sources = readdirSync(SRC)
    .filter((f) => f.endsWith('.java'))
    // SelfTest is a harness, not part of the plugin.
    .filter((f) => selftest || f !== 'SelfTest.java')
    .map((f) => join(SRC, f))

  console.log('compiling…')
  run('javac', ['-encoding', 'UTF-8', '--release', '21', '-cp', cp(), '-d', CLASSES, ...sources])

  if (selftest) {
    console.log('--- self test output ---')
    run('java', ['-cp', CLASSES, 'dev.cayadev.msms.bridge.SelfTest'])
    return
  }

  for (const f of readdirSync(RES)) copyFileSync(join(RES, f), join(CLASSES, f))
  // The version comes from plugin.yml, never from a literal here. The app finds
  // the jar by parsing its filename and the smoke asserts that the shipped jar
  // matches what plugin.yml declares — two places to change is one place to
  // forget, and the failure is a plugin that reports a version it is not.
  const declared = /^version:\s*(.+)$/m.exec(readFileSync(join(RES, 'plugin.yml'), 'utf8'))
  if (!declared) throw new Error('plugin.yml has no version')
  const jar = join(OUT, `MSMS-Bridge-${declared[1].trim()}.jar`)
  run('jar', ['--create', '--file', jar, '-C', CLASSES, '.'])
  console.log(`\nbuilt ${jar}`)
  console.log('Drop it in your server\'s plugins/ folder and restart.')
}

build({ selftest: process.argv.includes('--selftest') }).catch((e) => {
  console.error('build failed:', e.message)
  process.exit(1)
})
