const path = require('path');
const { Level } = require('level');
const vscode = require('vscode'); 

let db;
const dbpath = path.join(vscode.workspace.rootPath, 'tagsdb')

function initDB() {
  if (!db) {
    db = new Level(dbpath, { valueEncoding: 'json' });
  }
  return db;
}

function getDB() {
  if (!db) throw new Error('DB is not initialized.');
  return db;
}

function closeDB() {
  if (!db) throw new Error('DB is not initialized.');
  db.close();
}

async function getValueFromDb(key) {
  try {
    const value = await db.get(key);
    return value;
  } catch (err) {
    if (err.notFound) {
      return null;
    } else {
      throw err;
    }
  }
}


async function getEntriesWithPrefix(prefix, limit = 10) {
  const entries = [];
  const iterator = db.iterator({
    gte: prefix,
    lte: prefix + '\xff',
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  });

  try {
    for await (const [key, value] of iterator) {
      entries.push({ key, value });
      if (entries.length >= limit) break;
    }
  } catch (err) {
    console.error('Iterator error:', err);
    throw err;
  } finally {
    await iterator.close();
  }
  return entries;
}

async function batchWriteIntoDB(data)  {
  try {
    await db.batch(data);
    } catch (err) {
        console.error('Batch write failed:', err);
    }
}

module.exports = { initDB, getDB, closeDB, getValueFromDb, getEntriesWithPrefix, batchWriteIntoDB };
