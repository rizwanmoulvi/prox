import { loadConfig } from '../config'
import { Db } from './db'

const db = new Db(loadConfig().DATABASE_URL)
await db.migrate()
await db.close()
console.log('schema applied')
