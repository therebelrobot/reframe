import path from 'node:path'
import { serve } from '@hono/node-server'
import { loadServerConfig } from './config'
import { openDatabase } from './database'
import { createApplication } from './app'
import { loadStaticAssets } from './staticAssets'

const config = loadServerConfig()
const database = openDatabase(path.join(config.dataDirectory, 'reframe.db'))
const staticAssets = loadStaticAssets(config.publicAssetsDirectory)
const { app, sessions, vault } = createApplication({ config, database, staticAssets })

if (!vault.isInitialized()) {
  console.log('──────────────────────────────────────────────')
  console.log(' Reframe has not been set up yet.')
  console.log(` Setup token: ${config.setupToken}`)
  console.log(
    config.setupTokenWasGenerated
      ? ' (Generated for this run. Set REFRAME_SETUP_TOKEN to choose your own.)'
      : ' (From REFRAME_SETUP_TOKEN.)',
  )
  console.log('──────────────────────────────────────────────')
}
if (!config.cookieSecure) {
  console.warn('WARNING: REFRAME_COOKIE_SECURE=false. Only do this for local development over plain HTTP.')
}
if (staticAssets.size === 0) {
  console.warn(`WARNING: no client files found in ${config.publicAssetsDirectory}. Run npm run build.`)
}

const sweepTimer = setInterval(() => sessions.sweepExpired(), 60_000)
sweepTimer.unref()

const server = serve({ fetch: app.fetch, port: config.listenPort, hostname: config.listenHost }, (addressInfo) => {
  console.log(`Reframe listening on ${config.listenHost}:${addressInfo.port}`)
})

function shutDown(signalName: string) {
  console.log(`${signalName} received; locking and closing.`)
  sessions.destroyAll()
  server.close(() => {
    database.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', () => shutDown('SIGTERM'))
process.on('SIGINT', () => shutDown('SIGINT'))
